package hotupgrade

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// ServeOptions configures Serve.
type ServeOptions struct {
	Server *http.Server
	// ShutdownTimeout bounds a normal stop (SIGTERM, SIGINT).
	ShutdownTimeout time.Duration
	// DrainTimeout bounds an upgrade drain (SIGUSR2 from the supervisor).
	DrainTimeout time.Duration
	// SettleTimeout is how long requests cut off at the deadline get to
	// settle their charges; 30 seconds when zero.
	SettleTimeout time.Duration
	// Started runs once the server accepts connections.
	Started func()
	// Finish runs after requests, connections and background work are done,
	// or the deadline passed, to save in-memory state before exit.
	Finish func()
	Logf   func(format string, args ...any)
}

// Serve runs the server until it is told to stop, then drains it. Under the
// supervisor it serves the shared socket and reports readiness and remaining
// connections; on its own it listens on Server.Addr as before. Connections
// still open at the deadline are closed, and their requests get SettleTimeout
// to settle what they used before the process exits.
func Serve(opts ServeOptions) error {
	worker := Current()
	counter := &ConnCounter{}
	opts.Server.ConnState = counter.Hook
	// Requests whose handler has not returned, WebSockets included: a cut-off
	// request still has its charge to settle after its connection is closed.
	var running atomic.Int64
	handler := opts.Server.Handler
	opts.Server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		running.Add(1)
		defer running.Add(-1)
		handler.ServeHTTP(w, r)
	})

	var ln net.Listener
	var err error
	if worker != nil {
		ln, err = worker.Listener()
	} else {
		ln, err = net.Listen("tcp", opts.Server.Addr)
	}
	if err != nil {
		return err
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, stopSignals()...)
	defer signal.Stop(signals)

	serveErr := make(chan error, 1)
	go func() { serveErr <- opts.Server.Serve(ln) }()
	if worker != nil {
		if err := worker.Ready(); err != nil {
			opts.Logf("failed to tell the supervisor this worker is serving: %v", err)
		}
	}
	if opts.Started != nil {
		opts.Started()
	}

	var sig os.Signal
	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case sig = <-signals:
	}

	timeout := opts.ShutdownTimeout
	if isDrainSignal(sig) {
		timeout = opts.DrainTimeout
	}
	opts.Logf("received signal %v, finishing open connections (up to %s)", sig, timeout)
	common.StartDraining()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	// A docker stop during a long upgrade drain shortens it to a normal stop.
	go func() {
		for {
			select {
			case next := <-signals:
				if !isDrainSignal(next) {
					opts.Logf("received signal %v, stopping within %s", next, opts.ShutdownTimeout)
					time.AfterFunc(opts.ShutdownTimeout, cancel)
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	if worker != nil {
		stopReports := reportConnections(worker, counter)
		defer stopReports()
	}
	shutdownErr := opts.Server.Shutdown(ctx)
	if shutdownErr != nil || common.WaitConnections(ctx) != nil {
		opts.Logf("%d requests still running at the deadline; closing their connections and settling their charges", running.Load())
		common.StartForcedClose()
		_ = opts.Server.Close()
		settleTimeout := opts.SettleTimeout
		if settleTimeout <= 0 {
			settleTimeout = 30 * time.Second
		}
		settleDeadline := time.Now().Add(settleTimeout)
		for running.Load() > 0 && time.Now().Before(settleDeadline) {
			time.Sleep(50 * time.Millisecond)
		}
		if left := running.Load(); left > 0 {
			opts.Logf("%d requests did not settle within %s", left, settleTimeout)
		}
	}
	// Work started by finished requests, such as quota refunds, and running
	// background tasks get at least a short grace period, even when the
	// deadline has passed.
	waitCtx := ctx
	if deadline, _ := ctx.Deadline(); ctx.Err() != nil || time.Until(deadline) < 30*time.Second {
		graceCtx, graceCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer graceCancel()
		waitCtx = graceCtx
	}
	if err := common.WaitBackgroundWork(waitCtx); err != nil {
		opts.Logf("background work still running at exit: %v", err)
	}
	if opts.Finish != nil {
		opts.Finish()
	}
	return nil
}

func reportConnections(worker *Worker, counter *ConnCounter) func() {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			_ = worker.ReportConnections(counter.Busy() + common.OpenConnections())
			select {
			case <-done:
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { close(done) }
}
