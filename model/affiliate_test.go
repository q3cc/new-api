package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAffiliateFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&AffiliateRebate{}, &AffiliateInviteLog{}, &UserRiskScore{}))
	previousRebate := *operation_setting.GetAffiliateRebateSetting()
	previousPayment := *operation_setting.GetPaymentSetting()
	*operation_setting.GetAffiliateRebateSetting() = operation_setting.AffiliateRebateSetting{
		Enabled: true, RatePercent: 10, ConfirmDays: 7, RiskReviewScore: 50, CancelSharedIp: true,
	}
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	clear := func() {
		for _, table := range []any{&AffiliateRebate{}, &AffiliateInviteLog{}, &UserRiskScore{}, &TopUp{}, &SubscriptionOrder{}, &UserSubscription{}, &SubscriptionPlan{}, &User{}, &Log{}} {
			// A fresh session per table: a reused one keeps the first table.
			require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(table).Error)
		}
	}
	clear()
	t.Cleanup(func() {
		clear()
		*operation_setting.GetAffiliateRebateSetting() = previousRebate
		*operation_setting.GetPaymentSetting() = previousPayment
	})
}

// createInvitedPair creates an inviter that has invited one user.
func createInvitedPair(t *testing.T) (inviterId int, inviteeId int) {
	t.Helper()
	inviter := &User{Username: "aff_inviter", Password: "password", Status: common.UserStatusEnabled, AffCode: "aff_inviter", AffCount: 1}
	require.NoError(t, DB.Create(inviter).Error)
	invitee := &User{Username: "aff_invitee", Password: "password", Status: common.UserStatusEnabled, AffCode: "aff_invitee", InviterId: inviter.Id}
	require.NoError(t, DB.Create(invitee).Error)
	return inviter.Id, invitee.Id
}

func userAffiliate(t *testing.T, userId int) User {
	t.Helper()
	var user User
	require.NoError(t, DB.Unscoped().First(&user, userId).Error)
	return user
}

func userRebates(t *testing.T, inviteeId int) []AffiliateRebate {
	t.Helper()
	var rebates []AffiliateRebate
	require.NoError(t, DB.Where("invitee_id = ?", inviteeId).Order("id").Find(&rebates).Error)
	return rebates
}

func TestPaidOrdersRecordAffiliateRebates(t *testing.T) {
	unit := int(common.QuotaPerUnit)
	tests := []struct {
		name       string
		disabled   bool
		uninvited  bool
		pay        func(t *testing.T, userId int)
		wantSource string
		wantBase   int
	}{
		{
			name: "manually completed top-up",
			pay: func(t *testing.T, userId int) {
				require.NoError(t, DB.Create(&TopUp{UserId: userId, Amount: 10, Money: 73, TradeNo: "aff-manual", PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}).Error)
				require.NoError(t, ManualCompleteTopUp("aff-manual", ""))
				// A repeated completion neither fails nor records a second rebate.
				require.NoError(t, ManualCompleteTopUp("aff-manual", ""))
			},
			wantSource: AffiliateRebateSourceTopUp, wantBase: 10 * unit,
		},
		{
			name: "provider top-up",
			pay: func(t *testing.T, userId int) {
				require.NoError(t, DB.Create(&TopUp{UserId: userId, Amount: 4, Money: 4, TradeNo: "aff-waffo", PaymentMethod: PaymentMethodWaffo, PaymentProvider: PaymentProviderWaffo, Status: common.TopUpStatusPending}).Error)
				require.NoError(t, RechargeWaffo("aff-waffo", ""))
			},
			wantSource: AffiliateRebateSourceTopUp, wantBase: 4 * unit,
		},
		{
			name: "subscription order counts the plan price once",
			pay: func(t *testing.T, userId int) {
				plan := &SubscriptionPlan{Title: "Aff Plan", PriceAmount: 20, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true}
				require.NoError(t, DB.Create(plan).Error)
				require.NoError(t, DB.Create(&SubscriptionOrder{UserId: userId, PlanId: plan.Id, Money: 20, TradeNo: "aff-sub", PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}).Error)
				require.NoError(t, ManualCompleteTopUp("aff-sub", ""))
			},
			wantSource: AffiliateRebateSourceSubscription, wantBase: 20 * unit,
		},
		{
			name: "subscription paid with balance earns nothing",
			pay: func(t *testing.T, userId int) {
				plan := &SubscriptionPlan{Title: "Aff Plan", PriceAmount: 1, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true}
				require.NoError(t, DB.Create(plan).Error)
				require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("quota", 2*unit).Error)
				require.NoError(t, PurchaseSubscriptionWithBalance(userId, plan.Id))
			},
		},
		{
			name:      "uninvited payer earns nobody a rebate",
			uninvited: true,
			pay: func(t *testing.T, userId int) {
				require.NoError(t, DB.Create(&TopUp{UserId: userId, Amount: 10, Money: 10, TradeNo: "aff-uninvited", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}).Error)
				require.NoError(t, ManualCompleteTopUp("aff-uninvited", ""))
			},
		},
		{
			name:     "disabled rebates record nothing",
			disabled: true,
			pay: func(t *testing.T, userId int) {
				require.NoError(t, DB.Create(&TopUp{UserId: userId, Amount: 10, Money: 10, TradeNo: "aff-disabled", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}).Error)
				require.NoError(t, ManualCompleteTopUp("aff-disabled", ""))
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupAffiliateFixture(t)
			operation_setting.GetAffiliateRebateSetting().Enabled = !tt.disabled
			inviterId, inviteeId := createInvitedPair(t)
			if tt.uninvited {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviteeId).Update("inviter_id", 0).Error)
			}
			before := common.GetTimestamp()
			tt.pay(t, inviteeId)

			rebates := userRebates(t, inviteeId)
			if tt.wantSource == "" {
				assert.Empty(t, rebates)
				return
			}
			require.Len(t, rebates, 1)
			rebate := rebates[0]
			assert.Equal(t, inviterId, rebate.InviterId)
			assert.Equal(t, tt.wantSource, rebate.Source)
			assert.Equal(t, tt.wantBase, rebate.BaseQuota)
			assert.Equal(t, 1000, rebate.RateBps)
			assert.Equal(t, tt.wantBase/10, rebate.Quota)
			assert.Equal(t, AffiliateRebatePending, rebate.Status)
			assert.InDelta(t, before+7*24*3600, rebate.ConfirmAt, 2)
			assert.Zero(t, userAffiliate(t, inviterId).AffQuota, "nothing is credited before confirmation")
		})
	}
}

func TestCancelAndRestoreAffiliateInvite(t *testing.T) {
	setupAffiliateFixture(t)
	inviterId, inviteeId := createInvitedPair(t)
	for _, status := range []string{AffiliateRebatePending, AffiliateRebateReview, AffiliateRebateConfirmed} {
		require.NoError(t, DB.Create(&AffiliateRebate{InviterId: inviterId, InviteeId: inviteeId, TradeNo: "cancel-" + status, Source: AffiliateRebateSourceTopUp, Quota: 100, Status: status}).Error)
	}

	cancelled, err := CancelAffiliateInvite(inviteeId, inviterId, AffiliateReasonSharedIp, []string{"203.0.113.1", "203.0.113.2"}, 0, "")
	require.NoError(t, err)
	assert.True(t, cancelled)
	assert.Zero(t, userAffiliate(t, inviteeId).InviterId)
	assert.Zero(t, userAffiliate(t, inviterId).AffCount)
	statuses := map[string]AffiliateRebate{}
	for _, rebate := range userRebates(t, inviteeId) {
		statuses[rebate.TradeNo] = rebate
	}
	assert.Equal(t, AffiliateRebateRejected, statuses["cancel-pending"].Status)
	assert.Equal(t, AffiliateReasonSharedIp, statuses["cancel-pending"].Reason)
	assert.Equal(t, AffiliateRebateRejected, statuses["cancel-review"].Status)
	assert.Equal(t, AffiliateRebateConfirmed, statuses["cancel-confirmed"].Status, "credited rebates are kept")

	var logs []AffiliateInviteLog
	require.NoError(t, DB.Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, AffiliateInviteActionCancel, logs[0].Action)
	assert.Equal(t, "203.0.113.1,203.0.113.2", logs[0].SharedIps)

	cancelled, err = CancelAffiliateInvite(inviteeId, inviterId, AffiliateReasonSharedIp, nil, 0, "")
	require.NoError(t, err)
	assert.False(t, cancelled, "an invitation is cancelled once")
	restorable, err := RestorableAffiliateInviteLogIds(logs)
	require.NoError(t, err)
	assert.Equal(t, map[int]bool{logs[0].Id: true}, restorable)

	require.NoError(t, RestoreAffiliateInvite(logs[0].Id, 1, "same household"))
	assert.Equal(t, inviterId, userAffiliate(t, inviteeId).InviterId)
	assert.Equal(t, 1, userAffiliate(t, inviterId).AffCount)
	assert.Equal(t, AffiliateRebateRejected, userRebates(t, inviteeId)[0].Status, "rejected rebates stay rejected")
	checkable, err := ListCheckableAffiliateInvites()
	require.NoError(t, err)
	assert.Empty(t, checkable, "a restored invitation is exempt from the shared-IP check")
	assert.Error(t, RestoreAffiliateInvite(logs[0].Id, 1, ""), "an active invitation cannot be restored again")
	require.NoError(t, DB.Order("id").Find(&logs).Error)
	restorable, err = RestorableAffiliateInviteLogIds(logs)
	require.NoError(t, err)
	assert.Empty(t, restorable, "a cancellation followed by a restore is no longer restorable")
}

func TestSettleAffiliateRebate(t *testing.T) {
	tests := []struct {
		name       string
		prepare    func(t *testing.T, inviterId, inviteeId int)
		wantStatus string
		wantReason string
		wantRisk   int
	}{
		{name: "low risk is credited", wantStatus: AffiliateRebateConfirmed},
		{
			name: "high invitee risk goes to review",
			prepare: func(t *testing.T, _, inviteeId int) {
				require.NoError(t, DB.Create(&UserRiskScore{UserId: inviteeId, Score: 80}).Error)
			},
			wantStatus: AffiliateRebateReview, wantReason: AffiliateReasonRiskScore, wantRisk: 80,
		},
		{
			name: "disabled invitee goes to review",
			prepare: func(t *testing.T, _, inviteeId int) {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviteeId).Update("status", common.UserStatusDisabled).Error)
			},
			wantStatus: AffiliateRebateReview, wantReason: AffiliateReasonUserUnavailable,
		},
		{
			name: "deleted inviter goes to review",
			prepare: func(t *testing.T, inviterId, _ int) {
				require.NoError(t, DB.Delete(&User{}, inviterId).Error)
			},
			wantStatus: AffiliateRebateReview, wantReason: AffiliateReasonUserUnavailable,
		},
		{
			name: "invitation no longer current is rejected",
			prepare: func(t *testing.T, _, inviteeId int) {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviteeId).Update("inviter_id", 0).Error)
			},
			wantStatus: AffiliateRebateRejected, wantReason: AffiliateReasonInviteNotCurrent,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupAffiliateFixture(t)
			inviterId, inviteeId := createInvitedPair(t)
			rebate := &AffiliateRebate{InviterId: inviterId, InviteeId: inviteeId, TradeNo: "settle", Source: AffiliateRebateSourceTopUp, Quota: 300, Status: AffiliateRebatePending, ConfirmAt: 100}
			require.NoError(t, DB.Create(rebate).Error)
			if tt.prepare != nil {
				tt.prepare(t, inviterId, inviteeId)
			}

			require.NoError(t, SettleAffiliateRebate(rebate.Id, 50))
			got := userRebates(t, inviteeId)[0]
			assert.Equal(t, tt.wantStatus, got.Status)
			assert.Equal(t, tt.wantReason, got.Reason)
			assert.Equal(t, tt.wantRisk, got.RiskScore)
			inviter := userAffiliate(t, inviterId)
			if tt.wantStatus == AffiliateRebateConfirmed {
				assert.Equal(t, 300, inviter.AffQuota)
				assert.Equal(t, 300, inviter.AffHistoryQuota)
				assert.NotZero(t, got.ConfirmedAt)
			} else {
				assert.Zero(t, inviter.AffQuota)
			}
		})
	}
}

func TestReviewAffiliateRebate(t *testing.T) {
	setupAffiliateFixture(t)
	inviterId, inviteeId := createInvitedPair(t)
	review := &AffiliateRebate{InviterId: inviterId, InviteeId: inviteeId, TradeNo: "review", Source: AffiliateRebateSourceTopUp, Quota: 200, Status: AffiliateRebateReview}
	pending := &AffiliateRebate{InviterId: inviterId, InviteeId: inviteeId, TradeNo: "pending", Source: AffiliateRebateSourceTopUp, Quota: 500, Status: AffiliateRebatePending, ConfirmAt: common.GetTimestamp() + 3600}
	require.NoError(t, DB.Create(review).Error)
	require.NoError(t, DB.Create(pending).Error)

	assert.Error(t, ApproveAffiliateRebate(pending.Id, 1, ""), "a rebate in its confirmation period cannot be approved")
	require.NoError(t, ApproveAffiliateRebate(review.Id, 1, "checked"))
	assert.Error(t, ApproveAffiliateRebate(review.Id, 1, ""), "a rebate is credited once")
	assert.Equal(t, 200, userAffiliate(t, inviterId).AffQuota)
	assert.Error(t, RejectAffiliateRebate(review.Id, 1, ""), "a credited rebate cannot be rejected")

	require.NoError(t, RejectAffiliateRebate(pending.Id, 1, "fraud"))
	assert.Equal(t, 200, userAffiliate(t, inviterId).AffQuota)
	var rejected AffiliateRebate
	require.NoError(t, DB.First(&rejected, pending.Id).Error)
	assert.Equal(t, AffiliateRebateRejected, rejected.Status)
	assert.Equal(t, "fraud", rejected.ReviewNote)

	due, err := ListDueAffiliateRebates(common.GetTimestamp(), 10)
	require.NoError(t, err)
	assert.Empty(t, due, "only pending rebates past their confirmation time are due")
}
