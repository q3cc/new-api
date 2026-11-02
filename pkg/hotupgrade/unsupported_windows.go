//go:build windows

package hotupgrade

import (
	"context"
	"errors"
	"net"
	"time"
)

var errUnsupported = errors.New("hot upgrade is not supported on Windows")

// SupervisorConfig describes how the supervisor runs its workers.
type SupervisorConfig struct {
	Addr         string
	ImageBinary  string
	ImageVersion string
	Args         []string
	Env          []string
	ReadyTimeout time.Duration
	DrainTimeout time.Duration
	Logf         func(format string, args ...any)
}

// RunSupervisor is not available on Windows.
func RunSupervisor(SupervisorConfig) error { return errUnsupported }

// Worker is never available on Windows.
type Worker struct{}

// Current always returns nil on Windows.
func Current() *Worker { return nil }

func (*Worker) Listener() (net.Listener, error)               { return nil, errUnsupported }
func (*Worker) Ready() error                                  { return errUnsupported }
func (*Worker) ReportConnections(int) error                   { return errUnsupported }
func (*Worker) RequestUpgrade(context.Context, Release) error { return errUnsupported }
func (*Worker) RequestRollback(context.Context) error         { return errUnsupported }
