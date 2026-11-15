package service

import (
	"context"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	playgroundArchiveFirstDelay   = 5 * time.Minute
	playgroundArchiveTickInterval = time.Hour
	// Each round examines at most this many conversations; the rest wait for
	// the next round.
	playgroundArchiveRoundLimit = 2000
)

var playgroundArchiveTaskOnce sync.Once

// StartPlaygroundArchiveTask stores the documents of playground
// conversations nobody opened or changed for a week compressed, hourly on the
// master. The first round waits a few minutes so startup stays quick.
func StartPlaygroundArchiveTask() {
	playgroundArchiveTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			timer := time.NewTimer(playgroundArchiveFirstDelay)
			defer timer.Stop()
			// One loop runs the rounds, so they never overlap.
			for range timer.C {
				if !runBackgroundRound(archiveColdPlaygroundConversations) {
					return
				}
				timer.Reset(playgroundArchiveTickInterval)
			}
		})
	})
}

func archiveColdPlaygroundConversations() {
	archived, err := model.ArchiveColdPlaygroundConversations(time.Now(), playgroundArchiveRoundLimit)
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("playground archive failed after %d conversations: %v", archived, err))
		return
	}
	if archived > 0 {
		logger.LogInfo(context.Background(), common.LogText("playground archive compressed %d conversations", archived))
	}
}
