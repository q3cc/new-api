package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// lotteryWinnerLimit caps the public winner list of one activity.
const lotteryWinnerLimit = 50

type lotteryActivityView struct {
	model.LotteryActivity
	Me          *model.LotteryUserState `json:"me"`
	Winners     []model.LotteryWinner   `json:"winners"`
	WinnerCount int64                   `json:"winner_count"`
}

type lotteryEntryView struct {
	model.LotteryEntry
	Username string `json:"username"`
}

type lotteryDeliverRequest struct {
	Note string `json:"note"`
}

func lotteryIdParam(c *gin.Context, name string) (int, bool) {
	id, err := strconv.Atoi(c.Param(name))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, false
	}
	return id, true
}

// ---- User APIs ----

func GetLotteryActivities(c *gin.Context) {
	userId := c.GetInt("id")
	activities, err := model.ListLotteryActivities(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]lotteryActivityView, 0, len(activities))
	for i := range activities {
		state, err := model.GetLotteryUserState(model.DB, &activities[i], userId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		winners, winnerCount, err := model.ListLotteryWinners(activities[i].Id, lotteryWinnerLimit)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		views = append(views, lotteryActivityView{
			LotteryActivity: activities[i],
			Me:              state,
			Winners:         winners,
			WinnerCount:     winnerCount,
		})
	}
	common.ApiSuccess(c, views)
}

func JoinLotteryActivity(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	if err := model.JoinLotteryActivity(id, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Joined the activity", nil)
}

func SpinLotteryWheel(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	entry, err := model.SpinLotteryWheel(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, entry)
}

func GetSelfLotteryWins(c *gin.Context) {
	wins, err := model.ListUserLotteryWins(c.GetInt("id"), 100)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, wins)
}

// ---- Admin APIs ----

func AdminListLotteryActivities(c *gin.Context) {
	activities, err := model.ListLotteryActivities(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, activities)
}

func AdminCreateLotteryActivity(c *gin.Context) {
	var activity model.LotteryActivity
	if err := common.DecodeJson(c.Request.Body, &activity); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.CreateLotteryActivity(&activity); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, activity)
}

func AdminUpdateLotteryActivity(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	var activity model.LotteryActivity
	if err := common.DecodeJson(c.Request.Body, &activity); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	activity.Id = id
	if err := model.UpdateLotteryActivity(&activity); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminDeleteLotteryActivity(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	if err := model.DeleteLotteryActivity(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminCancelLotteryActivity(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	if err := model.CancelLotteryActivity(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminDrawLotteryActivity(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	activity, err := model.GetLotteryActivity(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if activity.Mode == model.LotteryModeWheel || activity.Status != model.LotteryStatusActive {
		common.ApiErrorT(c, "Only active scheduled or participant-count activities can be drawn")
		return
	}
	if err := model.DrawLotteryActivity(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminListLotteryEntries(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	entries, total, err := model.ListLotteryEntries(id, c.Query("winners") == "true", pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userIds := make([]int, 0, len(entries))
	for _, entry := range entries {
		userIds = append(userIds, entry.UserId)
	}
	names, err := model.GetUsernamesByIds(userIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]lotteryEntryView, len(entries))
	for i, entry := range entries {
		views[i] = lotteryEntryView{LotteryEntry: entry, Username: names[entry.UserId]}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

// AdminDeliverLotteryEntry marks a manual prize as handed out, or retries the
// delivery of a balance or subscription prize.
func AdminDeliverLotteryEntry(c *gin.Context) {
	id, ok := lotteryIdParam(c, "id")
	if !ok {
		return
	}
	var req lotteryDeliverRequest
	if c.Request.ContentLength > 0 {
		if err := common.DecodeJson(c.Request.Body, &req); err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
	}
	var entry model.LotteryEntry
	if err := model.DB.First(&entry, id).Error; err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var err error
	if entry.PrizeType == model.LotteryPrizeManual {
		err = model.MarkLotteryEntryDelivered(id, req.Note)
	} else {
		err = model.DeliverLotteryEntry(id)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
