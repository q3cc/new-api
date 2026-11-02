package common

import (
	"context"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Environment variables that tell a process it was started by the hot-upgrade
// supervisor, and which generation of worker it is (1 for the first worker
// of a container, then +1 for every upgrade).
const (
	EnvUpgradeWorker           = "NEW_API_WORKER"
	EnvUpgradeWorkerGeneration = "NEW_API_WORKER_GEN"
)

var (
	draining     atomic.Bool
	drainHooksMu sync.Mutex
	drainHookSeq uint64
	drainHooks   = map[uint64]func(){}

	openConnections atomic.Int64
	backgroundWork  atomic.Int64
)

// UpgradeWorkerGeneration returns this process's worker generation under the
// hot-upgrade supervisor, or 0 when it runs on its own.
func UpgradeWorkerGeneration() int {
	if os.Getenv(EnvUpgradeWorker) != "1" {
		return 0
	}
	generation, err := strconv.Atoi(os.Getenv(EnvUpgradeWorkerGeneration))
	if err != nil || generation < 1 {
		return 1
	}
	return generation
}

// StartedByUpgrade reports whether this process replaced an older worker that
// may still be finishing its connections against the same database.
func StartedByUpgrade() bool {
	return UpgradeWorkerGeneration() > 1
}

// StartDraining marks the process as shutting down: background loops stop
// starting new rounds and long-lived connections that are between requests
// are closed so their clients reconnect to the new worker.
func StartDraining() {
	if draining.Swap(true) {
		return
	}
	drainHooksMu.Lock()
	hooks := make([]func(), 0, len(drainHooks))
	for _, hook := range drainHooks {
		hooks = append(hooks, hook)
	}
	drainHooksMu.Unlock()
	for _, hook := range hooks {
		hook()
	}
}

// IsDraining reports whether StartDraining has been called.
func IsDraining() bool {
	return draining.Load()
}

// RunsBackgroundTasks reports whether master-only background loops should run
// another round: on the master node, and not while the process is draining.
func RunsBackgroundTasks() bool {
	return IsMasterNode && !IsDraining()
}

// OnDrain runs hook when draining starts, or right away if it already has.
// The returned function removes the hook.
func OnDrain(hook func()) func() {
	drainHooksMu.Lock()
	if draining.Load() {
		drainHooksMu.Unlock()
		hook()
		return func() {}
	}
	drainHookSeq++
	id := drainHookSeq
	drainHooks[id] = hook
	drainHooksMu.Unlock()
	return func() {
		drainHooksMu.Lock()
		delete(drainHooks, id)
		drainHooksMu.Unlock()
	}
}

// TrackConnection counts a hijacked connection (a WebSocket) that
// http.Server.Shutdown does not wait for. Call the returned function once the
// connection's handler is done.
func TrackConnection() func() {
	openConnections.Add(1)
	var once sync.Once
	return func() {
		once.Do(func() { openConnections.Add(-1) })
	}
}

// OpenConnections returns the number of tracked hijacked connections.
func OpenConnections() int {
	return int(openConnections.Load())
}

// BeginBackgroundWork counts work that outlives the request that started it,
// such as a quota refund or a background task round, so shutdown can wait for
// it. Call the returned function when the work is done.
func BeginBackgroundWork() func() {
	backgroundWork.Add(1)
	var once sync.Once
	return func() {
		once.Do(func() { backgroundWork.Add(-1) })
	}
}

// WaitConnections waits until every tracked connection has finished or ctx
// ends.
func WaitConnections(ctx context.Context) error {
	return waitForZero(ctx, &openConnections)
}

// WaitBackgroundWork waits until every counted background work item has
// finished or ctx ends.
func WaitBackgroundWork(ctx context.Context) error {
	return waitForZero(ctx, &backgroundWork)
}

func waitForZero(ctx context.Context, counter *atomic.Int64) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for counter.Load() > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
	return nil
}
