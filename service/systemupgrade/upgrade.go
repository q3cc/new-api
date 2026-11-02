package systemupgrade

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/hotupgrade"
	"github.com/QuantumNous/new-api/service"
)

// Phases of an upgrade before the supervisor takes over.
const (
	PhaseDownloading = "downloading"
	PhaseHandingOver = "handing_over"
	PhaseHandedOver  = "handed_over"
	PhaseFailed      = "failed"
)

// EnvCheckInterval sets how often to look for a new release, in minutes; 0
// turns the automatic check off. The default is hourly.
const EnvCheckInterval = "UPDATE_CHECK_INTERVAL_MINUTES"

// ErrNotSupervised means the server does not run under the hot-upgrade
// supervisor, so it cannot replace itself.
var ErrNotSupervised = common.NewMessage("Online upgrade needs HOT_UPGRADE_ENABLED=true. Recreate the container once with it set.")

// Messages the web console translates.
var (
	errUpgradeRunning = common.NewMessage("An upgrade is already in progress.")
	errUnknownRelease = common.NewMessage("This version is not among the published releases. Check for updates first.")
	errAlreadyRunning = common.NewMessage("This version is already running.")
)

// CheckResult is the outcome of the latest release check.
type CheckResult struct {
	Latest    *Release `json:"latest,omitempty"`
	HasUpdate bool     `json:"has_update"`
	CheckedAt int64    `json:"checked_at"`
	Error     string   `json:"error,omitempty"`

	releases []Release
}

// Progress is this worker's part of an upgrade: downloading and verifying the
// binary, then handing it to the supervisor.
type Progress struct {
	Phase      string `json:"phase,omitempty"`
	Version    string `json:"version,omitempty"`
	Error      string `json:"error,omitempty"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}

var (
	mu        sync.Mutex
	lastCheck CheckResult
	progress  Progress
	applying  bool
	checkOnce sync.Once
)

func httpClient() (*http.Client, error) {
	return service.GetHttpClientWithProxy("")
}

// Supervised reports whether this server can upgrade itself.
func Supervised() bool {
	return hotupgrade.Current() != nil
}

// CheckNow looks for the newest release and remembers the result.
func CheckNow(ctx context.Context) CheckResult {
	result := CheckResult{CheckedAt: time.Now().Unix()}
	client, err := httpClient()
	if err == nil {
		ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		result.releases, err = fetchReleases(ctx, client)
	}
	if err != nil {
		result.Error = err.Error()
	} else if len(result.releases) > 0 {
		latest := result.releases[0]
		result.Latest = &latest
		result.HasUpdate = newerThan(latest, common.Version, result.releases)
	}
	mu.Lock()
	// A failed check keeps the release found earlier, with the error beside it.
	if result.Error != "" && lastCheck.Latest != nil {
		result.Latest, result.HasUpdate, result.releases = lastCheck.Latest, lastCheck.HasUpdate, lastCheck.releases
	}
	lastCheck = result
	mu.Unlock()
	return result
}

// LastCheck returns the latest check's result.
func LastCheck() CheckResult {
	mu.Lock()
	defer mu.Unlock()
	return lastCheck
}

// CurrentProgress returns this worker's upgrade progress.
func CurrentProgress() Progress {
	mu.Lock()
	defer mu.Unlock()
	return progress
}

// StartCheckTask checks for a new release shortly after start and then on the
// configured interval, until the process starts draining.
func StartCheckTask() {
	checkOnce.Do(func() {
		minutes, err := strconv.Atoi(os.Getenv(EnvCheckInterval))
		if err != nil || minutes < 0 {
			minutes = 60
		}
		if minutes == 0 {
			return
		}
		go func() {
			timer := time.NewTimer(30 * time.Second)
			defer timer.Stop()
			for range timer.C {
				if common.IsDraining() {
					return
				}
				CheckNow(context.Background())
				timer.Reset(time.Duration(minutes) * time.Minute)
			}
		}()
	})
}

// Apply downloads and verifies version, then asks the supervisor to switch to
// it. It returns once the download started; CurrentProgress and the
// supervisor's status report the rest.
func Apply(version string) error {
	worker := hotupgrade.Current()
	if worker == nil {
		return ErrNotSupervised
	}
	mu.Lock()
	defer mu.Unlock()
	if applying {
		return errUpgradeRunning
	}
	var target *Release
	for i := range lastCheck.releases {
		if lastCheck.releases[i].Version == version {
			target = &lastCheck.releases[i]
		}
	}
	if target == nil {
		return errUnknownRelease
	}
	if version == common.Version {
		return errAlreadyRunning
	}
	applying = true
	progress = Progress{Phase: PhaseDownloading, Version: version}
	release := *target
	go func() {
		err := install(worker, release)
		mu.Lock()
		defer mu.Unlock()
		applying = false
		if err != nil {
			progress.Phase = PhaseFailed
			progress.Error = err.Error()
			common.SysError(common.LogText("online upgrade to %s failed: %s", release.Version, err.Error()))
			return
		}
		progress.Phase = PhaseHandedOver
	}()
	return nil
}

func install(worker *hotupgrade.Worker, release Release) error {
	client, err := httpClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	path, sum, err := downloadVerified(ctx, client, release, hotupgrade.BinaryDir(), func(done, total int64) {
		mu.Lock()
		progress.Downloaded, progress.Total = done, total
		mu.Unlock()
	})
	if err != nil {
		return err
	}
	mu.Lock()
	progress.Phase = PhaseHandingOver
	mu.Unlock()
	requestCtx, requestCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer requestCancel()
	return worker.RequestUpgrade(requestCtx, hotupgrade.Release{Version: release.Version, Path: path, SHA256: sum})
}

// Rollback asks the supervisor to switch back to the previous version.
func Rollback(ctx context.Context) error {
	worker := hotupgrade.Current()
	if worker == nil {
		return ErrNotSupervised
	}
	mu.Lock()
	busy := applying
	mu.Unlock()
	if busy {
		return errUpgradeRunning
	}
	return worker.RequestRollback(ctx)
}
