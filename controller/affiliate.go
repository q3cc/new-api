package controller

import (
	"strconv"
	"sync"
	"time"

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
	InviteeName string `json:"invitee_name"`
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
	inviteeIds := make([]int, len(rebates))
	for i, rebate := range rebates {
		inviteeIds[i] = rebate.InviteeId
	}
	names, err := model.GetUsernamesByIds(inviteeIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]affiliateSelfRebate, len(rebates))
	for i, rebate := range rebates {
		items[i] = affiliateSelfRebate{
			Id:          rebate.Id,
			InviteeId:   rebate.InviteeId,
			InviteeName: common.MaskUsername(names[rebate.InviteeId]),
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

const (
	affiliateLeaderboardSize         = 50
	affiliateLeaderboardCacheSeconds = 60
)

// affiliateLeaderboardRow is a ranked inviter as every user sees it: only the
// masked username identifies them.
type affiliateLeaderboardRow struct {
	Rank int    `json:"rank"`
	Name string `json:"name"`
	IsMe bool   `json:"is_me"`
	model.AffiliateEarnings
}

// affiliateLeaderboardCache holds the ranking every user sees, so viewing the
// promotion center does not add up all rebates each time.
var affiliateLeaderboardCache struct {
	sync.Mutex
	computedAt int64
	monthStart int64
	rows       []model.AffiliateEarnings
	names      map[int]string
}

// cachedAffiliateLeaderboard returns the ranking and the masked names of the
// ranked inviters, recomputed at most once a minute and when a month starts.
func cachedAffiliateLeaderboard(now int64, monthStart int64, quarterStart int64) ([]model.AffiliateEarnings, map[int]string, error) {
	cache := &affiliateLeaderboardCache
	cache.Lock()
	defer cache.Unlock()
	if cache.rows != nil && cache.monthStart == monthStart && now-cache.computedAt < affiliateLeaderboardCacheSeconds {
		return cache.rows, cache.names, nil
	}
	rows, err := model.ListAffiliateLeaderboard(monthStart, quarterStart, affiliateLeaderboardSize)
	if err != nil {
		return nil, nil, err
	}
	ids := make([]int, len(rows))
	for i, row := range rows {
		ids[i] = row.InviterId
	}
	names, err := model.GetUsernamesByIds(ids)
	if err != nil {
		return nil, nil, err
	}
	for id, name := range names {
		names[id] = common.MaskUsername(name)
	}
	cache.computedAt, cache.monthStart, cache.rows, cache.names = now, monthStart, rows, names
	return rows, names, nil
}

// GetAffiliateLeaderboard ranks inviters by the rebates credited to them this
// quarter, and gives the caller's own figures.
func GetAffiliateLeaderboard(c *gin.Context) {
	userId := c.GetInt("id")
	now := time.Now()
	year, month, _ := now.Date()
	monthStart := time.Date(year, month, 1, 0, 0, 0, 0, now.Location()).Unix()
	quarterStart := time.Date(year, month-(month-1)%3, 1, 0, 0, 0, 0, now.Location()).Unix()
	rows, names, err := cachedAffiliateLeaderboard(now.Unix(), monthStart, quarterStart)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	me, err := model.GetAffiliateEarnings(userId, monthStart, quarterStart)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	myRank := 0
	board := make([]affiliateLeaderboardRow, len(rows))
	for i, row := range rows {
		board[i] = affiliateLeaderboardRow{Rank: i + 1, Name: names[row.InviterId], IsMe: row.InviterId == userId, AffiliateEarnings: row}
		if board[i].IsMe {
			myRank = i + 1
		}
	}
	common.ApiSuccess(c, gin.H{
		"rows": board,
		"me": struct {
			Rank int `json:"rank"`
			model.AffiliateEarnings
		}{Rank: myRank, AffiliateEarnings: me},
	})
}

// affiliateInviteeView is a user the caller invited, shown by masked username.
type affiliateInviteeView struct {
	Name string `json:"name"`
	model.AffiliateInvitee
}

// GetSelfAffiliateInvitees pages through the users the caller invited,
// cancelled invitations included.
func GetSelfAffiliateInvitees(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	invitees, total, err := model.ListUserAffiliateInvitees(c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]affiliateInviteeView, len(invitees))
	for i, invitee := range invitees {
		views[i] = affiliateInviteeView{Name: common.MaskUsername(invitee.Username), AffiliateInvitee: invitee}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
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
	if err := model.RestoreAffiliateInvite(logId, c.GetInt("id"), "", note); err != nil {
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
