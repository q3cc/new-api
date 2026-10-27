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

const (
	playgroundUploadTickInterval = time.Hour
	playgroundUploadRetention    = 7 * 24 * time.Hour
)

var (
	playgroundUploadTaskOnce    sync.Once
	playgroundUploadTaskRunning atomic.Bool
)

// StartPlaygroundUploadCleanupTask removes playground upload chunks and
// receipts nobody resumed within the retention period, hourly on the master.
func StartPlaygroundUploadCleanupTask() {
	playgroundUploadTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(playgroundUploadTickInterval)
			defer ticker.Stop()
			purgeExpiredPlaygroundUploads()
			for range ticker.C {
				if !playgroundUploadTaskRunning.CompareAndSwap(false, true) {
					continue
				}
				purgeExpiredPlaygroundUploads()
				playgroundUploadTaskRunning.Store(false)
			}
		})
	})
}

func purgeExpiredPlaygroundUploads() {
	purged, err := model.PurgeExpiredPlaygroundUploads(time.Now().Add(-playgroundUploadRetention).Unix())
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("playground upload cleanup failed: %v", err))
		return
	}
	if purged > 0 {
		logger.LogInfo(context.Background(), common.LogText("playground upload cleanup removed %d expired chunks", purged))
	}
}
