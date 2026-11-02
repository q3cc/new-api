//go:build !windows

package hotupgrade

import (
	"os"
	"syscall"
)

func stopSignals() []os.Signal {
	return []os.Signal{syscall.SIGINT, syscall.SIGTERM, syscall.SIGUSR2}
}

func isDrainSignal(sig os.Signal) bool {
	return sig == syscall.SIGUSR2
}
