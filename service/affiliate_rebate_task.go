package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	affiliateRebateTickInterval = 5 * time.Minute
	affiliateRebateBatchSize    = 100
)

var (
	affiliateRebateTaskOnce    sync.Once
	affiliateRebateTaskRunning atomic.Bool
)

// StartAffiliateRebateTask settles referral rebates whose confirmation period
// has ended, every few minutes on the master node.
func StartAffiliateRebateTask() {
	affiliateRebateTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(affiliateRebateTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				if !affiliateRebateTaskRunning.CompareAndSwap(false, true) {
					continue
				}
				SettleDueAffiliateRebates(common.GetTimestamp())
				affiliateRebateTaskRunning.Store(false)
			}
		})
	})
}

// SettleDueAffiliateRebates settles every rebate due at now. Before a rebate
// is credited, its inviter and invitee are checked for a shared IP once more,
// so a rebate is never paid between two rounds of the hourly invitation check.
func SettleDueAffiliateRebates(now int64) {
	ctx := context.Background()
	setting := *operation_setting.GetAffiliateRebateSetting()
	window := userRiskWindowSeconds(*operation_setting.GetUserRiskSetting())
	lastId := 0
	for {
		rebates, err := model.ListDueAffiliateRebates(now, affiliateRebateBatchSize)
		if err != nil {
			logger.LogWarn(ctx, common.LogText("affiliate rebate task failed to list rebates: %v", err))
			return
		}
		// Every listed rebate leaves the pending state below unless settling
		// it fails; stop rather than retry the same failing batch forever.
		if len(rebates) == 0 || rebates[len(rebates)-1].Id == lastId {
			return
		}
		lastId = rebates[len(rebates)-1].Id
		for _, rebate := range rebates {
			if setting.CancelSharedIp && holdRebateForSharedIp(ctx, rebate, now-window) {
				continue
			}
			if err := model.SettleAffiliateRebate(rebate.Id, setting.RiskReviewScore); err != nil {
				logger.LogWarn(ctx, common.LogText("failed to settle affiliate rebate %d: %v", rebate.Id, err))
			}
		}
		if len(rebates) < affiliateRebateBatchSize {
			return
		}
	}
}

// holdRebateForSharedIp reports whether a rebate must not be settled now:
// its inviter and invitee share an IP, which cancels the invitation and
// rejects the rebate, or the check could not be completed.
func holdRebateForSharedIp(ctx context.Context, rebate model.AffiliateRebate, since int64) bool {
	invites, err := model.ListCheckableAffiliateInvites(rebate.InviteeId)
	if err != nil {
		logger.LogWarn(ctx, common.LogText("affiliate rebate task failed to list invitations: %v", err))
		return true
	}
	if len(invites) == 0 || invites[0].InviterId != rebate.InviterId {
		return false
	}
	pairs, err := model.ListUserIpPairsForUsers([]int{rebate.InviterId, rebate.InviteeId}, since)
	if err != nil {
		logger.LogWarn(ctx, common.LogText("affiliate rebate task failed to list IPs: %v", err))
		return true
	}
	matches := FindSharedIpInvites(pairs, invites)
	cancelSharedIpInvites(ctx, matches)
	return len(matches) > 0
}
