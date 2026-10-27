package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetSelfMessages returns a page of the user's personal messages, newest
// first, with how many are unread.
func GetSelfMessages(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	messages, total, unread, err := model.ListUserMessages(c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(messages)
	common.ApiSuccess(c, gin.H{"unread": unread, "page": pageInfo})
}

// ReadSelfMessages marks every personal message of the user as read.
func ReadSelfMessages(c *gin.Context) {
	if err := model.MarkUserMessagesRead(c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
