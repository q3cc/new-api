package controller

import (
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetTrialCreditConfig(c *gin.Context) {
	cfg, err := model.ReadTrialCreditConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cfg)
}
func UpdateTrialCreditConfig(c *gin.Context) {
	var cfg model.TrialCreditConfig
	if err := common.DecodeJson(c.Request.Body, &cfg); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateTrialCreditConfig(cfg); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cfg)
}
func AdminGrantTrialCredit(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	target, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if c.GetInt("role") != common.RoleRootUser && target.Role >= c.GetInt("role") {
		c.AbortWithStatusJSON(403, gin.H{"success": false, "message": "无权操作此用户"})
		return
	}
	var request struct {
		Quota     int    `json:"quota"`
		ExpiresAt int64  `json:"expires_at"`
		RequestId string `json:"request_id"`
	}
	if err = common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.RequestId) < 16 || len(request.RequestId) > 64 {
		common.ApiError(c, fmt.Errorf("发放编号无效"))
		return
	}
	key := fmt.Sprintf("admin:%d:%s", c.GetInt("id"), request.RequestId)
	if err = model.GrantTrialCredit(userId, request.Quota, request.ExpiresAt, key, "admin", c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func GetTrialCreditSelf(c *gin.Context) {
	userId := c.GetInt("id")
	cfg, cfgErr := model.ReadTrialCreditConfig()
	if cfgErr != nil {
		common.ApiError(c, cfgErr)
		return
	}
	if !cfg.Enabled && cfg.Group == "" {
		common.ApiSuccess(c, gin.H{"enabled": false, "balance": 0, "grants": []any{}, "records": []any{}})
		return
	}
	balance, err := model.GetTrialCreditBalance(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page := common.GetPageQuery(c)
	page.Page = max(1, min(page.Page, 1000000))
	page.PageSize = max(1, min(page.PageSize, 100))
	grants := []model.TrialCreditGrant{}
	if err = model.DB.Where("user_id = ?", userId).Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&grants).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	records := []model.TrialCreditReservation{}
	if err = model.DB.Where("user_id = ?", userId).Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&records).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var total int64
	if err = model.DB.Model(&model.TrialCreditGrant{}).Where("user_id = ?", userId).Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var recordsTotal int64
	if err = model.DB.Model(&model.TrialCreditReservation{}).Where("user_id = ?", userId).Count(&recordsTotal).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"records_total": recordsTotal, "enabled": cfg.Enabled, "group": cfg.Group, "balance": balance, "grants": grants, "records": records, "total": total})
}
