package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetSelfGiftQuota returns the caller's cumulative gift quota by source.
func GetSelfGiftQuota(c *gin.Context) {
	summary, err := model.GetUserGiftQuotaSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// GetUserGiftQuota lets administrators see a user's gift quota, for example
// when working out a refund.
func GetUserGiftQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorT(c, "No permission to access users of same or higher level")
		return
	}
	summary, err := model.GetUserGiftQuotaSummary(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}
