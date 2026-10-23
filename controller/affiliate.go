package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

type affiliateNoteRequest struct {
	Note string `json:"note"`
}

// affiliateNote reads the optional note of an admin action.
func affiliateNote(c *gin.Context) (string, bool) {
	var req affiliateNoteRequest
	if c.Request.ContentLength > 0 {
		if err := common.DecodeJson(c.Request.Body, &req); err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return "", false
		}
	}
	return req.Note, true
}

// ---- User API ----

// affiliateSelfRebate is a rebate as its inviter sees it: the invitee's order
// number is left out.
type affiliateSelfRebate struct {
	Id          int    `json:"id"`
	InviteeId   int    `json:"invitee_id"`
	Source      string `json:"source"`
	BaseQuota   int    `json:"base_quota"`
	RateBps     int    `json:"rate_bps"`
	Quota       int    `json:"quota"`
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	ConfirmAt   int64  `json:"confirm_at"`
	ConfirmedAt int64  `json:"confirmed_at"`
	CreatedAt   int64  `json:"created_at"`
}

func GetSelfAffiliateRebates(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	rebates, total, err := model.ListUserAffiliateRebates(userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pending, err := model.SumUserUnconfirmedRebateQuota(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]affiliateSelfRebate, len(rebates))
	for i, rebate := range rebates {
		items[i] = affiliateSelfRebate{
			Id:          rebate.Id,
			InviteeId:   rebate.InviteeId,
			Source:      rebate.Source,
			BaseQuota:   rebate.BaseQuota,
			RateBps:     rebate.RateBps,
			Quota:       rebate.Quota,
			Status:      rebate.Status,
			Reason:      rebate.Reason,
			ConfirmAt:   rebate.ConfirmAt,
			ConfirmedAt: rebate.ConfirmedAt,
			CreatedAt:   rebate.CreatedAt,
		}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	setting := *operation_setting.GetAffiliateRebateSetting()
	common.ApiSuccess(c, gin.H{
		"enabled":       setting.Enabled && operation_setting.IsPaymentComplianceConfirmed(),
		"rate_percent":  float64(setting.RateBps()) / 100,
		"confirm_days":  setting.ConfirmSeconds() / (24 * 3600),
		"pending_quota": pending,
		"page":          pageInfo,
	})
}

// ---- Admin APIs ----

type affiliateRebateView struct {
	model.AffiliateRebate
	InviterUsername  string `json:"inviter_username"`
	InviteeUsername  string `json:"invitee_username"`
	ReviewerUsername string `json:"reviewer_username"`
}

type affiliateInviteLogView struct {
	model.AffiliateInviteLog
	InviterUsername  string `json:"inviter_username"`
	InviteeUsername  string `json:"invitee_username"`
	OperatorUsername string `json:"operator_username"`
	Restorable       bool   `json:"restorable"`
}

func GetAffiliateSummary(c *gin.Context) {
	summary, err := model.GetAffiliateSummary()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func GetAffiliateInvites(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	invites, total, err := model.ListAffiliateInvites(userId, c.Query("keyword"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invites)
	common.ApiSuccess(c, pageInfo)
}

func CancelAffiliateInvite(c *gin.Context) {
	inviteeId, ok := positiveIdParam(c, "id")
	if !ok {
		return
	}
	note, ok := affiliateNote(c)
	if !ok {
		return
	}
	var invitee model.User
	if err := model.DB.Select("id", "inviter_id").First(&invitee, inviteeId).Error; err != nil || invitee.InviterId == 0 {
		common.ApiErrorT(c, "This user has no active invitation")
		return
	}
	cancelled, err := model.CancelAffiliateInvite(inviteeId, invitee.InviterId, model.AffiliateReasonAdminCancel, nil, c.GetInt("id"), note)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !cancelled {
		common.ApiErrorT(c, "This user has no active invitation")
		return
	}
	common.ApiSuccess(c, nil)
}

func GetAffiliateInviteLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	logs, total, err := model.ListAffiliateInviteLogs(c.Query("action"), userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ids := make([]int, 0, len(logs)*3)
	for _, log := range logs {
		ids = append(ids, log.InviterId, log.InviteeId, log.OperatorId)
	}
	names, err := model.GetUsernamesByIds(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	restorable, err := model.RestorableAffiliateInviteLogIds(logs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]affiliateInviteLogView, len(logs))
	for i, log := range logs {
		views[i] = affiliateInviteLogView{
			AffiliateInviteLog: log,
			InviterUsername:    names[log.InviterId],
			InviteeUsername:    names[log.InviteeId],
			OperatorUsername:   names[log.OperatorId],
			Restorable:         restorable[log.Id],
		}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

func RestoreAffiliateInvite(c *gin.Context) {
	logId, ok := positiveIdParam(c, "id")
	if !ok {
		return
	}
	note, ok := affiliateNote(c)
	if !ok {
		return
	}
	if err := model.RestoreAffiliateInvite(logId, c.GetInt("id"), note); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetAffiliateRebates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	rebates, total, err := model.ListAffiliateRebates(c.Query("status"), userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ids := make([]int, 0, len(rebates)*3)
	for _, rebate := range rebates {
		ids = append(ids, rebate.InviterId, rebate.InviteeId, rebate.ReviewedBy)
	}
	names, err := model.GetUsernamesByIds(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]affiliateRebateView, len(rebates))
	for i, rebate := range rebates {
		views[i] = affiliateRebateView{
			AffiliateRebate:  rebate,
			InviterUsername:  names[rebate.InviterId],
			InviteeUsername:  names[rebate.InviteeId],
			ReviewerUsername: names[rebate.ReviewedBy],
		}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

func ApproveAffiliateRebate(c *gin.Context) {
	rebateId, ok := positiveIdParam(c, "id")
	if !ok {
		return
	}
	note, ok := affiliateNote(c)
	if !ok {
		return
	}
	if err := model.ApproveAffiliateRebate(rebateId, c.GetInt("id"), note); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func RejectAffiliateRebate(c *gin.Context) {
	rebateId, ok := positiveIdParam(c, "id")
	if !ok {
		return
	}
	note, ok := affiliateNote(c)
	if !ok {
		return
	}
	if err := model.RejectAffiliateRebate(rebateId, c.GetInt("id"), note); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
