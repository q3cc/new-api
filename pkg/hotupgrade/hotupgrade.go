// Package hotupgrade swaps the running new-api binary inside one container
// without dropping connections.
//
// With HOT_UPGRADE_ENABLED=true the container's first process becomes a small
// supervisor. It owns the listening socket and runs the real server as a
// worker process. To upgrade, the worker downloads a verified binary and asks
// the supervisor to switch: the supervisor starts a worker from the new binary
// on the same socket, waits until it serves, then tells the old worker to
// drain. The old worker stops accepting, finishes its in-flight requests,
// streams and WebSockets, flushes its in-memory state and exits.
package hotupgrade

import (
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// Settings read from the environment.
const (
	EnvEnabled      = "HOT_UPGRADE_ENABLED"
	EnvDir          = "HOT_UPGRADE_DIR"
	EnvReadyTimeout = "HOT_UPGRADE_READY_TIMEOUT"
	EnvDrainTimeout = "HOT_UPGRADE_DRAIN_TIMEOUT"
)

// File descriptors the supervisor hands to every worker.
const (
	listenerFD = 3
	controlFD  = 4
)

// Phases of the latest upgrade, as shown to administrators.
const (
	PhaseIdle      = "idle"
	PhaseStarting  = "starting"
	PhaseSucceeded = "succeeded"
	PhaseFailed    = "failed"
)

// Release is one binary the supervisor can run.
type Release struct {
	Version string `json:"version"`
	Path    string `json:"path"`
	SHA256  string `json:"sha256,omitempty"`
}

// WorkerInfo describes one running worker process.
type WorkerInfo struct {
	Generation    int    `json:"generation"`
	Pid           int    `json:"pid"`
	Version       string `json:"version"`
	StartedAt     int64  `json:"started_at"`
	DrainingSince int64  `json:"draining_since,omitempty"`
	Connections   int    `json:"connections"`
}

// Status is what the supervisor writes to status.json for workers to report.
type Status struct {
	Phase         string       `json:"phase"`
	TargetVersion string       `json:"target_version,omitempty"`
	Error         string       `json:"error,omitempty"`
	UpdatedAt     int64        `json:"updated_at"`
	Active        *WorkerInfo  `json:"active,omitempty"`
	Draining      []WorkerInfo `json:"draining"`
	Current       Release      `json:"current"`
	Previous      *Release     `json:"previous,omitempty"`
}

// SupervisorRequested reports whether this process should run as the
// supervisor rather than serve requests itself.
func SupervisorRequested() bool {
	return os.Getenv(EnvEnabled) == "true" && os.Getenv(common.EnvUpgradeWorker) == ""
}

// Dir is where binaries, state.json and status.json live; by default
// ./upgrade under the working directory, which is the /data volume in Docker.
func Dir() string {
	dir := os.Getenv(EnvDir)
	if dir == "" {
		dir = "upgrade"
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return dir
	}
	return abs
}

// BinaryDir is where downloaded binaries are kept.
func BinaryDir() string {
	return filepath.Join(Dir(), "bin")
}

// DrainTimeout is how long an old worker may keep serving its connections
// after an upgrade; 2 hours unless HOT_UPGRADE_DRAIN_TIMEOUT says otherwise.
func DrainTimeout() time.Duration {
	return envSeconds(EnvDrainTimeout, 2*time.Hour)
}

// ReadyTimeout is how long a new worker may take to start serving, database
// migrations included.
func ReadyTimeout() time.Duration {
	return envSeconds(EnvReadyTimeout, 5*time.Minute)
}

func envSeconds(name string, fallback time.Duration) time.Duration {
	seconds, err := strconv.Atoi(os.Getenv(name))
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

// ReadStatus returns the supervisor's latest status.
func ReadStatus() (Status, error) {
	var status Status
	data, err := os.ReadFile(filepath.Join(Dir(), "status.json"))
	if err != nil {
		return status, err
	}
	err = common.Unmarshal(data, &status)
	return status, err
}

// writeJSONFile replaces path atomically so readers never see half a file.
func writeJSONFile(path string, value any) error {
	data, err := common.Marshal(value)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// message is one line on the control channel between a worker and the
// supervisor.
type message struct {
	Type    string `json:"type"`
	Version string `json:"version,omitempty"`
	Path    string `json:"path,omitempty"`
	SHA256  string `json:"sha256,omitempty"`
	Count   int    `json:"count,omitempty"`
	Error   string `json:"error,omitempty"`
}

const (
	messageReady       = "ready"
	messageUpgrade     = "upgrade"
	messageRollback    = "rollback"
	messageConnections = "connections"
	messageReply       = "reply"
)
