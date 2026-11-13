//go:build !windows

package hotupgrade

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// SupervisorConfig describes how the supervisor runs its workers.
type SupervisorConfig struct {
	// Addr is the address to listen on, such as ":3000".
	Addr string
	// ImageBinary and ImageVersion are the binary the container image ships.
	ImageBinary  string
	ImageVersion string
	// Args are passed unchanged to every worker.
	Args []string
	// Env is the environment workers start from.
	Env          []string
	ReadyTimeout time.Duration
	DrainTimeout time.Duration
	Logf         func(format string, args ...any)
}

// state is what survives a container restart: which binary to run, and the
// one before it for a rollback.
type state struct {
	ImageVersion string   `json:"image_version"`
	Current      Release  `json:"current"`
	Previous     *Release `json:"previous,omitempty"`
}

type workerProcess struct {
	info    WorkerInfo
	release Release
	cmd     *exec.Cmd
	control net.Conn
	writeMu sync.Mutex
	ready   chan struct{}
	exited  chan struct{}
	once    sync.Once
}

func (w *workerProcess) send(msg message) error {
	data, err := common.Marshal(msg)
	if err != nil {
		return err
	}
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	_, err = w.control.Write(append(data, '\n'))
	return err
}

type supervisor struct {
	cfg      SupervisorConfig
	dir      string
	listener *os.File

	mu        sync.Mutex
	state     state
	status    Status
	active    *workerProcess
	candidate *workerProcess
	draining  map[*workerProcess]struct{}
	nextGen   int
	upgrading bool
	failed    chan error
}

// RunSupervisor owns the listening socket and keeps one worker serving until
// the process receives SIGTERM or SIGINT, or the serving worker exits on its
// own. It returns the error to exit with.
func RunSupervisor(cfg SupervisorConfig) error {
	if cfg.Logf == nil {
		cfg.Logf = func(format string, args ...any) { fmt.Fprintf(os.Stderr, "[hot-upgrade] "+format+"\n", args...) }
	}
	s := &supervisor{
		cfg:      cfg,
		dir:      Dir(),
		draining: map[*workerProcess]struct{}{},
		failed:   make(chan error, 1),
	}
	if err := os.MkdirAll(filepath.Join(s.dir, "bin"), 0o755); err != nil {
		return err
	}
	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return err
	}
	s.listener, err = nonblockingFile(ln.(*net.TCPListener))
	_ = ln.Close()
	if err != nil {
		return err
	}
	s.cfg.Env = s.workerBaseEnv()
	s.loadState()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)

	// An installed version that no longer starts must not keep the container
	// in a restart loop nobody can reach the console of: the version before
	// it, then the image's own binary, are tried in its place. state.json is
	// left as it is, so the next restart tries the installed version again
	// in case the fault was not its own, such as a database that was down.
	installed := s.state.Current
	releases := []Release{installed}
	if previous := s.state.Previous; previous != nil && previous.Path != installed.Path && fileMatches(*previous) == nil {
		releases = append(releases, *previous)
	}
	if image := (Release{Version: cfg.ImageVersion, Path: cfg.ImageBinary}); !slices.ContainsFunc(releases, func(r Release) bool { return r.Path == image.Path }) {
		releases = append(releases, image)
	}
	var startErr error
	for _, release := range releases {
		s.mu.Lock()
		s.nextGen = 0
		s.mu.Unlock()
		first, err := s.spawn(release)
		if err != nil {
			startErr = fmt.Errorf("failed to start %s: %w", release.Version, err)
			s.cfg.Logf("%v", startErr)
			continue
		}
		s.mu.Lock()
		s.active = first
		s.status.Phase = PhaseIdle
		if release.Path != installed.Path {
			s.state.Current = release
			s.state.Previous = nil
			s.status.Phase = PhaseFailed
			s.status.TargetVersion = installed.Version
			s.status.Error = fmt.Sprintf("%s did not start after a restart; running %s instead", installed.Version, release.Version)
		}
		s.writeStatusLocked()
		s.mu.Unlock()

		select {
		case <-first.ready:
			s.cfg.Logf("worker %d (%s) is serving", first.info.Generation, first.release.Version)
			startErr = nil
		case <-first.exited:
			startErr = fmt.Errorf("worker (%s) exited before it started serving: %s", release.Version, exitText(first))
			s.cfg.Logf("%v", startErr)
			// This exit was handled here; it is not a serving worker dying.
			s.mu.Lock()
			s.active = nil
			s.mu.Unlock()
			select {
			case <-s.failed:
			default:
			}
			continue
		case sig := <-signals:
			s.shutdown(sig)
			return nil
		}
		break
	}
	if startErr != nil {
		return startErr
	}

	select {
	case err := <-s.failed:
		s.shutdown(syscall.SIGTERM)
		return err
	case sig := <-signals:
		s.shutdown(sig)
		return nil
	}
}

// nonblockingFile duplicates the listening socket into a file that stays in
// non-blocking mode. TCPListener.File would switch the socket to blocking
// mode each time exec hands it to a new worker, and since every worker shares
// the socket, a draining worker would then hang in accept and keep taking
// connections it should leave to the new one.
func nonblockingFile(ln *net.TCPListener) (*os.File, error) {
	raw, err := ln.SyscallConn()
	if err != nil {
		return nil, err
	}
	var dupFd int
	var dupErr error
	syscall.ForkLock.RLock()
	err = raw.Control(func(fd uintptr) {
		dupFd, dupErr = syscall.Dup(int(fd))
		if dupErr == nil {
			syscall.CloseOnExec(dupFd)
		}
	})
	syscall.ForkLock.RUnlock()
	if err != nil {
		return nil, err
	}
	if dupErr != nil {
		return nil, dupErr
	}
	return os.NewFile(uintptr(dupFd), "listener"), nil
}

// workerBaseEnv clears variables a worker must not inherit and gives every
// worker of this container the same session secret, so a user served by the
// old worker stays signed in on the new one.
func (s *supervisor) workerBaseEnv() []string {
	env := make([]string, 0, len(s.cfg.Env)+1)
	hasSecret := false
	for _, kv := range s.cfg.Env {
		key, value, _ := strings.Cut(kv, "=")
		switch key {
		case "VERSION":
			s.cfg.Logf("VERSION is ignored under hot upgrade so each binary reports its own version")
			continue
		case common.EnvUpgradeWorker, common.EnvUpgradeWorkerGeneration:
			continue
		case "SESSION_SECRET":
			hasSecret = value != ""
		}
		env = append(env, kv)
	}
	// Set but empty, so a VERSION line in the worker's .env file is ignored
	// as well: godotenv leaves variables that are already set alone.
	env = append(env, "VERSION=")
	if !hasSecret {
		secret := make([]byte, 32)
		_, _ = rand.Read(secret)
		env = append(env, "SESSION_SECRET="+hex.EncodeToString(secret))
		s.cfg.Logf("SESSION_SECRET is not set; using a random one until the container restarts. Set it so sign-ins survive restarts.")
	}
	return env
}

// loadState picks the binary to run: the one installed by an earlier upgrade,
// unless the container now runs a different image, whose own binary wins.
func (s *supervisor) loadState() {
	imageRelease := Release{Version: s.cfg.ImageVersion, Path: s.cfg.ImageBinary}
	var saved state
	data, err := os.ReadFile(filepath.Join(s.dir, "state.json"))
	if err == nil && common.Unmarshal(data, &saved) == nil &&
		saved.ImageVersion == s.cfg.ImageVersion && fileMatches(saved.Current) == nil {
		s.state = saved
		return
	}
	s.state = state{ImageVersion: s.cfg.ImageVersion, Current: imageRelease}
	if err := writeJSONFile(filepath.Join(s.dir, "state.json"), s.state); err != nil {
		s.cfg.Logf("failed to save state: %v", err)
	}
	s.removeUnusedBinaries()
}

func (s *supervisor) spawn(release Release) (*workerProcess, error) {
	s.mu.Lock()
	s.nextGen++
	generation := s.nextGen
	s.mu.Unlock()

	syscall.ForkLock.RLock()
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err == nil {
		syscall.CloseOnExec(fds[0])
		syscall.CloseOnExec(fds[1])
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return nil, err
	}
	parentEnd := os.NewFile(uintptr(fds[0]), "control")
	childEnd := os.NewFile(uintptr(fds[1]), "control")
	defer childEnd.Close()
	control, err := net.FileConn(parentEnd)
	_ = parentEnd.Close()
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(release.Path, s.cfg.Args...)
	cmd.Env = append(append([]string{}, s.cfg.Env...),
		common.EnvUpgradeWorker+"=1",
		common.EnvUpgradeWorkerGeneration+"="+strconv.Itoa(generation),
	)
	cmd.Stdin = nil
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.ExtraFiles = []*os.File{s.listener, childEnd}
	if err := cmd.Start(); err != nil {
		_ = control.Close()
		return nil, err
	}
	w := &workerProcess{
		info: WorkerInfo{
			Generation: generation,
			Pid:        cmd.Process.Pid,
			Version:    release.Version,
			StartedAt:  time.Now().Unix(),
		},
		release: release,
		cmd:     cmd,
		control: control,
		ready:   make(chan struct{}),
		exited:  make(chan struct{}),
	}
	go s.readMessages(w)
	go func() {
		_ = cmd.Wait()
		close(w.exited)
		_ = control.Close()
		s.onExit(w)
	}()
	return w, nil
}

func (s *supervisor) readMessages(w *workerProcess) {
	scanner := bufio.NewScanner(w.control)
	for scanner.Scan() {
		var msg message
		if common.Unmarshal(scanner.Bytes(), &msg) != nil {
			continue
		}
		s.handle(w, msg)
	}
}

func (s *supervisor) handle(w *workerProcess, msg message) {
	switch msg.Type {
	case messageReady:
		w.once.Do(func() { close(w.ready) })
	case messageConnections:
		s.mu.Lock()
		w.info.Connections = msg.Count
		s.writeStatusLocked()
		s.mu.Unlock()
	case messageUpgrade:
		target := Release{Version: msg.Version, Path: msg.Path, SHA256: msg.SHA256}
		s.reply(w, s.beginUpgrade(w, target, true))
	case messageRollback:
		s.mu.Lock()
		previous := s.state.Previous
		s.mu.Unlock()
		if previous == nil {
			s.reply(w, errors.New("no previous version to roll back to"))
			return
		}
		s.reply(w, s.beginUpgrade(w, *previous, false))
	}
}

func (s *supervisor) reply(w *workerProcess, err error) {
	msg := message{Type: messageReply}
	if err != nil {
		msg.Error = err.Error()
	}
	if sendErr := w.send(msg); sendErr != nil {
		s.cfg.Logf("failed to reply to worker %d: %v", w.info.Generation, sendErr)
	}
}

// beginUpgrade accepts an upgrade request from the serving worker and runs it
// in the background. A downloaded binary must sit in the binary directory; a
// rollback may also return to the image's own binary.
func (s *supervisor) beginUpgrade(from *workerProcess, target Release, downloaded bool) error {
	if downloaded {
		binDir := filepath.Join(s.dir, "bin") + string(filepath.Separator)
		if !strings.HasPrefix(filepath.Clean(target.Path), binDir) || target.SHA256 == "" {
			return errors.New("the new binary must be a verified download in the upgrade directory")
		}
	}
	if target.Version == "" {
		return errors.New("the target version is empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if from != s.active {
		return errors.New("only the serving worker can start an upgrade")
	}
	if s.upgrading {
		return errors.New("an upgrade is already in progress")
	}
	s.upgrading = true
	s.status.Phase = PhaseStarting
	s.status.TargetVersion = target.Version
	s.status.Error = ""
	s.writeStatusLocked()
	go s.upgrade(target)
	return nil
}

func (s *supervisor) upgrade(target Release) {
	err := s.switchTo(target)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.upgrading = false
	if err != nil {
		s.cfg.Logf("upgrade to %s failed: %v", target.Version, err)
		s.status.Phase = PhaseFailed
		s.status.Error = err.Error()
	} else {
		s.status.Phase = PhaseSucceeded
	}
	s.writeStatusLocked()
}

func (s *supervisor) switchTo(target Release) error {
	if err := fileMatches(target); err != nil {
		return err
	}
	if err := s.checkVersion(target); err != nil {
		return err
	}
	candidate, err := s.spawn(target)
	if err != nil {
		return fmt.Errorf("failed to start the new version: %w", err)
	}
	s.mu.Lock()
	s.candidate = candidate
	s.writeStatusLocked()
	s.mu.Unlock()

	timer := time.NewTimer(s.cfg.ReadyTimeout)
	defer timer.Stop()
	select {
	case <-candidate.ready:
	case <-candidate.exited:
		s.clearCandidate()
		return fmt.Errorf("the new version exited before it started serving: %s", exitText(candidate))
	case <-timer.C:
		_ = candidate.cmd.Process.Kill()
		<-candidate.exited
		s.clearCandidate()
		return fmt.Errorf("the new version did not start serving within %s", s.cfg.ReadyTimeout)
	}

	s.mu.Lock()
	old := s.active
	s.active = candidate
	s.candidate = nil
	old.info.DrainingSince = time.Now().Unix()
	s.draining[old] = struct{}{}
	previous := s.state.Current
	s.state.Previous = &previous
	s.state.Current = target
	if err := writeJSONFile(filepath.Join(s.dir, "state.json"), s.state); err != nil {
		s.cfg.Logf("failed to save state: %v", err)
	}
	s.writeStatusLocked()
	s.mu.Unlock()

	s.removeUnusedBinaries()
	s.cfg.Logf("worker %d (%s) is serving; worker %d (%s) is finishing its connections",
		candidate.info.Generation, target.Version, old.info.Generation, old.release.Version)
	_ = old.cmd.Process.Signal(syscall.SIGUSR2)
	go func() {
		// Past its drain deadline the worker still closes what is open,
		// settles those requests and writes its in-memory state.
		limit := time.NewTimer(s.cfg.DrainTimeout + 2*time.Minute)
		defer limit.Stop()
		select {
		case <-old.exited:
		case <-limit.C:
			s.cfg.Logf("worker %d did not finish within %s; stopping it", old.info.Generation, s.cfg.DrainTimeout)
			_ = old.cmd.Process.Kill()
		}
	}()
	return nil
}

func (s *supervisor) clearCandidate() {
	s.mu.Lock()
	s.candidate = nil
	s.writeStatusLocked()
	s.mu.Unlock()
}

// checkVersion runs the binary with --version so a file that cannot run, or
// is not the version asked for, never replaces the serving worker.
func (s *supervisor) checkVersion(target Release) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, target.Path, "--version")
	cmd.Env = s.cfg.Env
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("the new binary cannot run: %w", err)
	}
	if got := strings.TrimSpace(string(output)); got != target.Version {
		return fmt.Errorf("the new binary reports version %q instead of %q", got, target.Version)
	}
	return nil
}

func (s *supervisor) onExit(w *workerProcess) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, wasDraining := s.draining[w]
	delete(s.draining, w)
	switch {
	case w == s.active:
		select {
		case s.failed <- fmt.Errorf("worker %d exited: %s", w.info.Generation, exitText(w)):
		default:
		}
	case wasDraining:
		s.cfg.Logf("worker %d (%s) finished its connections and exited", w.info.Generation, w.release.Version)
	default:
		s.cfg.Logf("worker %d exited: %s", w.info.Generation, exitText(w))
	}
	s.writeStatusLocked()
}

// shutdown asks every worker to stop as on a normal docker stop and waits for
// them all.
func (s *supervisor) shutdown(sig os.Signal) {
	s.mu.Lock()
	workers := make([]*workerProcess, 0, len(s.draining)+2)
	if s.active != nil {
		workers = append(workers, s.active)
		s.active = nil
	}
	if s.candidate != nil {
		workers = append(workers, s.candidate)
	}
	for w := range s.draining {
		workers = append(workers, w)
	}
	s.mu.Unlock()
	for _, w := range workers {
		_ = w.cmd.Process.Signal(sig)
	}
	for _, w := range workers {
		<-w.exited
	}
}

func (s *supervisor) writeStatusLocked() {
	s.status.UpdatedAt = time.Now().Unix()
	s.status.Current = s.state.Current
	s.status.Previous = s.state.Previous
	s.status.Active = nil
	if s.active != nil {
		info := s.active.info
		s.status.Active = &info
	}
	s.status.Draining = make([]WorkerInfo, 0, len(s.draining))
	for w := range s.draining {
		s.status.Draining = append(s.status.Draining, w.info)
	}
	if err := writeJSONFile(filepath.Join(s.dir, "status.json"), s.status); err != nil {
		s.cfg.Logf("failed to write status: %v", err)
	}
}

// removeUnusedBinaries keeps only the current and previous downloads.
func (s *supervisor) removeUnusedBinaries() {
	s.mu.Lock()
	keep := map[string]bool{filepath.Clean(s.state.Current.Path): true}
	if s.state.Previous != nil {
		keep[filepath.Clean(s.state.Previous.Path)] = true
	}
	s.mu.Unlock()
	binDir := filepath.Join(s.dir, "bin")
	entries, err := os.ReadDir(binDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		path := filepath.Join(binDir, entry.Name())
		if entry.IsDir() || keep[path] || strings.HasSuffix(entry.Name(), ".part") {
			continue
		}
		_ = os.Remove(path)
	}
}

// fileMatches checks a release's binary exists and, when a checksum is known,
// that it is still the verified file.
func fileMatches(release Release) error {
	file, err := os.Open(release.Path)
	if err != nil {
		return fmt.Errorf("the binary is missing: %w", err)
	}
	defer file.Close()
	if release.SHA256 == "" {
		return nil
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), release.SHA256) {
		return errors.New("the binary does not match its checksum")
	}
	return nil
}

func exitText(w *workerProcess) string {
	if w.cmd.ProcessState == nil {
		return "unknown"
	}
	return w.cmd.ProcessState.String()
}
