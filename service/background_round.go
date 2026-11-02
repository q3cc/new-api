package service

import "github.com/QuantumNous/new-api/common"

// runBackgroundRound runs one round of a master-only background task, counted
// so shutdown waits for it. Once the process is draining it runs nothing and
// returns false, telling the loop to stop: the worker that replaced this one
// runs the task from then on.
func runBackgroundRound(round func()) bool {
	if common.IsDraining() {
		return false
	}
	done := common.BeginBackgroundWork()
	defer done()
	round()
	return true
}
