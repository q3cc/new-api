package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// The provider's text of a rewritten upstream error belongs to the error log
// of that attempt only. A later error of the same request that no channel
// produced, such as a request plugin stopping the retry, must not show it.
func TestErrorLogKeepsTheUpstreamTextWithItsOwnAttempt(t *testing.T) {
	previousDB, previousLogDB, previousType := model.DB, model.LOG_DB, common.MainDatabaseType()
	previousErrorLog, previousAutoDisable := constant.ErrorLogEnabled, common.AutomaticDisableChannelEnabled
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetMainDatabaseType(previousType)
		constant.ErrorLogEnabled, common.AutomaticDisableChannelEnabled = previousErrorLog, previousAutoDisable
		require.NoError(t, operation_setting.UpstreamErrorRewriteRulesFromString(operation_setting.DefaultUpstreamErrorRewriteRules))
	})
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.DB, model.LOG_DB = database, database
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	require.NoError(t, database.AutoMigrate(&model.Log{}, &model.User{}))
	constant.ErrorLogEnabled, common.AutomaticDisableChannelEnabled = true, false
	require.NoError(t, operation_setting.UpstreamErrorRewriteRulesFromString("content policy => blocked by the provider"))

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	upstream := types.NewErrorWithStatusCode(errors.New("content policy violation at the provider"), types.ErrorCodeBadResponseStatusCode, http.StatusBadRequest)
	ProcessChannelError(c, types.ChannelError{ChannelId: 7, ChannelName: "first"}, upstream, nil)
	stopped := types.NewErrorWithStatusCode(errors.New("stopped by a request plugin"), types.ErrorCodeBadResponseStatusCode, http.StatusBadRequest)
	RecordRelayErrorLog(c, 8, stopped, nil)

	var logs []model.Log
	require.NoError(t, database.Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	assert.Equal(t, "blocked by the provider", upstream.Error())
	assert.Contains(t, logs[0].Other, "content policy violation at the provider")
	assert.Contains(t, logs[1].Content, "stopped by a request plugin")
	assert.NotContains(t, logs[1].Other, "content policy violation", "the earlier attempt's provider text stays out of a later error")
}
