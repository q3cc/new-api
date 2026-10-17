package openai

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil {
		return nil, responsesAPIError(*oaiError)
	}

	info.ObserveResponseModel(responsesResponse.Model)
	responseBody = rewriteSGLangResponsesCreatedAt(info, responseBody, "created_at", responsesResponse.CreatedAt)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := &dto.Usage{}
	service.ApplyResponsesUsage(usage, responsesResponse.Usage)
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}
	info.ApplyVendorToolUsage(responseBody)

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	for i := range responsesResponse.Output {
		imageCounter.Observe(&responsesResponse.Output[i], &i)
	}
	imageCounter.Commit(info)

	return usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, common.LogText("invalid response or response body"))
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	accumulator := service.NewResponsesUsageAccumulator(info)
	var streamErr *types.NewAPIError
	disableFailure := false
	failureBeforeOutput := false
	bufferStartup := common.AutomaticDisableChannelEnabled && c.GetBool("auto_ban")
	// Hold only the startup events: a quota failure commonly follows
	// response.created/in_progress before any actual output. Bound this
	// buffer so a malformed upstream cannot grow it indefinitely.
	type pendingEvent struct {
		event dto.ResponsesStreamResponse
		data  string
	}
	var pending []pendingEvent
	pendingBytes := 0
	previousHeaders := c.Writer.Header().Clone()
	previousDeferPing := info.DeferPingUntilOutput
	info.DeferPingUntilOutput = bufferStartup
	defer func() { info.DeferPingUntilOutput = previousDeferPing }()

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		var event dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &event); err != nil {
			logger.LogError(c, common.LogText("failed to unmarshal stream response: %s", err.Error()))
			sr.Error(err)
			return
		}
		if event.Response != nil {
			data = string(rewriteSGLangResponsesCreatedAt(info, []byte(data), "response.created_at", event.Response.CreatedAt))
		}
		service.ObserveResponsesOutcome(info, &event)
		if info.StreamStatus.ResponseFailed() {
			oaiError := &types.OpenAIError{Code: event.Code, Message: event.Message, Param: event.Param}
			if event.Response != nil && event.Response.GetOpenAIError() != nil {
				oaiError = event.Response.GetOpenAIError()
			} else if raw := gjson.Get(data, "error"); raw.Exists() {
				if nested := dto.GetOpenAIError(raw.Value()); nested != nil {
					oaiError = nested
				}
			}
			if oaiError.Message == "" {
				oaiError.Message = "responses stream failed"
			}
			streamErr = responsesAPIError(*oaiError)
			disableFailure = c.GetBool("auto_ban") && service.ShouldDisableChannel(streamErr)
			info.StreamStatus.MarkFailed(string(streamErr.GetErrorCode()), streamErr.ToOpenAIError().Type, streamErr.StatusCode)
			// Preserve accounting if the terminal itself carries generated
			// output or explicit usage, even when it reports failure.
			hasUsageOrOutput := false
			if response := event.Response; response != nil {
				hasUsageOrOutput = len(response.Output) > 0
				if usage := response.Usage; usage != nil {
					hasUsageOrOutput = hasUsageOrOutput || usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.PromptTokens > 0 || usage.CompletionTokens > 0
				}
			}
			if disableFailure && !c.Writer.Written() && !hasUsageOrOutput {
				failureBeforeOutput = true
				sr.Done()
				return
			}
		}
		if bufferStartup && streamErr == nil && !c.Writer.Written() &&
			(event.Type == "response.created" || event.Type == "response.in_progress") && pendingBytes+len(data) <= 64<<10 {
			pending = append(pending, pendingEvent{event: event, data: data})
			pendingBytes += len(data)
			return
		}
		for _, buffered := range pending {
			sendResponsesStreamData(c, buffered.event, buffered.data)
			accumulator.Observe(&buffered.event, common.StringToByteSlice(buffered.data))
		}
		pending = nil
		sendResponsesStreamData(c, event, data)
		accumulator.Observe(&event, common.StringToByteSlice(data))
		if streamErr != nil {
			sr.Done()
		}
	})

	common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, info.StreamStatus)
	info.StreamStatus.RequireTerminal()
	if streamErr != nil && disableFailure {
		if failureBeforeOutput {
			// Do not carry a failed attempt's opaque turn state into
			// another upstream response.
			for _, name := range []string{"X-Codex-Turn-State", "X-Reasoning-Included"} {
				c.Writer.Header().Del(name)
				for _, value := range previousHeaders.Values(name) {
					c.Writer.Header().Add(name, value)
				}
			}
			return nil, streamErr
		}
		// Output already reached the client: keep its usage, report the
		// failure for channel health, and never replay this stream.
		service.RecordPolicyFailure(c, info.ChannelId, streamErr, service.DecideRelayRetry(c, streamErr, 0))
		service.ProcessChannelError(c, *types.NewChannelError(info.ChannelId, info.ChannelType, c.GetString("channel_name"), info.ChannelIsMultiKey, info.ApiKey, c.GetBool("auto_ban")), streamErr, info)
	}
	// An interrupted startup without an explicit failure retains the existing
	// forwarding and accounting contract.
	for _, buffered := range pending {
		sendResponsesStreamData(c, buffered.event, buffered.data)
		accumulator.Observe(&buffered.event, common.StringToByteSlice(buffered.data))
	}
	return accumulator.Finish(), nil
}

// Responses embeds errors in HTTP 200 bodies as well as SSE events. Restore
// an error status without requiring the optional OpenAI error.type field.
func responsesAPIError(upstream types.OpenAIError) *types.NewAPIError {
	status := http.StatusBadGateway
	switch fmt.Sprint(upstream.Code) {
	case "rate_limit_exceeded", "insufficient_quota", "usage_limit_reached":
		status = http.StatusTooManyRequests
	case "invalid_api_key", "invalid_authentication":
		status = http.StatusUnauthorized
	default:
		if code, err := strconv.Atoi(fmt.Sprint(upstream.Code)); err == nil && code >= 400 && code <= 599 {
			status = code
		}
	}
	return types.WithOpenAIError(upstream, status)
}

func rewriteSGLangResponsesCreatedAt(info *relaycommon.RelayInfo, payload []byte, path string, createdAt dto.IntValue) []byte {
	if info.GetChannelType() != constant.ChannelTypeSGLang {
		return payload
	}
	if !gjson.GetBytes(payload, path).Exists() {
		return payload
	}
	patched, err := sjson.SetBytes(payload, path, int(createdAt))
	if err != nil {
		return payload
	}
	return patched
}
