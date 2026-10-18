package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gorilla/websocket"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestChatStreamFailureDoesNotCompleteOrEstimateUsage(t *testing.T) {
	require.NoError(t, i18n.Init())
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	content := "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"
	for _, tc := range []struct{ name, body, code string }{
		{"numeric upstream error", `data: {"error":{"message":"Not enough credits","code":402}}` + "\n\n", "402"},
		{"string upstream error", `data: {"error":"Model unavailable"}` + "\n\n", "unknown_error"},
		{"error after output", content + `data: {"error":{"message":"Context too long","code":"context_length_exceeded"}}` + "\n\n", "context_length_exceeded"},
		{"error before DONE", `data: {"error":{"message":"Bad request","code":400}}` + "\n\ndata: [DONE]\n\n", "400"},
		{"error after finish reason", `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}` + "\n\n" + `data: {"error":{"message":"Model unavailable","code":404}}` + "\n\n", "404"},
		{"error using channel code", `data: {"error":{"message":"Failed","code":"channel:upstream_failed"}}` + "\n\n", "channel:upstream_failed"},
		{"empty EOF", "", "empty_response"},
		{"empty DONE", "data: [DONE]\n\n", "empty_response"},
		{"usage without a response", `data: {"choices":[],"usage":{"prompt_tokens":200000,"total_tokens":200000}}` + "\n\ndata: [DONE]\n\n", "empty_response"},
		{"truncated response", content, "bad_response"},
		{"unfinished second choice", `data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"},{"index":1,"delta":{"content":"partial"}}]}` + "\n\n", "bad_response"},
		{"malformed event", "data: {broken\n\n", "bad_response_body"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAdvancedCustom, UpstreamModelName: "deepseek.v3.2"},
				RelayFormat: types.RelayFormatOpenAI, RelayMode: relayconstant.RelayModeChatCompletions,
				DisablePing: true, ShouldIncludeUsage: true,
			}
			info.SetEstimatePromptTokens(200000)
			usage, apiErr := openai.OaiStreamHandler(ctx, info, &http.Response{
				StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(tc.body)),
			})
			require.NotNil(t, apiErr)
			assert.Equal(t, tc.code, string(apiErr.GetErrorCode()))
			assert.Nil(t, usage, "failed streams must reach the caller's refund path without fabricated input usage")
			assert.True(t, types.IsSkipRetryError(apiErr), "a stream must not restart and duplicate already delivered output")
			assert.Equal(t, "stop", service.DecideRelayRetry(ctx, apiErr, 3).Action)
			assert.True(t, info.StreamStatus.ResponseFailed())
			if strings.HasPrefix(tc.body, content) {
				assert.Contains(t, recorder.Body.String(), "partial")
			}
			writeRelayError(ctx, types.RelayFormatOpenAI, apiErr)
			if strings.HasPrefix(tc.body, content) {
				assert.Equal(t, http.StatusOK, recorder.Code)
				assert.Contains(t, recorder.Body.String(), `data: {"error":`)
			} else if !strings.Contains(recorder.Body.String(), "data:") {
				assert.Equal(t, http.StatusBadGateway, recorder.Code)
				assert.Equal(t, "application/json; charset=utf-8", recorder.Header().Get("Content-Type"))
				assert.Empty(t, recorder.Header().Get("Transfer-Encoding"))
			}
			assert.NotContains(t, recorder.Body.String(), "[DONE]")
			assert.NotContains(t, recorder.Body.String(), `"prompt_tokens":200000`)
		})
	}
}

func TestChatStreamValidTerminalsAndCancellation(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	for _, tc := range []struct {
		name, body string
		cancel     bool
	}{
		{"finish reason then EOF", `data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}` + "\n\n", false},
		{"DONE without finish reason", `data: {"choices":[{"delta":{"content":"ok"}}]}` + "\n\ndata: [DONE]\n\n", false},
		{"reasoning only", `data: {"choices":[{"delta":{"reasoning_content":"thinking"},"finish_reason":"length"}]}` + "\n\n", false},
		{"tool call", `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}` + "\n\n", false},
		{"filtered content", `data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}` + "\n\n", false},
		{"reported usage", `data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}` + "\n\n" + `data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}` + "\n\ndata: [DONE]\n\n", false},
		{"user stopped", `data: {"choices":[{"delta":{"content":"partial"}}]}` + "\n\n" + `data: {"choices":[{"delta":{"content":" reply"}}]}` + "\n\n", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requestCtx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			recorder := httptest.NewRecorder()
			writer := &streamCancelWriter{ResponseRecorder: recorder}
			if tc.cancel {
				writer.cancel = cancel
			}
			ctx, _ := gin.CreateTestContext(writer)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil).WithContext(requestCtx)
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "deepseek.v3.2"},
				RelayFormat: types.RelayFormatOpenAI, RelayMode: relayconstant.RelayModeChatCompletions,
				DisablePing: true, ShouldIncludeUsage: true,
			}
			info.SetEstimatePromptTokens(4)
			usage, apiErr := openai.OaiStreamHandler(ctx, info, &http.Response{Body: io.NopCloser(strings.NewReader(tc.body))})
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 4, usage.PromptTokens)
			if tc.cancel {
				assert.Equal(t, "cancelled", info.StreamStatus.ResponseOutcome())
				assert.NotContains(t, recorder.Body.String(), "[DONE]")
			} else {
				assert.Equal(t, "completed", info.StreamStatus.ResponseOutcome())
				assert.Equal(t, 1, strings.Count(recorder.Body.String(), "[DONE]"))
			}
			if tc.name == "reported usage" {
				assert.Equal(t, 2, usage.CompletionTokens)
			}
		})
	}
}

type streamCancelWriter struct {
	*httptest.ResponseRecorder
	cancel context.CancelFunc
}

func (w *streamCancelWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseRecorder.Write(p)
	if w.cancel != nil {
		w.cancel()
	}
	return n, err
}

func TestRelayStreamErrorUsesClientProtocol(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatGemini} {
		t.Run(string(format), func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/", nil)
			helper.SetEventStreamHeaders(ctx)
			require.NoError(t, helper.StringData(ctx, `{"partial":true}`))
			writeRelayError(ctx, format, types.NewOpenAIError(errors.New("stream failed"), types.ErrorCodeBadResponse, http.StatusBadGateway))
			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Contains(t, recorder.Header().Get("Content-Type"), "text/event-stream")
			body := recorder.Body.String()
			assert.Contains(t, body, "stream failed")
			assert.NotContains(t, body, "[DONE]")
			assert.Equal(t, 2, strings.Count(body, "data:"))
			if format == types.RelayFormatClaude {
				assert.Contains(t, body, "event:error\n")
				assert.Contains(t, body, `"type":"error"`)
			}
			if format == types.RelayFormatGemini {
				// Gemini clients parse google.rpc.Status, not the OpenAI envelope.
				assert.Contains(t, body, `"code":502`)
				assert.Contains(t, body, `"status":"INTERNAL"`)
				assert.NotContains(t, body, `"type":"bad_response"`)
			}
		})
	}
}

func TestRelayErrorEncodesTheGeminiStatusEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/x:generateContent", nil)
	writeRelayError(ctx, types.RelayFormatGemini, types.NewOpenAIError(
		errors.New("prompt blocked: PROHIBITED_CONTENT"),
		types.ErrorCodePromptBlocked,
		http.StatusBadRequest,
		types.ErrOptionWithSkipRetry(),
	))
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Equal(t, "application/json; charset=utf-8", recorder.Header().Get("Content-Type"))
	var payload struct {
		Error types.GeminiError `json:"error"`
	}
	require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &payload))
	assert.Equal(t, http.StatusBadRequest, payload.Error.Code)
	assert.Equal(t, "INVALID_ARGUMENT", payload.Error.Status)
	assert.Contains(t, payload.Error.Message, "PROHIBITED_CONTENT")
}

type streamBillingRecorder struct {
	settles, refunds int
}

func (b *streamBillingRecorder) Settle(int) error       { b.settles++; return nil }
func (b *streamBillingRecorder) Refund(*gin.Context)    { b.refunds++ }
func (*streamBillingRecorder) NeedsRefund() bool        { return true }
func (*streamBillingRecorder) GetPreConsumedQuota() int { return 100 }
func (*streamBillingRecorder) Reserve(int) error        { return nil }

func TestTextRelayStreamErrorRefundsWithoutSettlement(t *testing.T) {
	service.InitHttpClient()
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"error\":{\"message\":\"Context too long\",\"code\":\"context_length_exceeded\"}}\n\n")
	}))
	t.Cleanup(upstream.Close)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
	common.SetContextKey(ctx, constant.ContextKeyChannelBaseUrl, upstream.URL)
	common.SetContextKey(ctx, constant.ContextKeyOriginalModel, "gpt-4o-mini")
	billing := &streamBillingRecorder{}
	info := &relaycommon.RelayInfo{
		Request:         &dto.GeneralOpenAIRequest{Model: "gpt-4o-mini", Stream: common.GetPointer(true)},
		OriginModelName: "gpt-4o-mini", RelayMode: relayconstant.RelayModeChatCompletions,
		RelayFormat: types.RelayFormatOpenAI, RequestURLPath: ctx.Request.URL.Path,
		IsStream: true, DisablePing: true, Billing: billing,
	}
	info.SetEstimatePromptTokens(200000)
	apiErr := relay.TextHelper(ctx, info)
	require.NotNil(t, apiErr)
	assert.Equal(t, "context_length_exceeded", string(apiErr.GetErrorCode()))
	assert.Equal(t, 0, billing.settles)
	assert.Same(t, apiErr, relay.RefundFailedRequestBilling(ctx, info, apiErr))
	assert.Equal(t, 1, billing.refunds)
}

func TestProcessChannelErrorUsesSnapshotWithoutLeakingChannelMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled := common.RedisEnabled
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousErrorLogEnabled := constant.ErrorLogEnabled

	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.Log{}))
	model.DB, model.LOG_DB = database, database
	common.RedisEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	constant.ErrorLogEnabled = true
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedisEnabled
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		constant.ErrorLogEnabled = previousErrorLogEnabled
		require.NoError(t, sqlDB.Close())
	})

	require.NoError(t, database.Create(&model.User{Id: 7, Username: "log-owner", Group: "default"}).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Set("id", 7)
	ctx.Set("username", "log-owner")
	ctx.Set("token_name", "test-token")
	ctx.Set("token_id", 11)
	ctx.Set("original_model", "gpt-test")
	ctx.Set("group", "default")
	ctx.Set("channel_id", 202)
	ctx.Set("channel_name", "mutable-context-channel")
	ctx.Set("channel_type", 9)
	ctx.Set("use_channel", []string{"101"})
	common.SetContextKey(ctx, constant.ContextKeyRequestStartTime, time.Now().Add(-time.Second))

	channelSnapshot := types.ChannelError{
		ChannelId:   101,
		ChannelType: 1,
		ChannelName: "snapshot-channel",
		AutoBan:     false,
	}
	apiErr := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)

	processChannelError(ctx, channelSnapshot, apiErr, nil)

	var stored model.Log
	require.NoError(t, database.First(&stored).Error)
	assert.Equal(t, channelSnapshot.ChannelId, stored.ChannelId)
	storedOther, err := common.StrToMap(stored.Other)
	require.NoError(t, err)
	assert.Equal(t, float64(http.StatusBadGateway), storedOther["status_code"])
	for _, key := range []string{"channel_id", "channel_name", "channel_type"} {
		assert.NotContains(t, storedOther, key)
	}
	adminInfo, ok := storedOther["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, []any{"101"}, adminInfo["use_channel"])

	logs, total, err := model.GetUserLogs(7, model.LogFilter{Type: model.LogTypeError}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, logs, 1)
	assert.Equal(t, channelSnapshot.ChannelId, logs[0].ChannelId)
	assert.Empty(t, logs[0].ChannelName)
	userOther, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.NotContains(t, userOther, "admin_info")
	for _, key := range []string{"channel_id", "channel_name", "channel_type"} {
		assert.NotContains(t, userOther, key)
	}
}

func TestResponsesQuotaFailuresBeforeOutputAreReplayable(t *testing.T) {
	previousAuto, previousKeywords := common.AutomaticDisableChannelEnabled, operation_setting.AutomaticDisableKeywords
	common.AutomaticDisableChannelEnabled = true
	operation_setting.AutomaticDisableKeywords = []string{"insufficient_quota", "rate_limit_exceeded", "usage_limit_reached"}
	t.Cleanup(func() {
		common.AutomaticDisableChannelEnabled, operation_setting.AutomaticDisableKeywords = previousAuto, previousKeywords
	})
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	created := `data: {"type":"response.created","response":{"id":"failed-attempt","status":"in_progress"}}` + "\n\n"
	for _, event := range []string{
		`{"type":"response.failed","response":{"status":"failed","error":{"code":"insufficient_quota","message":"Quota exhausted"}}}`,
		`{"type":"error","code":"rate_limit_exceeded","message":"Rate limit reached"}`,
		`{"type":"error","code":"rate_limit_exceeded","message":"Rate limit reached","error":null}`,
		`{"type":"error","error":{"code":"usage_limit_reached","message":"Usage limit reached"}}`,
	} {
		t.Run(event, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			recorder.Header().Set("X-Codex-Turn-State", "original-state")
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			ctx.Set("auto_ban", true)
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}, DisablePing: true}
			usage, apiErr := openai.OaiResponsesStreamHandler(ctx, info, &http.Response{StatusCode: 200, Header: http.Header{"X-Codex-Turn-State": []string{"failed-state"}}, Body: io.NopCloser(strings.NewReader(created + "data: " + event + "\n\n"))})
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
			assert.Nil(t, usage)
			assert.False(t, ctx.Writer.Written())
			assert.Empty(t, recorder.Body.String())
			assert.Equal(t, []string{"original-state"}, recorder.Header().Values("X-Codex-Turn-State"))
			assert.False(t, types.IsSkipRetryError(apiErr))
			assert.True(t, info.StreamStatus.ResponseFailed())
		})
	}
	t.Run("ping before quota failure does not commit the response", func(t *testing.T) {
		general := operation_setting.GetGeneralSetting()
		previousGeneral := *general
		general.PingIntervalEnabled, general.PingIntervalSeconds = true, 1
		t.Cleanup(func() { *general = previousGeneral })
		reader, writer := io.Pipe()
		upstreamDone := make(chan struct{})
		go func() {
			defer close(upstreamDone)
			defer writer.Close()
			_, _ = io.WriteString(writer, created)
			// Delay the rejection past the configured heartbeat interval.
			timer := time.NewTimer(1100 * time.Millisecond)
			defer timer.Stop()
			<-timer.C
			_, _ = io.WriteString(writer, `data: {"type":"error","code":"insufficient_quota","message":"Quota exhausted"}`+"\n\n")
		}()
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
		ctx.Set("auto_ban", true)
		usage, apiErr := openai.OaiResponsesStreamHandler(ctx, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}, &http.Response{StatusCode: 200, Body: reader})
		<-upstreamDone
		require.NotNil(t, apiErr)
		assert.Nil(t, usage)
		assert.False(t, ctx.Writer.Written())
		assert.Empty(t, recorder.Body.String())
	})
	t.Run("JSON error without type", func(t *testing.T) {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
		usage, apiErr := openai.OaiResponsesHandler(ctx, &relaycommon.RelayInfo{}, &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"failed","error":{"code":"insufficient_quota","message":"Quota exhausted"}}`))})
		require.NotNil(t, apiErr)
		assert.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
		assert.Nil(t, usage)
		assert.False(t, ctx.Writer.Written())
	})
}

func TestAutomaticDisableRetryRespectsReplaySafety(t *testing.T) {
	previousAuto, previousKeywords := common.AutomaticDisableChannelEnabled, operation_setting.AutomaticDisableKeywords
	common.AutomaticDisableChannelEnabled = true
	operation_setting.AutomaticDisableKeywords = []string{"insufficient_quota"}
	t.Cleanup(func() {
		common.AutomaticDisableChannelEnabled, operation_setting.AutomaticDisableKeywords = previousAuto, previousKeywords
	})
	for _, tc := range []struct {
		name   string
		budget int
		setup  func(*gin.Context)
		want   string
	}{
		{"disabled strict session fails over", 2, nil, "automatic_disable"},
		{"budget exhausted", 0, func(c *gin.Context) { c.Set("channel_affinity_skip_retry_on_failure", false) }, "attempt_budget_exhausted"},
		{"manual pin", 2, func(c *gin.Context) {
			c.Set("channel_affinity_skip_retry_on_failure", false)
			service.GetChannelConstraints(c).AddPin(appdto.ChannelPin{ChannelId: 1, Source: appdto.PinSourceToken, Rank: appdto.PinRankToken, RetryMode: appdto.PinRetrySingleAttempt})
		}, "pinned_channel"},
		{"already output", 2, func(c *gin.Context) { c.String(200, "partial") }, "response_started"},
		{"cancelled", 2, func(c *gin.Context) {
			requestCtx, cancel := context.WithCancel(c.Request.Context())
			cancel()
			c.Request = c.Request.WithContext(requestCtx)
		}, "request_cancelled"},
		{"auto ban off retains strict session", 2, func(c *gin.Context) { c.Set("auto_ban", false) }, "strict_session"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			ctx.Set("auto_ban", true)
			ctx.Set("channel_affinity_skip_retry_on_failure", true)
			if tc.setup != nil {
				tc.setup(ctx)
			}
			apiErr := types.WithOpenAIError(types.OpenAIError{Code: "insufficient_quota", Message: "Quota exhausted"}, 400)
			assert.True(t, service.ShouldDisableChannel(apiErr), "structured code matches even when the message changes")
			decision := service.DecideRelayRetry(ctx, apiErr, tc.budget)
			assert.Equal(t, tc.want, decision.Reason)
			assert.Equal(t, tc.want == "automatic_disable", decision.Action == "retry")
		})
	}
}

func TestResponsesAutoDisableRetriesWithoutLeakingFailedAttempt(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, scenario := range []string{"failover succeeds", "all keys fail", "failure after output"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := newResponsesWSBillingTest(t, `tier("request", fixed(0.002))`, func(*websocket.Conn, *http.Request) {})
			common.RedisEnabled = false // Keep the affinity cache independent of each fixture Redis client.
			previousAuto, previousRetries, previousLogs := common.AutomaticDisableChannelEnabled, common.RetryTimes, constant.ErrorLogEnabled
			previousKeywords := operation_setting.AutomaticDisableKeywords
			common.AutomaticDisableChannelEnabled, common.RetryTimes, constant.ErrorLogEnabled = true, 3, true
			operation_setting.AutomaticDisableKeywords = []string{"insufficient_quota"}
			affinity := operation_setting.GetChannelAffinitySetting()
			previousAffinity := *affinity
			*affinity = operation_setting.ChannelAffinitySetting{Enabled: true, DefaultTTLSeconds: 60, MaxEntries: 100, Rules: []operation_setting.ChannelAffinityRule{{Name: "quota-failover", ModelRegex: []string{"^ws-billing$"}, PathRegex: []string{"/v1/responses"}, KeySources: []operation_setting.ChannelAffinityKeySource{{Type: "gjson", Path: "prompt_cache_key"}}, SkipRetryOnFailure: true}}}
			t.Cleanup(func() {
				common.AutomaticDisableChannelEnabled, common.RetryTimes, constant.ErrorLogEnabled = previousAuto, previousRetries, previousLogs
				operation_setting.AutomaticDisableKeywords = previousKeywords
				*affinity = previousAffinity
			})
			require.NoError(t, model.DB.Model(fixture.channel).Update("auto_ban", 1).Error)
			var attempts atomic.Int32
			fixture.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				attempt := attempts.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				if scenario == "all keys fail" || attempt == 1 {
					_, _ = fmt.Fprint(w, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"failed-attempt\",\"status\":\"in_progress\"}}\n\n")
					if scenario == "failure after output" {
						_, _ = fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
					}
					_, _ = fmt.Fprint(w, "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"insufficient_quota\",\"message\":\"Quota exhausted\"}}}\n\n")
					return
				}
				assert.Equal(t, "Bearer upstream-second", r.Header.Get("Authorization"))
				// The failed key is persisted before the second upstream attempt.
				stored, err := model.GetChannelById(fixture.channel.Id, true)
				if assert.NoError(t, err) {
					assert.Equal(t, common.ChannelStatusAutoDisabled, stored.ChannelInfo.MultiKeyStatusList[0])
				}
				_, _ = fmt.Fprint(w, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"successful-attempt\",\"status\":\"in_progress\"}}\n\n")
				_, _ = fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n\n")
				_, _ = fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"successful-attempt\",\"status\":\"completed\",\"usage\":{\"input_tokens\":4,\"output_tokens\":2,\"total_tokens\":6}}}\n\n")
			}
			request, err := http.NewRequest(http.MethodPost, fixture.gatewayURL+"/v1/responses", strings.NewReader(`{"model":"ws-billing","input":"hello","stream":true,"prompt_cache_key":"quota-test"}`))
			require.NoError(t, err)
			request.Header.Set("Authorization", "Bearer sk-"+fixture.token.Key)
			request.Header.Set("Content-Type", "application/json")
			response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
			require.NoError(t, err)
			body, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			require.NoError(t, response.Body.Close())
			select {
			case <-fixture.httpDone:
			case <-time.After(3 * time.Second):
				t.Fatal("relay did not finish")
			}
			stored, err := model.GetChannelById(fixture.channel.Id, true)
			require.NoError(t, err)
			assert.Equal(t, common.ChannelStatusAutoDisabled, stored.ChannelInfo.MultiKeyStatusList[0])
			var failures []model.Log
			require.NoError(t, model.LOG_DB.Where("type = ? AND token_id = ?", model.LogTypeError, fixture.token.Id).Find(&failures).Error)
			require.NotEmpty(t, failures)
			assert.Contains(t, failures[0].Content, "Quota exhausted")
			switch scenario {
			case "failover succeeds":
				assert.Equal(t, int32(2), attempts.Load())
				assert.Equal(t, http.StatusOK, response.StatusCode)
				assert.Contains(t, string(body), "successful-attempt")
				assert.NotContains(t, string(body), "failed-attempt")
				assert.NotContains(t, string(body), "response.failed")
				assert.NotContains(t, string(body), "Quota exhausted")
				assert.Contains(t, failures[0].Other, "automatic_disable")
				assertResponsesWSAccounting(t, fixture, []int{1000})
			case "all keys fail":
				assert.Equal(t, int32(2), attempts.Load())
				assert.GreaterOrEqual(t, response.StatusCode, 400)
				assert.NotContains(t, string(body), "data:")
				assert.Equal(t, common.ChannelStatusAutoDisabled, stored.Status)
				assertResponsesWSAccounting(t, fixture, nil)
			case "failure after output":
				assert.Equal(t, int32(1), attempts.Load())
				assert.Contains(t, string(body), "partial")
				assert.Equal(t, 1, strings.Count(string(body), "event: response.failed"))
				assertResponsesWSAccounting(t, fixture, []int{1000})
			}
		})
	}
}
