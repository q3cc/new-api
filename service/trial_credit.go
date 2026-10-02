package service

import (
	"context"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

const BillingSourceTrial = "trial"

type TrialFunding struct {
	requestId string
	userId    int
	group     string
	consumed  int
	deferred  bool
}

func (f *TrialFunding) Source() string { return BillingSourceTrial }
func (f *TrialFunding) PreConsume(amount int) error {
	if err := model.ReserveTrialCredit(f.requestId, f.userId, f.group, amount); err != nil {
		return err
	}
	f.consumed = amount
	return nil
}
func (f *TrialFunding) Settle(delta int) error {
	if f.deferred {
		return f.PreConsume(f.consumed + delta)
	}
	_, err := model.FinalizeTrialCredit(f.requestId, f.consumed+delta, false)
	return err
}
func (f *TrialFunding) Refund() error {
	return refundWithRetry(func() error { _, err := model.FinalizeTrialCredit(f.requestId, 0, true); return err })
}
func DeferTrialTaskBilling(info *relaycommon.RelayInfo) {
	if s, ok := info.Billing.(*BillingSession); ok {
		if f, ok := s.funding.(*TrialFunding); ok {
			f.deferred = true
		}
	}
}

func finalizeTrialTaskReservation(ctx context.Context, task *model.Task) {
	if task.PrivateData.BillingSource != BillingSourceTrial || task.Status != model.TaskStatusSuccess {
		return
	}
	if _, err := model.FinalizeTrialCredit(task.PrivateData.TrialRequestId, task.Quota, false); err != nil {
		logger.LogError(ctx, err.Error())
	}
}

func AppendTrialBillingInfo(other *model.LogOther, requestId string) {
	if requestId == "" {
		return
	}
	var r model.TrialCreditReservation
	if err := model.DB.Where("request_id = ?", requestId).First(&r).Error; err != nil {
		return
	}
	other.SetPublic("billing_source", BillingSourceTrial)
	other.SetPublic("trial_quota_deducted", r.TrialCharged)
	other.SetPublic("wallet_quota_deducted", r.WalletCharged)
	other.SetPublic("trial_quota_waived", r.Waived)
}

func RequestAvailableQuota(info *relaycommon.RelayInfo) (int, error) {
	cfg, err := model.ReadTrialCreditConfig()
	if err != nil {
		return 0, err
	}
	if cfg.Group != "" && cfg.Group == info.UsingGroup {
		if !cfg.Enabled {
			return 0, model.ErrTrialInsufficient
		}
		return model.GetTrialCreditBalance(info.UserId)
	}
	return model.GetUserQuota(info.UserId, false)
}
func PreConsumeTrialIfNeeded(c *gin.Context, info *relaycommon.RelayInfo, quota int) error {
	if info.Billing != nil {
		return nil
	}
	cfg, err := model.ReadTrialCreditConfig()
	if err != nil {
		return err
	}
	if cfg.Group == "" || cfg.Group != info.UsingGroup {
		return nil
	}
	returnTrialErr := PreConsumeBilling(c, quota, info)
	if returnTrialErr != nil {
		return returnTrialErr
	}
	return nil
}
func FinalizeMidjourneyTrial(ctx context.Context, task *model.Midjourney) {
	r, err := model.GetMidjourneyTrialReservation(task.Id)
	if err != nil {
		logger.LogError(ctx, err.Error())
		return
	}
	if r == nil {
		return
	}
	if _, err = model.FinalizeTrialCredit(r.RequestId, task.Quota, false); err != nil {
		logger.LogError(ctx, err.Error())
	}
}
