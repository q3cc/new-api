package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const lotteryTickInterval = 1 * time.Minute

var (
	lotteryTaskOnce    sync.Once
	lotteryTaskRunning atomic.Bool
)

// StartLotteryDrawTask draws due lottery activities every minute on the
// master node.
func StartLotteryDrawTask() {
	lotteryTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(lotteryTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				if !lotteryTaskRunning.CompareAndSwap(false, true) {
					continue
				}
				if err := model.RunDueLotteryDraws(); err != nil {
					logger.LogWarn(context.Background(), common.LogText("lottery draw task failed: %v", err))
				}
				lotteryTaskRunning.Store(false)
			}
		})
	})
}
