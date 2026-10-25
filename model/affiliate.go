package model

import (
	"errors"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffiliateRebateSourceTopUp        = "topup"
	AffiliateRebateSourceSubscription = "subscription"

	AffiliateRebatePending   = "pending"
	AffiliateRebateReview    = "review"
	AffiliateRebateConfirmed = "confirmed"
	AffiliateRebateRejected  = "rejected"

	AffiliateInviteActionCancel  = "cancel"
	AffiliateInviteActionRestore = "restore"

	// Rebate rates are stored in basis points.
	AffiliateRateScale = 10000

	// Reasons are message keys translated by the console.
	AffiliateReasonSharedIp         = "Inviter and invitee logged in from the same IP"
	AffiliateReasonAdminCancel      = "Cancelled by administrator"
	AffiliateReasonAdminReject      = "Rejected by administrator"
	AffiliateReasonRiskScore        = "Invitee risk score is too high"
	AffiliateReasonUserUnavailable  = "Inviter or invitee is disabled or deleted"
	AffiliateReasonInviteNotCurrent = "The invitation has been cancelled"
	AffiliateReasonPaidRestore      = "Invitee paid more than the restore amount"

	affiliateNoteMaxLength = 255
)

// AffiliateRebate is the share of one paid order that the payer's inviter
// earns. It waits for its confirmation time before being credited to the
// inviter's affiliate quota.
type AffiliateRebate struct {
	Id        int `json:"id"`
	InviterId int `json:"inviter_id" gorm:"index"`
	InviteeId int `json:"invitee_id" gorm:"index"`
	// TradeNo is the paid order; a subscription order and the top-up row it
	// writes share it, so an order earns at most one rebate.
	TradeNo     string `json:"trade_no" gorm:"type:varchar(255);uniqueIndex"`
	Source      string `json:"source" gorm:"type:varchar(16);not null"`
	BaseQuota   int    `json:"base_quota" gorm:"type:int;default:0"`
	RateBps     int    `json:"rate_bps" gorm:"type:int;default:0"`
	Quota       int    `json:"quota" gorm:"type:int;default:0"`
	Status      string `json:"status" gorm:"type:varchar(16);not null;index:idx_affiliate_rebate_due,priority:1"`
	ConfirmAt   int64  `json:"confirm_at" gorm:"bigint;default:0;index:idx_affiliate_rebate_due,priority:2"`
	Reason      string `json:"reason" gorm:"type:varchar(128);default:''"`
	RiskScore   int    `json:"risk_score" gorm:"type:int;default:0"`
	ReviewedBy  int    `json:"reviewed_by" gorm:"type:int;default:0"`
	ReviewNote  string `json:"review_note" gorm:"type:varchar(255);default:''"`
	ConfirmedAt int64  `json:"confirmed_at" gorm:"bigint;default:0"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt   int64  `json:"updated_at" gorm:"bigint"`
}

// AffiliateInviteLog records an invitation being cancelled or restored.
type AffiliateInviteLog struct {
	Id        int    `json:"id"`
	InviteeId int    `json:"invitee_id" gorm:"index"`
	InviterId int    `json:"inviter_id" gorm:"index"`
	Action    string `json:"action" gorm:"type:varchar(16);not null"`
	Reason    string `json:"reason" gorm:"type:varchar(128);default:''"`
	// SharedIps lists, comma-separated, the IPs both accounts were seen on.
	SharedIps  string `json:"shared_ips" gorm:"type:text"`
	OperatorId int    `json:"operator_id" gorm:"type:int;default:0"` // 0 for the system
	Note       string `json:"note" gorm:"type:varchar(255);default:''"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
}

func (r *AffiliateRebate) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	r.CreatedAt = now
	r.UpdatedAt = now
	return nil
}

func (l *AffiliateInviteLog) BeforeCreate(tx *gorm.DB) error {
	if l.CreatedAt == 0 {
		l.CreatedAt = common.GetTimestamp()
	}
	return nil
}

func trimAffiliateNote(note string) string {
	note = strings.TrimSpace(note)
	if len(note) > affiliateNoteMaxLength {
		note = strings.ToValidUTF8(note[:affiliateNoteMaxLength], "")
	}
	return note
}

// recordAffiliateRebateTx starts the confirmation period of the rebate earned
// from a paid order of an invited user. It runs in the transaction that
// completes the order, so the rebate exists exactly when the order is paid.
func recordAffiliateRebateTx(tx *gorm.DB, userId int, tradeNo string, source string, baseQuota int) error {
	setting := *operation_setting.GetAffiliateRebateSetting()
	rateBps := setting.RateBps()
	if !setting.Enabled || rateBps <= 0 || baseQuota <= 0 || tradeNo == "" || !operation_setting.IsPaymentComplianceConfirmed() {
		return nil
	}
	var inviterId int
	if err := tx.Model(&User{}).Where("id = ?", userId).Select("inviter_id").Scan(&inviterId).Error; err != nil {
		return err
	}
	if inviterId == 0 || inviterId == userId {
		return nil
	}
	quota := int(int64(baseQuota) * int64(rateBps) / AffiliateRateScale)
	if quota <= 0 {
		return nil
	}
	rebate := AffiliateRebate{
		InviterId: inviterId,
		InviteeId: userId,
		TradeNo:   tradeNo,
		Source:    source,
		BaseQuota: baseQuota,
		RateBps:   rateBps,
		Quota:     quota,
		Status:    AffiliateRebatePending,
		ConfirmAt: common.GetTimestamp() + setting.ConfirmSeconds(),
	}
	// A rebate already recorded for the order must not fail the payment.
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rebate).Error
}

// AffiliateInvitePair is a current invitation.
type AffiliateInvitePair struct {
	InviteeId int
	InviterId int
}

// ListCheckableAffiliateInvites returns the current invitations that the
// shared-IP check applies to: those an administrator has never restored. With
// inviteeIds it returns only the invitations of those users.
func ListCheckableAffiliateInvites(inviteeIds ...int) ([]AffiliateInvitePair, error) {
	query := DB.Model(&User{}).
		Select("id AS invitee_id, inviter_id").
		Where("inviter_id <> 0").
		Where("NOT EXISTS (SELECT 1 FROM affiliate_invite_logs WHERE affiliate_invite_logs.invitee_id = users.id AND affiliate_invite_logs.inviter_id = users.inviter_id AND affiliate_invite_logs.action = ?)", AffiliateInviteActionRestore)
	if len(inviteeIds) > 0 {
		query = query.Where("id IN ?", inviteeIds)
	}
	var pairs []AffiliateInvitePair
	err := query.Scan(&pairs).Error
	return pairs, err
}

// CancelAffiliateInvite ends the invitation of inviteeId by inviterId: the
// invitee stops counting as invited, rebates still waiting for confirmation
// are rejected and the cancellation is logged. Rewards already credited are
// kept. It reports false when inviteeId is no longer invited by inviterId.
func CancelAffiliateInvite(inviteeId int, inviterId int, reason string, sharedIps []string, operatorId int, note string) (bool, error) {
	if inviteeId <= 0 || inviterId <= 0 {
		return false, nil
	}
	note = trimAffiliateNote(note)
	cancelled := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&User{}).Unscoped().
			Where("id = ? AND inviter_id = ?", inviteeId, inviterId).
			Update("inviter_id", 0)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		cancelled = true
		if err := tx.Model(&User{}).Unscoped().
			Where("id = ? AND aff_count > 0", inviterId).
			Update("aff_count", gorm.Expr("aff_count - 1")).Error; err != nil {
			return err
		}
		if err := tx.Model(&AffiliateRebate{}).
			Where("inviter_id = ? AND invitee_id = ? AND status IN ?", inviterId, inviteeId, []string{AffiliateRebatePending, AffiliateRebateReview}).
			Updates(map[string]any{
				"status":      AffiliateRebateRejected,
				"reason":      reason,
				"reviewed_by": operatorId,
				"review_note": note,
				"updated_at":  common.GetTimestamp(),
			}).Error; err != nil {
			return err
		}
		return tx.Create(&AffiliateInviteLog{
			InviteeId:  inviteeId,
			InviterId:  inviterId,
			Action:     AffiliateInviteActionCancel,
			Reason:     reason,
			SharedIps:  strings.Join(sharedIps, ","),
			OperatorId: operatorId,
			Note:       note,
		}).Error
	})
	if err != nil {
		return false, err
	}
	if cancelled {
		common.SysLog(common.LogText("invitation of user %d by user %d cancelled: %s", inviteeId, inviterId, reason))
	}
	return cancelled, nil
}

// RestoreAffiliateInvite undoes a cancellation. A restored invitation is no
// longer cancelled automatically for sharing an IP; rejected rebates stay
// rejected. operatorId 0 is the system, which states its reason.
func RestoreAffiliateInvite(logId int, operatorId int, reason string, note string) error {
	note = trimAffiliateNote(note)
	var entry AffiliateInviteLog
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&entry, logId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Invitation log not found")
			}
			return err
		}
		if entry.Action != AffiliateInviteActionCancel {
			return common.NewMessage("Only cancelled invitations can be restored")
		}
		var inviterCount int64
		if err := tx.Model(&User{}).Where("id = ?", entry.InviterId).Count(&inviterCount).Error; err != nil {
			return err
		}
		if inviterCount == 0 {
			return common.NewMessage("This invitation cannot be restored")
		}
		result := tx.Model(&User{}).
			Where("id = ? AND inviter_id = 0", entry.InviteeId).
			Update("inviter_id", entry.InviterId)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return common.NewMessage("This invitation cannot be restored")
		}
		if err := tx.Model(&User{}).Where("id = ?", entry.InviterId).
			Update("aff_count", gorm.Expr("aff_count + 1")).Error; err != nil {
			return err
		}
		return tx.Create(&AffiliateInviteLog{
			InviteeId:  entry.InviteeId,
			InviterId:  entry.InviterId,
			Action:     AffiliateInviteActionRestore,
			Reason:     reason,
			OperatorId: operatorId,
			Note:       note,
		}).Error
	})
	if err != nil {
		return err
	}
	common.SysLog(common.LogText("invitation of user %d by user %d restored by user %d", entry.InviteeId, entry.InviterId, operatorId))
	return nil
}

// RestorePaidSharedIpInvites restores the invitations the system cancelled for
// a shared IP whose invitee has since paid more than minPaid in successful
// orders, subscription purchases included. It reports how many it restored;
// a minPaid of 0 restores none.
func RestorePaidSharedIpInvites(minPaid float64) (int, error) {
	if !(minPaid > 0) {
		return 0, nil
	}
	// Only an invitation whose latest log is the system's shared-IP
	// cancellation qualifies: a later restore or an administrator's
	// cancellation leaves it alone.
	latest := DB.Model(&AffiliateInviteLog{}).Select("MAX(id)").Group("invitee_id")
	var cancels []AffiliateInviteLog
	if err := DB.Where("id IN (?)", latest).
		Where("action = ? AND operator_id = ? AND reason = ?", AffiliateInviteActionCancel, 0, AffiliateReasonSharedIp).
		Find(&cancels).Error; err != nil {
		return 0, err
	}
	if len(cancels) == 0 {
		return 0, nil
	}
	inviteeIds := make([]int, 0, len(cancels))
	inviterIds := make([]int, 0, len(cancels))
	for _, entry := range cancels {
		inviteeIds = append(inviteeIds, entry.InviteeId)
		inviterIds = append(inviterIds, entry.InviterId)
	}
	var payers, uninvited, inviters []int
	if err := DB.Model(&TopUp{}).Select("user_id").
		Where("user_id IN ? AND status = ?", inviteeIds, common.TopUpStatusSuccess).
		Group("user_id").Having("SUM(money) > ?", minPaid).
		Pluck("user_id", &payers).Error; err != nil {
		return 0, err
	}
	if err := DB.Model(&User{}).Where("id IN ? AND inviter_id = 0", inviteeIds).Pluck("id", &uninvited).Error; err != nil {
		return 0, err
	}
	if err := DB.Model(&User{}).Where("id IN ?", inviterIds).Pluck("id", &inviters).Error; err != nil {
		return 0, err
	}
	restored := 0
	for _, entry := range cancels {
		// Skip what RestoreAffiliateInvite would refuse, so a deleted inviter
		// or a new invitation is not retried every run.
		if !slices.Contains(payers, entry.InviteeId) || !slices.Contains(uninvited, entry.InviteeId) || !slices.Contains(inviters, entry.InviterId) {
			continue
		}
		if err := RestoreAffiliateInvite(entry.Id, 0, AffiliateReasonPaidRestore, ""); err != nil {
			return restored, err
		}
		restored++
	}
	return restored, nil
}

// ListDueAffiliateRebates returns rebates whose confirmation time has come.
func ListDueAffiliateRebates(now int64, limit int) ([]AffiliateRebate, error) {
	var rebates []AffiliateRebate
	err := DB.Where("status = ? AND confirm_at <= ?", AffiliateRebatePending, now).
		Order("confirm_at asc, id asc").Limit(limit).Find(&rebates).Error
	return rebates, err
}

// SettleAffiliateRebate decides a due pending rebate: it is rejected when the
// invitation no longer exists, sent to review when either account is
// unavailable or the invitee's risk score reaches riskReviewScore, and
// credited otherwise. The shared-IP check runs before, in the caller.
func SettleAffiliateRebate(rebateId int, riskReviewScore int) error {
	var rebate AffiliateRebate
	if err := DB.First(&rebate, rebateId).Error; err != nil {
		return err
	}
	if rebate.Status != AffiliateRebatePending {
		return nil
	}
	var users []User
	if err := DB.Unscoped().Select("id", "status", "inviter_id", "deleted_at").
		Where("id IN ?", []int{rebate.InviterId, rebate.InviteeId}).Find(&users).Error; err != nil {
		return err
	}
	available := 0
	for _, user := range users {
		if user.Id == rebate.InviteeId && user.InviterId != rebate.InviterId {
			return setAffiliateRebateOutcome(rebate.Id, AffiliateRebateRejected, AffiliateReasonInviteNotCurrent, 0)
		}
		if !user.DeletedAt.Valid && user.Status == common.UserStatusEnabled {
			available++
		}
	}
	if available < 2 {
		return setAffiliateRebateOutcome(rebate.Id, AffiliateRebateReview, AffiliateReasonUserUnavailable, 0)
	}
	if riskReviewScore > 0 {
		risk, err := GetUserRiskScore(rebate.InviteeId)
		if err != nil {
			return err
		}
		if risk.Score >= riskReviewScore {
			return setAffiliateRebateOutcome(rebate.Id, AffiliateRebateReview, AffiliateReasonRiskScore, risk.Score)
		}
	}
	return creditAffiliateRebate(rebate.Id, AffiliateRebatePending, 0, "")
}

// setAffiliateRebateOutcome moves a pending rebate to review or rejection.
func setAffiliateRebateOutcome(rebateId int, status string, reason string, riskScore int) error {
	return DB.Model(&AffiliateRebate{}).
		Where("id = ? AND status = ?", rebateId, AffiliateRebatePending).
		Updates(map[string]any{
			"status":     status,
			"reason":     reason,
			"risk_score": riskScore,
			"updated_at": common.GetTimestamp(),
		}).Error
}

// creditAffiliateRebate confirms a rebate that is still in fromStatus and adds
// it to the inviter's affiliate quota. The status condition makes sure a
// rebate is credited once even when confirmed concurrently.
func creditAffiliateRebate(rebateId int, fromStatus string, reviewerId int, note string) error {
	var rebate AffiliateRebate
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&rebate, rebateId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Rebate not found")
			}
			return err
		}
		now := common.GetTimestamp()
		updates := map[string]any{
			"status":       AffiliateRebateConfirmed,
			"confirmed_at": now,
			"updated_at":   now,
		}
		if reviewerId > 0 {
			updates["reviewed_by"] = reviewerId
			updates["review_note"] = note
		}
		result := tx.Model(&AffiliateRebate{}).Where("id = ? AND status = ?", rebateId, fromStatus).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return common.NewMessage("This rebate has already been handled")
		}
		return tx.Model(&User{}).Unscoped().Where("id = ?", rebate.InviterId).Updates(map[string]any{
			"aff_quota":   gorm.Expr("aff_quota + ?", rebate.Quota),
			"aff_history": gorm.Expr("aff_history + ?", rebate.Quota),
		}).Error
	})
	if err != nil {
		return err
	}
	RecordLog(rebate.InviterId, LogTypeSystem, common.NewMessage("Referral rebate credited: {{quota}}", map[string]any{"quota": logger.FormatQuota(rebate.Quota)}))
	return nil
}

// ApproveAffiliateRebate credits a rebate held for review.
func ApproveAffiliateRebate(rebateId int, reviewerId int, note string) error {
	return creditAffiliateRebate(rebateId, AffiliateRebateReview, reviewerId, trimAffiliateNote(note))
}

// RejectAffiliateRebate rejects a rebate that has not been credited.
func RejectAffiliateRebate(rebateId int, reviewerId int, note string) error {
	result := DB.Model(&AffiliateRebate{}).
		Where("id = ? AND status IN ?", rebateId, []string{AffiliateRebatePending, AffiliateRebateReview}).
		Updates(map[string]any{
			"status":      AffiliateRebateRejected,
			"reason":      AffiliateReasonAdminReject,
			"reviewed_by": reviewerId,
			"review_note": trimAffiliateNote(note),
			"updated_at":  common.GetTimestamp(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return common.NewMessage("This rebate has already been handled")
	}
	return nil
}

// ListAffiliateRebates pages through rebates for admins; userId matches the
// inviter or the invitee.
func ListAffiliateRebates(status string, userId int, pageInfo *common.PageInfo) ([]AffiliateRebate, int64, error) {
	query := DB.Model(&AffiliateRebate{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if userId > 0 {
		query = query.Where("(inviter_id = ? OR invitee_id = ?)", userId, userId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rebates := []AffiliateRebate{}
	err := query.Order("id desc").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&rebates).Error
	return rebates, total, err
}

// ListUserAffiliateRebates pages through the rebates an inviter earned.
func ListUserAffiliateRebates(inviterId int, pageInfo *common.PageInfo) ([]AffiliateRebate, int64, error) {
	query := DB.Model(&AffiliateRebate{}).Where("inviter_id = ?", inviterId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rebates := []AffiliateRebate{}
	err := query.Order("id desc").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&rebates).Error
	return rebates, total, err
}

// SumUserUnconfirmedRebateQuota is what an inviter is still waiting for:
// rebates in their confirmation period or under review.
func SumUserUnconfirmedRebateQuota(inviterId int) (int64, error) {
	var total int64
	err := DB.Model(&AffiliateRebate{}).
		Where("inviter_id = ? AND status IN ?", inviterId, []string{AffiliateRebatePending, AffiliateRebateReview}).
		Select("COALESCE(SUM(quota), 0)").Scan(&total).Error
	return total, err
}

// AffiliateInvite is a current invitation as listed for admins.
type AffiliateInvite struct {
	InviteeId       int            `json:"invitee_id"`
	InviteeUsername string         `json:"invitee_username"`
	InviteeStatus   int            `json:"invitee_status"`
	CreatedAt       int64          `json:"created_at"`
	InviterId       int            `json:"inviter_id"`
	InviterUsername string         `json:"inviter_username"`
	RiskScore       *UserRiskScore `json:"risk_score" gorm:"-"`
	ConfirmedQuota  int64          `json:"confirmed_quota" gorm:"-"`
	PendingQuota    int64          `json:"pending_quota" gorm:"-"`
}

// ListAffiliateInvites pages through current invitations, newest invitee
// first. userId matches the inviter or the invitee; keyword matches the
// invitee's username or display name.
func ListAffiliateInvites(userId int, keyword string, pageInfo *common.PageInfo) ([]AffiliateInvite, int64, error) {
	query := DB.Model(&User{}).Where("inviter_id <> 0")
	if userId > 0 {
		query = query.Where("(id = ? OR inviter_id = ?)", userId, userId)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		pattern := containsSearchPattern(keyword)
		query = query.Where("(username LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!')", pattern, pattern)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	invites := []AffiliateInvite{}
	err := query.Select("id AS invitee_id", "username AS invitee_username", "status AS invitee_status", "created_at", "inviter_id").
		Order("id desc").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Scan(&invites).Error
	if err != nil || len(invites) == 0 {
		return invites, total, err
	}
	inviteeIds := make([]int, 0, len(invites))
	inviterIds := make([]int, 0, len(invites))
	for _, invite := range invites {
		inviteeIds = append(inviteeIds, invite.InviteeId)
		if !slices.Contains(inviterIds, invite.InviterId) {
			inviterIds = append(inviterIds, invite.InviterId)
		}
	}
	names, err := GetUsernamesByIds(inviterIds)
	if err != nil {
		return nil, 0, err
	}
	scores, err := GetUserRiskScoresByIds(inviteeIds)
	if err != nil {
		return nil, 0, err
	}
	var sums []struct {
		InviteeId int
		InviterId int
		Status    string
		Total     int64
	}
	err = DB.Model(&AffiliateRebate{}).
		Select("invitee_id, inviter_id, status, COALESCE(SUM(quota), 0) AS total").
		Where("invitee_id IN ? AND status IN ?", inviteeIds, []string{AffiliateRebatePending, AffiliateRebateReview, AffiliateRebateConfirmed}).
		Group("invitee_id, inviter_id, status").
		Scan(&sums).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range invites {
		invite := &invites[i]
		invite.InviterUsername = names[invite.InviterId]
		score := scores[invite.InviteeId]
		invite.RiskScore = &score
		for _, sum := range sums {
			if sum.InviteeId != invite.InviteeId || sum.InviterId != invite.InviterId {
				continue
			}
			if sum.Status == AffiliateRebateConfirmed {
				invite.ConfirmedQuota += sum.Total
			} else {
				invite.PendingQuota += sum.Total
			}
		}
	}
	return invites, total, nil
}

// ListAffiliateInviteLogs pages through invitation logs for admins.
func ListAffiliateInviteLogs(action string, userId int, pageInfo *common.PageInfo) ([]AffiliateInviteLog, int64, error) {
	query := DB.Model(&AffiliateInviteLog{})
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if userId > 0 {
		query = query.Where("(inviter_id = ? OR invitee_id = ?)", userId, userId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	logs := []AffiliateInviteLog{}
	err := query.Order("id desc").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&logs).Error
	return logs, total, err
}

// RestorableAffiliateInviteLogIds reports which of the given logs can still be
// restored: cancellations that are the latest entry of their invitee, while
// the invitee has no inviter.
func RestorableAffiliateInviteLogIds(logs []AffiliateInviteLog) (map[int]bool, error) {
	cancels := make(map[int]bool)
	inviteeIds := make([]int, 0, len(logs))
	for _, log := range logs {
		if log.Action != AffiliateInviteActionCancel {
			continue
		}
		cancels[log.Id] = true
		if !slices.Contains(inviteeIds, log.InviteeId) {
			inviteeIds = append(inviteeIds, log.InviteeId)
		}
	}
	restorable := make(map[int]bool)
	if len(inviteeIds) == 0 {
		return restorable, nil
	}
	var latest []struct {
		InviteeId int
		LatestId  int
	}
	if err := DB.Model(&AffiliateInviteLog{}).Select("invitee_id, MAX(id) AS latest_id").
		Where("invitee_id IN ?", inviteeIds).Group("invitee_id").Scan(&latest).Error; err != nil {
		return nil, err
	}
	var uninvited []int
	if err := DB.Model(&User{}).Where("id IN ? AND inviter_id = 0", inviteeIds).Pluck("id", &uninvited).Error; err != nil {
		return nil, err
	}
	for _, row := range latest {
		if cancels[row.LatestId] && slices.Contains(uninvited, row.InviteeId) {
			restorable[row.LatestId] = true
		}
	}
	return restorable, nil
}

// AffiliateSummary is the headline of the admin referral page.
type AffiliateSummary struct {
	ActiveInvites    int64 `json:"active_invites"`
	CancelledInvites int64 `json:"cancelled_invites"`
	PendingQuota     int64 `json:"pending_quota"`
	ReviewCount      int64 `json:"review_count"`
}

func GetAffiliateSummary() (*AffiliateSummary, error) {
	summary := &AffiliateSummary{}
	if err := DB.Model(&User{}).Where("inviter_id <> 0").Count(&summary.ActiveInvites).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&AffiliateInviteLog{}).Where("action = ?", AffiliateInviteActionCancel).Count(&summary.CancelledInvites).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&AffiliateRebate{}).Where("status IN ?", []string{AffiliateRebatePending, AffiliateRebateReview}).
		Select("COALESCE(SUM(quota), 0)").Scan(&summary.PendingQuota).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&AffiliateRebate{}).Where("status = ?", AffiliateRebateReview).Count(&summary.ReviewCount).Error; err != nil {
		return nil, err
	}
	return summary, nil
}
