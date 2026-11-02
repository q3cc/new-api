//go:build windows

package hotupgrade

import (
	"os"
	"syscall"
)

func stopSignals() []os.Signal {
	return []os.Signal{syscall.SIGINT, syscall.SIGTERM}
}

func isDrainSignal(os.Signal) bool {
	return false
}
