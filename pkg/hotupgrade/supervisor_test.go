//go:build !windows

package hotupgrade

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The test binary doubles as the supervisor and as every worker version, so
// the tests run real processes sharing a real socket.
func TestMain(m *testing.M) {
	switch os.Getenv("HOTUPGRADE_TEST_ROLE") {
	case "worker":
		if slices.Contains(os.Args[1:], "--version") {
			fmt.Println(os.Getenv("HOTUPGRADE_TEST_VERSION"))
			os.Exit(0)
		}
		if os.Getenv("HOTUPGRADE_TEST_CRASH") == "1" {
			os.Exit(3)
		}
		runTestWorker()
		os.Exit(0)
	case "supervisor":
		err := RunSupervisor(SupervisorConfig{
			Addr:         os.Getenv("HOTUPGRADE_TEST_ADDR"),
			ImageBinary:  os.Getenv("HOTUPGRADE_TEST_IMAGE"),
			ImageVersion: os.Getenv("HOTUPGRADE_TEST_IMAGE_VERSION"),
			Env:          os.Environ(),
			ReadyTimeout: 5 * time.Second,
			DrainTimeout: DrainTimeout(),
			Logf:         func(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...) },
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func runTestWorker() {
	version := os.Getenv("HOTUPGRADE_TEST_VERSION")
	mux := http.NewServeMux()
	mux.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, version)
	})
	mux.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) {
		chunks, _ := strconv.Atoi(r.URL.Query().Get("chunks"))
		w.Header().Set("X-Version", version)
		for range chunks {
			fmt.Fprintln(w, "chunk")
			w.(http.Flusher).Flush()
			time.Sleep(100 * time.Millisecond)
		}
	})
	mux.HandleFunc("/hold", func(w http.ResponseWriter, r *http.Request) {
		chunks, _ := strconv.Atoi(r.URL.Query().Get("chunks"))
		done := common.TrackConnection()
		defer done()
		conn, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		fmt.Fprintf(buf, "HTTP/1.1 200 OK\r\nX-Version: %s\r\nConnection: close\r\n\r\n", version)
		for range chunks {
			fmt.Fprintln(buf, "frame")
			_ = buf.Flush()
			time.Sleep(100 * time.Millisecond)
		}
	})
	mux.HandleFunc("/upgrade", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		release := Release{Version: q.Get("version"), Path: q.Get("path"), SHA256: q.Get("sha256")}
		var err error
		if q.Get("rollback") == "1" {
			err = Current().RequestRollback(r.Context())
		} else {
			err = Current().RequestUpgrade(r.Context(), release)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
		}
	})
	err := Serve(ServeOptions{
		Server:          &http.Server{Handler: mux},
		ShutdownTimeout: 5 * time.Second,
		DrainTimeout:    DrainTimeout(),
		Logf:            func(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...) },
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type testEnv struct {
	t      *testing.T
	dir    string
	addr   string
	extra  []string
	sup    *exec.Cmd
	exited chan struct{}
	binary string
}

func newTestEnv(t *testing.T, extraEnv ...string) *testEnv {
	t.Helper()
	binary, err := os.Executable()
	require.NoError(t, err)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	require.NoError(t, listener.Close())
	return &testEnv{t: t, dir: t.TempDir(), addr: addr, extra: extraEnv, binary: binary}
}

// script writes an executable that runs this test binary as one worker
// version; crash makes the worker exit before serving.
func (e *testEnv) script(name, version string, crash bool) string {
	e.t.Helper()
	path := filepath.Join(e.dir, name)
	crashValue := "0"
	if crash {
		crashValue = "1"
	}
	content := fmt.Sprintf("#!/bin/sh\nHOTUPGRADE_TEST_ROLE=worker HOTUPGRADE_TEST_VERSION=%s HOTUPGRADE_TEST_CRASH=%s exec %q \"$@\"\n", version, crashValue, e.binary)
	require.NoError(e.t, os.WriteFile(path, []byte(content), 0o755))
	return path
}

// download places a worker version where a verified download would be.
func (e *testEnv) download(version string, crash bool) Release {
	e.t.Helper()
	source := e.script("source-"+version, version, crash)
	data, err := os.ReadFile(source)
	require.NoError(e.t, err)
	binDir := filepath.Join(e.dir, "upgrade", "bin")
	require.NoError(e.t, os.MkdirAll(binDir, 0o755))
	path := filepath.Join(binDir, "new-api-"+version)
	require.NoError(e.t, os.WriteFile(path, data, 0o755))
	sum := sha256.Sum256(data)
	return Release{Version: version, Path: path, SHA256: hex.EncodeToString(sum[:])}
}

func (e *testEnv) start(imageVersion string) {
	e.t.Helper()
	image := e.script("image-"+imageVersion, imageVersion, false)
	cmd := exec.Command(e.binary)
	cmd.Env = append(os.Environ(),
		"HOTUPGRADE_TEST_ROLE=supervisor",
		"HOTUPGRADE_TEST_ADDR="+e.addr,
		"HOTUPGRADE_TEST_IMAGE="+image,
		"HOTUPGRADE_TEST_IMAGE_VERSION="+imageVersion,
		EnvDir+"="+filepath.Join(e.dir, "upgrade"),
	)
	cmd.Env = append(cmd.Env, e.extra...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	require.NoError(e.t, cmd.Start())
	e.sup = cmd
	e.exited = make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(e.exited)
	}()
	e.t.Cleanup(e.stop)
	require.Eventually(e.t, func() bool { return e.servedVersion() != "" },
		10*time.Second, 50*time.Millisecond, "the first worker should start serving")
}

func (e *testEnv) stop() {
	if e.sup == nil {
		return
	}
	select {
	case <-e.exited:
		return
	default:
	}
	_ = e.sup.Process.Signal(syscall.SIGTERM)
	select {
	case <-e.exited:
	case <-time.After(15 * time.Second):
		_ = e.sup.Process.Kill()
		<-e.exited
	}
}

func (e *testEnv) url(path string) string {
	return "http://" + e.addr + path
}

// get fetches path on a fresh connection, so each call is a new connection
// the supervisor's socket hands to whichever worker is accepting.
func (e *testEnv) get(path string) string {
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	resp, err := client.Get(e.url(path))
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func (e *testEnv) servedVersion() string {
	return e.get("/version")
}

func (e *testEnv) requestUpgrade(release Release) (int, string) {
	e.t.Helper()
	client := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	query := fmt.Sprintf("/upgrade?version=%s&path=%s&sha256=%s", release.Version, release.Path, release.SHA256)
	resp, err := client.Get(e.url(query))
	require.NoError(e.t, err)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, strings.TrimSpace(string(body))
}

func (e *testEnv) status() Status {
	e.t.Helper()
	var status Status
	data, err := os.ReadFile(filepath.Join(e.dir, "upgrade", "status.json"))
	if err != nil {
		return status
	}
	_ = common.Unmarshal(data, &status)
	return status
}

// openStream starts a long response and returns once its first line arrived,
// along with a function that reads the rest and returns the line count.
func (e *testEnv) openStream(path string) (string, func() (int, error)) {
	e.t.Helper()
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
	resp, err := client.Get(e.url(path))
	require.NoError(e.t, err)
	reader := bufio.NewReader(resp.Body)
	_, err = reader.ReadString('\n')
	require.NoError(e.t, err)
	return resp.Header.Get("X-Version"), func() (int, error) {
		defer resp.Body.Close()
		lines := 1
		for {
			_, err := reader.ReadString('\n')
			if err == io.EOF {
				return lines, nil
			}
			if err != nil {
				return lines, err
			}
			lines++
		}
	}
}

func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

func TestUpgradeKeepsOpenStreamOnOldVersionAndSendsNewRequestsToNewVersion(t *testing.T) {
	env := newTestEnv(t)
	env.start("v1")
	oldPid := env.status().Active.Pid

	streamVersion, finishStream := env.openStream("/stream?chunks=30")
	require.Equal(t, "v1", streamVersion)

	code, body := env.requestUpgrade(env.download("v2", false))
	require.Equal(t, http.StatusOK, code, body)

	require.Eventually(t, func() bool { return env.status().Phase == PhaseSucceeded }, 10*time.Second, 50*time.Millisecond)
	for range 20 {
		assert.Equal(t, "v2", env.servedVersion(), "every new connection goes to the new version")
	}
	assert.True(t, processAlive(oldPid), "the old version keeps running while its stream is open")

	lines, err := finishStream()
	require.NoError(t, err)
	assert.Equal(t, 30, lines, "the open stream finishes on the old version without being cut")
	assert.Eventually(t, func() bool { return !processAlive(oldPid) }, 10*time.Second, 50*time.Millisecond,
		"the old version exits once its last connection is done")
	assert.Eventually(t, func() bool { return len(env.status().Draining) == 0 }, 10*time.Second, 50*time.Millisecond)
	status := env.status()
	assert.Equal(t, "v2", status.Current.Version)
	require.NotNil(t, status.Previous)
	assert.Equal(t, "v1", status.Previous.Version)
}

func TestUpgradeWaitsForHijackedConnectionOnOldVersion(t *testing.T) {
	env := newTestEnv(t)
	env.start("v1")
	oldPid := env.status().Active.Pid

	_, finishHold := env.openStream("/hold?chunks=20")
	code, body := env.requestUpgrade(env.download("v2", false))
	require.Equal(t, http.StatusOK, code, body)
	require.Eventually(t, func() bool { return env.servedVersion() == "v2" }, 10*time.Second, 50*time.Millisecond)

	lines, err := finishHold()
	require.NoError(t, err)
	assert.Equal(t, 20, lines, "the hijacked connection is not cut by the switch")
	assert.Eventually(t, func() bool { return !processAlive(oldPid) }, 10*time.Second, 50*time.Millisecond)
}

func TestFailedUpgradeLeavesOldVersionServing(t *testing.T) {
	tests := []struct {
		name    string
		release func(env *testEnv) Release
		message string
	}{
		{
			name:    "new version crashes on start",
			release: func(env *testEnv) Release { return env.download("v2", true) },
			message: "exited before it started serving",
		},
		{
			name: "binary reports another version",
			release: func(env *testEnv) Release {
				release := env.download("v3", false)
				release.Version = "v4"
				return release
			},
			message: `reports version "v3" instead of "v4"`,
		},
		{
			name: "binary changed after verification",
			release: func(env *testEnv) Release {
				release := env.download("v2", false)
				release.SHA256 = strings.Repeat("0", 64)
				return release
			},
			message: "does not match its checksum",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newTestEnv(t)
			env.start("v1")

			code, body := env.requestUpgrade(tt.release(env))
			require.Equal(t, http.StatusOK, code, body)

			require.Eventually(t, func() bool { return env.status().Phase == PhaseFailed }, 10*time.Second, 50*time.Millisecond)
			assert.Contains(t, env.status().Error, tt.message)
			assert.Equal(t, "v1", env.servedVersion())
			assert.Equal(t, "v1", env.status().Current.Version)
		})
	}
}

func TestUpgradeRefusesBinaryOutsideUpgradeDirectory(t *testing.T) {
	env := newTestEnv(t)
	env.start("v1")

	outside := env.script("elsewhere", "v2", false)
	code, body := env.requestUpgrade(Release{Version: "v2", Path: outside, SHA256: strings.Repeat("0", 64)})

	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, body, "verified download in the upgrade directory")
	assert.Equal(t, "v1", env.servedVersion())
}

func TestOldVersionIsStoppedAtDrainDeadline(t *testing.T) {
	env := newTestEnv(t, EnvDrainTimeout+"=1")
	env.start("v1")
	oldPid := env.status().Active.Pid

	_, finishStream := env.openStream("/stream?chunks=100")
	code, body := env.requestUpgrade(env.download("v2", false))
	require.Equal(t, http.StatusOK, code, body)

	assert.Eventually(t, func() bool { return !processAlive(oldPid) }, 8*time.Second, 50*time.Millisecond,
		"the old version stops at the drain deadline even with a stream still open")
	lines, _ := finishStream()
	assert.Less(t, lines, 100, "the stream past the deadline is cut")
	assert.Equal(t, "v2", env.servedVersion())
}

func TestRollbackReturnsToPreviousVersion(t *testing.T) {
	env := newTestEnv(t)
	env.start("v1")
	code, body := env.requestUpgrade(env.download("v2", false))
	require.Equal(t, http.StatusOK, code, body)
	require.Eventually(t, func() bool { return env.status().Phase == PhaseSucceeded }, 10*time.Second, 50*time.Millisecond)

	assert.Equal(t, "", env.get("/upgrade?rollback=1"))
	require.Eventually(t, func() bool { return env.servedVersion() == "v1" }, 10*time.Second, 50*time.Millisecond)
	assert.Equal(t, "v1", env.status().Current.Version)
}

func TestRestartKeepsUpgradedVersionUntilImageChanges(t *testing.T) {
	env := newTestEnv(t)
	env.start("v1")
	code, body := env.requestUpgrade(env.download("v2", false))
	require.Equal(t, http.StatusOK, code, body)
	require.Eventually(t, func() bool { return env.status().Phase == PhaseSucceeded }, 10*time.Second, 50*time.Millisecond)

	env.stop()
	env.start("v1")
	assert.Equal(t, "v2", env.servedVersion(), "a restart of the same image keeps the upgraded binary")

	env.stop()
	env.start("v5")
	assert.Equal(t, "v5", env.servedVersion(), "a new image replaces the upgraded binary")
	_, err := os.Stat(filepath.Join(env.dir, "upgrade", "bin", "new-api-v2"))
	assert.True(t, os.IsNotExist(err), "the stale download is removed")
}

func TestStoppingSupervisorStopsEveryWorker(t *testing.T) {
	env := newTestEnv(t)
	env.start("v1")
	_, finishStream := env.openStream("/stream?chunks=200")
	oldPid := env.status().Active.Pid
	code, body := env.requestUpgrade(env.download("v2", false))
	require.Equal(t, http.StatusOK, code, body)
	require.Eventually(t, func() bool { return env.status().Phase == PhaseSucceeded }, 10*time.Second, 50*time.Millisecond)
	newPid := env.status().Active.Pid

	require.NoError(t, env.sup.Process.Signal(syscall.SIGTERM))
	select {
	case <-env.exited:
	case <-time.After(15 * time.Second):
		t.Fatal("the supervisor did not exit")
	}
	_, _ = finishStream()
	assert.Equal(t, 0, env.sup.ProcessState.ExitCode())
	assert.False(t, processAlive(oldPid))
	assert.False(t, processAlive(newPid))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := (&net.Dialer{}).DialContext(ctx, "tcp", env.addr)
	assert.Error(t, err, "nothing listens once the supervisor stopped")
}
