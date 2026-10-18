package gemini

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/tokenkit"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamResponseGeminiChat2OpenAIAttachesUsageMetadata(t *testing.T) {
	t.Parallel()

	withUsage, isStop := streamResponseGeminiChat2OpenAI(&dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{
				Role:  "model",
				Parts: []dto.GeminiPart{{Text: "hello"}},
			},
		}},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:     3868,
			CandidatesTokenCount: 0,
			TotalTokenCount:      3868,
		},
	})
	require.False(t, isStop)
	require.NotNil(t, withUsage)
	require.NotNil(t, withUsage.Usage)
	require.Equal(t, 3868, withUsage.Usage.PromptTokens)
	require.Equal(t, 3868, withUsage.Usage.TotalTokens)
	require.NotNil(t, withUsage.Usage.BillingUsage)
	require.Equal(t, dto.BillingUsageSourceGeminiChat, withUsage.Usage.BillingUsage.Source)
	require.Equal(t, dto.BillingUsageSemanticGemini, withUsage.Usage.BillingUsage.Semantic)
	require.NotNil(t, withUsage.Usage.BillingUsage.GeminiUsageMetadata)
	require.Equal(t, 3868, withUsage.Usage.BillingUsage.GeminiUsageMetadata.PromptTokenCount)
	require.False(t, withUsage.Usage.BillingUsage.Estimated)

	withoutUsage, _ := streamResponseGeminiChat2OpenAI(&dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{
				Role:  "model",
				Parts: []dto.GeminiPart{{Text: "hello"}},
			},
		}},
	})
	require.NotNil(t, withoutUsage)
	require.Nil(t, withoutUsage.Usage)
}

func TestGeminiChatStreamHandlerClaudeFirstFrameUsesUpstreamUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)

	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})

	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatClaude,
		OriginModelName: "gemini-2.5-flash",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-2.5-flash",
		},
		ClaudeConvertInfo: &relaycommon.ClaudeConvertInfo{
			LastMessagesType: relaycommon.LastMessageTypeNone,
		},
	}
	info.SetEstimatePromptTokens(4994)

	chunkData, err := common.Marshal(dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{
				Role:  "model",
				Parts: []dto.GeminiPart{{Text: "hello"}},
			},
		}},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount: 3868,
			TotalTokenCount:  3868,
		},
	})
	require.NoError(t, err)
	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader([]byte("data: " + string(chunkData) + "\n" + "data: [DONE]\n"))),
	}

	usage, newAPIError := GeminiChatStreamHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 3868, usage.PromptTokens)

	var startUsage, deltaUsage *dto.ClaudeUsage
	for line := range strings.SplitSeq(recorder.Body.String(), "\n") {
		payload, ok := strings.CutPrefix(strings.TrimSpace(line), "data: ")
		if !ok {
			continue
		}
		var event dto.ClaudeResponse
		if err := common.UnmarshalJsonStr(payload, &event); err != nil {
			continue
		}
		switch event.Type {
		case "message_start":
			if event.Message != nil {
				startUsage = event.Message.Usage
			}
		case "message_delta":
			deltaUsage = event.Usage
		}
	}

	require.NotNil(t, startUsage)
	require.Equal(t, 3868, startUsage.InputTokens)
	require.NotNil(t, startUsage.BillingUsage)
	require.Equal(t, dto.BillingUsageSourceGeminiChat, startUsage.BillingUsage.Source)
	require.Equal(t, dto.BillingUsageSemanticGemini, startUsage.BillingUsage.Semantic)
	require.NotNil(t, startUsage.BillingUsage.GeminiUsageMetadata)
	require.Equal(t, 3868, startUsage.BillingUsage.GeminiUsageMetadata.PromptTokenCount)
	require.False(t, startUsage.BillingUsage.Estimated)

	require.NotNil(t, deltaUsage)
	require.Equal(t, 3868, deltaUsage.InputTokens)
	require.NotNil(t, deltaUsage.BillingUsage)
	require.Equal(t, dto.BillingUsageSourceGeminiChat, deltaUsage.BillingUsage.Source)
	require.Equal(t, dto.BillingUsageSemanticGemini, deltaUsage.BillingUsage.Semantic)
	require.NotNil(t, deltaUsage.BillingUsage.GeminiUsageMetadata)
	require.Equal(t, 3868, deltaUsage.BillingUsage.GeminiUsageMetadata.PromptTokenCount)
}

func TestGeminiChatHandlerCompletionTokensExcludeToolUsePromptTokens(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatGemini,
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}

	payload := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "ok"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:        151,
			ToolUsePromptTokenCount: 18329,
			CandidatesTokenCount:    1089,
			ThoughtsTokenCount:      1120,
			TotalTokenCount:         20689,
		},
	}

	body, err := common.Marshal(payload)
	require.NoError(t, err)

	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(body)),
	}

	usage, newAPIError := GeminiChatHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 18480, usage.PromptTokens)
	require.Equal(t, 2209, usage.CompletionTokens)
	require.Equal(t, 20689, usage.TotalTokens)
	require.Equal(t, 1120, usage.CompletionTokenDetails.ReasoningTokens)
}

func TestGeminiStreamHandlerCompletionTokensExcludeToolUsePromptTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}

	chunk := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "partial"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:        151,
			ToolUsePromptTokenCount: 18329,
			CandidatesTokenCount:    1089,
			ThoughtsTokenCount:      1120,
			TotalTokenCount:         20689,
		},
	}

	chunkData, err := common.Marshal(chunk)
	require.NoError(t, err)

	streamBody := []byte("data: " + string(chunkData) + "\n" + "data: [DONE]\n")
	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(streamBody)),
	}

	usage, newAPIError := geminiStreamHandler(c, info, resp, func(_ string, _ *dto.GeminiChatResponse) bool {
		return true
	})
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 18480, usage.PromptTokens)
	require.Equal(t, 2209, usage.CompletionTokens)
	require.Equal(t, 20689, usage.TotalTokens)
	require.Equal(t, 1120, usage.CompletionTokenDetails.ReasoningTokens)
}

func TestGeminiTextGenerationHandlerPromptTokensIncludeToolUsePromptTokens(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-3-flash-preview:generateContent", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}

	payload := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "ok"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:        151,
			ToolUsePromptTokenCount: 18329,
			CandidatesTokenCount:    1089,
			ThoughtsTokenCount:      1120,
			TotalTokenCount:         20689,
		},
	}

	body, err := common.Marshal(payload)
	require.NoError(t, err)

	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(body)),
	}

	usage, newAPIError := GeminiTextGenerationHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 18480, usage.PromptTokens)
	require.Equal(t, 2209, usage.CompletionTokens)
	require.Equal(t, 20689, usage.TotalTokens)
	require.Equal(t, 1120, usage.CompletionTokenDetails.ReasoningTokens)
}

func TestGeminiChatHandlerUsesEstimatedPromptTokensWhenUsagePromptMissing(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatGemini,
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}
	info.SetEstimatePromptTokens(20)

	payload := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "ok"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:        0,
			ToolUsePromptTokenCount: 0,
			CandidatesTokenCount:    90,
			ThoughtsTokenCount:      10,
			TotalTokenCount:         110,
		},
	}

	body, err := common.Marshal(payload)
	require.NoError(t, err)

	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(body)),
	}

	usage, newAPIError := GeminiChatHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 20, usage.PromptTokens)
	require.Equal(t, 100, usage.CompletionTokens)
	require.Equal(t, 110, usage.TotalTokens)
}

func TestGeminiStreamHandlerUsesEstimatedPromptTokensWhenUsagePromptMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}
	info.SetEstimatePromptTokens(20)

	chunk := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "partial"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:        0,
			ToolUsePromptTokenCount: 0,
			CandidatesTokenCount:    90,
			ThoughtsTokenCount:      10,
			TotalTokenCount:         110,
		},
	}

	chunkData, err := common.Marshal(chunk)
	require.NoError(t, err)

	streamBody := []byte("data: " + string(chunkData) + "\n" + "data: [DONE]\n")
	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(streamBody)),
	}

	usage, newAPIError := geminiStreamHandler(c, info, resp, func(_ string, _ *dto.GeminiChatResponse) bool {
		return true
	})
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 20, usage.PromptTokens)
	require.Equal(t, 100, usage.CompletionTokens)
	require.Equal(t, 110, usage.TotalTokens)
}

func TestGeminiTextGenerationHandlerUsesEstimatedPromptTokensWhenUsagePromptMissing(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-3-flash-preview:generateContent", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}
	info.SetEstimatePromptTokens(20)

	payload := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "ok"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount:        0,
			ToolUsePromptTokenCount: 0,
			CandidatesTokenCount:    90,
			ThoughtsTokenCount:      10,
			TotalTokenCount:         110,
		},
	}

	body, err := common.Marshal(payload)
	require.NoError(t, err)

	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(body)),
	}

	usage, newAPIError := GeminiTextGenerationHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 20, usage.PromptTokens)
	require.Equal(t, 100, usage.CompletionTokens)
	require.Equal(t, 110, usage.TotalTokens)
}

func TestGeminiChatHandlerMissingUsageMetadataBuildsEstimatedBillingUsage(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatGemini,
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}
	info.SetEstimatePromptTokens(20)

	body := []byte(`{"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]}}]}`)
	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(body)),
	}

	usage, newAPIError := GeminiChatHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 20, usage.PromptTokens)
	require.NotNil(t, usage.BillingUsage)
	require.True(t, usage.BillingUsage.Estimated)
	require.Equal(t, dto.BillingUsageSourceGeminiChat, usage.BillingUsage.Source)
	require.Equal(t, dto.BillingUsageSemanticGemini, usage.BillingUsage.Semantic)
	require.NotNil(t, usage.BillingUsage.GeminiUsageMetadata)
	require.Equal(t, usage.PromptTokens, usage.BillingUsage.GeminiUsageMetadata.PromptTokenCount)
	require.Equal(t, usage.CompletionTokens, usage.BillingUsage.GeminiUsageMetadata.CandidatesTokenCount)
	require.True(t, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
}

func TestGeminiStreamHandlerPromptOnlyUsageMetadataEstimatesCompletionTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})

	for _, tc := range []struct {
		name      string
		part      dto.GeminiPart
		usageText string
	}{
		{"text", dto.GeminiPart{Text: "partial streamed answer before disconnect"}, "partial streamed answer before disconnect"},
		// An agent turn that only calls a tool still produced output tokens.
		{"function call", dto.GeminiPart{FunctionCall: &dto.FunctionCall{FunctionName: "read_file", Arguments: map[string]any{"path": "main.go"}}}, `read_file{"path":"main.go"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

			info := &relaycommon.RelayInfo{
				OriginModelName: "gemini-3-flash-preview",
				ChannelMeta: &relaycommon.ChannelMeta{
					UpstreamModelName: "gemini-3-flash-preview",
				},
			}
			info.SetEstimatePromptTokens(20)

			// Simulates a client aborting the stream before the final chunk: output was
			// streamed but the last observed usageMetadata only carries prompt tokens.
			chunk := dto.GeminiChatResponse{
				Candidates: []dto.GeminiChatCandidate{
					{
						Content: dto.GeminiChatContent{
							Role:  "model",
							Parts: []dto.GeminiPart{tc.part},
						},
					},
				},
				UsageMetadata: dto.GeminiUsageMetadata{
					PromptTokenCount: 151,
					TotalTokenCount:  151,
				},
			}

			chunkData, err := common.Marshal(chunk)
			require.NoError(t, err)

			streamBody := []byte("data: " + string(chunkData) + "\n" + "data: [DONE]\n")
			resp := &http.Response{
				Body: io.NopCloser(bytes.NewReader(streamBody)),
			}

			usage, newAPIError := geminiStreamHandler(c, info, resp, func(_ string, _ *dto.GeminiChatResponse) bool {
				return true
			})
			require.Nil(t, newAPIError)
			require.NotNil(t, usage)
			require.Equal(t, 151, usage.PromptTokens)
			require.Equal(t, tokenkit.Estimate("gemini-3-flash-preview", tc.usageText), usage.CompletionTokens)
			require.Greater(t, usage.CompletionTokens, 0)
			require.Equal(t, usage.PromptTokens+usage.CompletionTokens, usage.TotalTokens)
			require.NotNil(t, usage.BillingUsage)
			require.True(t, usage.BillingUsage.Estimated)
			require.NotNil(t, usage.BillingUsage.GeminiUsageMetadata)
			require.Equal(t, usage.CompletionTokens, usage.BillingUsage.GeminiUsageMetadata.CandidatesTokenCount)
		})
	}
}

func TestGeminiChatHandlerPromptOnlyUsageMetadataEstimatesCompletionTokens(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatGemini,
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}

	payload := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Role: "model",
					Parts: []dto.GeminiPart{
						{Text: "answer text without candidate token count"},
					},
				},
			},
		},
		UsageMetadata: dto.GeminiUsageMetadata{
			PromptTokenCount: 151,
			TotalTokenCount:  151,
		},
	}

	body, err := common.Marshal(payload)
	require.NoError(t, err)

	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(body)),
	}

	usage, newAPIError := GeminiChatHandler(c, info, resp)
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 151, usage.PromptTokens)
	require.Greater(t, usage.CompletionTokens, 0)
	require.Equal(t, usage.PromptTokens+usage.CompletionTokens, usage.TotalTokens)
	require.NotNil(t, usage.BillingUsage)
	require.True(t, usage.BillingUsage.Estimated)
}

func TestGeminiStreamHandlerEmptyUsageMetadataBuildsEstimatedBillingUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-flash-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-flash-preview",
		},
	}
	info.SetEstimatePromptTokens(20)

	streamBody := []byte("data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"partial\"}]}}],\"usageMetadata\":{}}\n" + "data: [DONE]\n")
	resp := &http.Response{
		Body: io.NopCloser(bytes.NewReader(streamBody)),
	}

	usage, newAPIError := geminiStreamHandler(c, info, resp, func(_ string, _ *dto.GeminiChatResponse) bool {
		return true
	})
	require.Nil(t, newAPIError)
	require.NotNil(t, usage)
	require.Equal(t, 20, usage.PromptTokens)
	require.NotNil(t, usage.BillingUsage)
	require.True(t, usage.BillingUsage.Estimated)
	require.Equal(t, dto.BillingUsageSourceGeminiChat, usage.BillingUsage.Source)
	require.NotNil(t, usage.BillingUsage.GeminiUsageMetadata)
	require.Equal(t, usage.PromptTokens, usage.BillingUsage.GeminiUsageMetadata.PromptTokenCount)
	require.Equal(t, usage.CompletionTokens, usage.BillingUsage.GeminiUsageMetadata.CandidatesTokenCount)
	require.True(t, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
}

// Google Search grounding records the unique trimmed non-empty queries
// (webSearchQueries and imageSearchQueries of every candidate, across every
// stream frame) under google_search and one grounded prompt when any query
// exists; the tool price table decides which of the two a model pays for.
func TestGeminiHandlersCountGroundingQueries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})
	const text = `"content":{"role":"model","parts":[{"text":"ok"}]}`
	grounded := func(queries int) map[string]int {
		return map[string]int{dto.BuildInToolGoogleSearch: queries, relaycommon.GoogleSearchGroundedPromptTool: 1}
	}

	tests := []struct {
		name   string
		stream bool
		frames []string
		want   map[string]int
	}{
		{
			name:   "native non-stream",
			frames: []string{`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["Shanghai weather today","current weather in Shanghai"],"groundingChunks":[{"web":{"uri":"https://a.example"}}]}}]}`},
			want:   grounded(2),
		},
		{
			name:   "duplicates, whitespace and empty queries",
			frames: []string{`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["go release",""," go release ","   ","tokyo"]}}]}`},
			want:   grounded(2),
		},
		{
			name:   "union across candidates",
			frames: []string{`{"candidates":[{"index":0,` + text + `,"groundingMetadata":{"webSearchQueries":["q1","q2"]}},{"index":1,` + text + `,"groundingMetadata":{"webSearchQueries":["q2","q3"]}}]}`},
			want:   grounded(3),
		},
		{
			name:   "image queries count like web queries",
			frames: []string{`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["cat breeds","orange cat"],"imageSearchQueries":["orange tabby cat photo","orange cat"]}}]}`},
			want:   grounded(3),
		},
		{
			name:   "only empty queries",
			frames: []string{`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["","  "],"imageSearchQueries":[""]}}]}`},
			want:   map[string]int{},
		},
		{
			name:   "no grounding metadata",
			frames: []string{`{"candidates":[{` + text + `,"finishReason":"STOP"}]}`},
			want:   map[string]int{},
		},
		{
			name:   "stream union across frames",
			stream: true,
			frames: []string{
				`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["q1"]}}]}`,
				`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["q2","q1 "]}}]}`,
				`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["q3"]}}]}`,
			},
			want: grounded(3),
		},
		{
			name:   "stream repeats are not added up",
			stream: true,
			frames: []string{
				`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["q1","q2"]}}]}`,
				`{"candidates":[{` + text + `,"groundingMetadata":{"webSearchQueries":["q1","q2"]}}]}`,
			},
			want: grounded(2),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-3.7-flash:generateContent", nil)
			info := &relaycommon.RelayInfo{
				OriginModelName: "gemini-3.7-flash",
				ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: "gemini-3.7-flash"},
			}
			var apiErr *types.NewAPIError
			if tt.stream {
				body := "data: " + strings.Join(tt.frames, "\ndata: ") + "\ndata: [DONE]\n"
				_, apiErr = geminiStreamHandler(c, info, &http.Response{Body: io.NopCloser(strings.NewReader(body))}, func(string, *dto.GeminiChatResponse) bool {
					return true
				})
			} else {
				_, apiErr = GeminiTextGenerationHandler(c, info, &http.Response{Body: io.NopCloser(strings.NewReader(tt.frames[0]))})
			}
			require.Nil(t, apiErr)
			counts := map[string]int{}
			if info.ResponsesUsageInfo != nil {
				for name, tool := range info.ResponsesUsageInfo.BuiltInTools {
					counts[name] = tool.CallCount
				}
			}
			assert.Equal(t, tt.want, counts)
		})
	}
}

// Reproduce the rejected Gemini stream that used to bill 639 estimated input
// tokens and look like a successful empty response through a New API channel.
func TestGeminiGenerationFailuresPreserveReasonAndMeasuredUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	routes := []struct {
		name    string
		stream  bool
		format  types.RelayFormat
		handler func(*gin.Context, *relaycommon.RelayInfo, *http.Response) (*dto.Usage, *types.NewAPIError)
	}{
		{"chat JSON", false, types.RelayFormatOpenAI, GeminiChatHandler},
		{"Claude JSON", false, types.RelayFormatClaude, GeminiChatHandler},
		{"native JSON", false, types.RelayFormatGemini, GeminiTextGenerationHandler},
		{"Responses JSON", false, types.RelayFormatOpenAIResponses, GeminiResponsesHandler},
		{"chat stream", true, types.RelayFormatOpenAI, GeminiChatStreamHandler},
		{"Claude stream", true, types.RelayFormatClaude, GeminiChatStreamHandler},
		{"native stream", true, types.RelayFormatGemini, GeminiTextGenerationStreamHandler},
		{"Responses stream", true, types.RelayFormatOpenAIResponses, GeminiResponsesStreamHandler},
	}
	for _, tc := range []struct {
		name, body, reason string
		code               types.ErrorCode
		prompt, completion int
	}{
		{name: "prohibited prompt", body: `{"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}}`, reason: "PROHIBITED_CONTENT", code: types.ErrorCodePromptBlocked},
		{name: "suppressed safety text", body: `{"candidates":[{"content":{"parts":[{"text":"suppressed by safety"}]},"finishReason":"SAFETY"}]}`, reason: "SAFETY", code: types.ErrorCodePromptBlocked},
		{name: "candidate safety", body: `{"candidates":[{"content":{"parts":[]},"finishReason":"SAFETY"}]}`, reason: "SAFETY", code: types.ErrorCodePromptBlocked},
		{name: "no candidates", body: `{"candidates":[]}`, code: types.ErrorCodeEmptyResponse},
		{name: "empty stop", body: `{"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}`, code: types.ErrorCodeEmptyResponse},
		{name: "image without payload", body: `{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png"}}]},"finishReason":"STOP"}]}`, code: types.ErrorCodeEmptyResponse},
		{name: "upstream prompt usage", body: `{"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"},"usageMetadata":{"promptTokenCount":7,"totalTokenCount":7}}`, reason: "PROHIBITED_CONTENT", code: types.ErrorCodePromptBlocked, prompt: 7},
		{name: "upstream thinking usage without output", body: `{"candidates":[],"usageMetadata":{"thoughtsTokenCount":3,"totalTokenCount":3}}`, code: types.ErrorCodeEmptyResponse, completion: 3},
	} {
		for _, route := range routes {
			t.Run(tc.name+"/"+route.name, func(t *testing.T) {
				rec := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(rec)
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
				c.Request.Header.Set("Accept-Language", "en")
				info := newGeminiResponsesRelayInfo(route.stream)
				info.RelayFormat = route.format
				if route.format == types.RelayFormatClaude {
					info.ClaudeConvertInfo = &relaycommon.ClaudeConvertInfo{}
				}
				info.SetEstimatePromptTokens(639)
				body := tc.body
				if route.stream {
					body = "data: " + body + "\n\ndata: [DONE]\n\n"
				}
				usage, apiErr := route.handler(c, info, &http.Response{Body: io.NopCloser(strings.NewReader(body))})
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.code, apiErr.GetErrorCode())
				assert.True(t, types.IsSkipRetryError(apiErr))
				if tc.reason != "" {
					assert.Contains(t, apiErr.ToOpenAIError().Message, tc.reason)
					assert.Contains(t, apiErr.ToOpenAIError().Message, "Gemini blocked")
					assert.True(t, info.PerformanceBusinessRejection)
				}
				require.NotNil(t, usage)
				assert.Equal(t, tc.prompt, usage.PromptTokens)
				assert.Equal(t, tc.completion, usage.CompletionTokens)
				if tc.prompt+tc.completion > 0 {
					require.NotNil(t, usage.BillingUsage)
					assert.False(t, usage.BillingUsage.Estimated)
				}
				assert.NotContains(t, rec.Body.String(), `"status":"completed"`)
				assert.NotContains(t, rec.Body.String(), "data: [DONE]")
				assert.NotContains(t, rec.Body.String(), `"finish_reason":"stop"`)
				if route.stream {
					assert.Equal(t, relaycommon.ResponseOutcomeFailed, info.StreamStatus.OutcomeSnapshot().Response)
				}
			})
		}
	}
}

func TestGeminiNonTextOutputStillHasBillableEstimates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{
		`{"candidates":[{"content":{"parts":[{"functionCall":{"name":"lookup","args":{"q":"test"}}}]}}]}`,
		`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"cGF5bG9hZA=="}}]}}]}`,
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		info := newGeminiResponsesRelayInfo(false)
		info.SetEstimatePromptTokens(20)
		var response dto.GeminiChatResponse
		require.NoError(t, common.UnmarshalJsonStr(body, &response))
		assert.True(t, geminiResponseHasOutput(&response))
		usage := buildUsageFromGeminiResponse(c, info, &response)
		assert.Equal(t, 20, usage.PromptTokens)
		require.NotNil(t, usage.BillingUsage)
		assert.True(t, usage.BillingUsage.Estimated)
	}
}

func TestGeminiLateSafetyRejectionKeepsOnlyDeliveredEstimates(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := newGeminiResponsesRelayInfo(true)
	info.RelayFormat = types.RelayFormatOpenAI
	info.SetEstimatePromptTokens(20)
	body := `data: {"candidates":[{"content":{"parts":[{"text":"delivered"}]}}]}` + "\n\n" +
		`data: {"candidates":[{"content":{"parts":[{"text":"suppressed content"}]},"finishReason":"SAFETY"}]}` + "\n\ndata: [DONE]\n\n"
	usage, apiErr := GeminiChatStreamHandler(c, info, &http.Response{Body: io.NopCloser(strings.NewReader(body))})
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodePromptBlocked, apiErr.GetErrorCode())
	require.NotNil(t, usage)
	assert.Equal(t, 20, usage.PromptTokens)
	assert.Equal(t, tokenkit.Estimate(info.UpstreamModelName, "delivered"), usage.CompletionTokens)
	assert.Contains(t, rec.Body.String(), "delivered")
	assert.NotContains(t, rec.Body.String(), "suppressed content")
	assert.NotContains(t, rec.Body.String(), "data: [DONE]")
}

// A frame the provider rejected as unsafe must not contribute tool-call or
// grounding facts: the caller never receives that content, so billing it would
// charge for suppressed output.
func TestGeminiRejectedFrameContributesNoBillableToolCalls(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	operation_setting.SetToolPriceForTest("gemini_rejected_fn", 5)
	t.Cleanup(func() { operation_setting.DeleteToolPriceForTest("gemini_rejected_fn") })
	body := `data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"gemini_rejected_fn","args":{}}}]},"finishReason":"SAFETY"}]}` + "\n\ndata: [DONE]\n\n"
	for _, stream := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		c.Request.Header.Set("Accept-Language", "en")
		info := newGeminiResponsesRelayInfo(stream)
		info.RelayFormat = types.RelayFormatOpenAI
		var apiErr *types.NewAPIError
		if stream {
			_, apiErr = GeminiChatStreamHandler(c, info, &http.Response{Body: io.NopCloser(strings.NewReader(body))})
		} else {
			var response dto.GeminiChatResponse
			require.NoError(t, common.UnmarshalJsonStr(`{"candidates":[{"content":{"parts":[{"functionCall":{"name":"gemini_rejected_fn","args":{}}}]},"finishReason":"SAFETY"}]}`, &response))
			apiErr = geminiResponseRejection(c, info, &response)
			if apiErr == nil {
				countGeminiBillableFunctionCalls(info, &response)
			}
		}
		require.NotNil(t, apiErr)
		require.Equal(t, types.ErrorCodePromptBlocked, apiErr.GetErrorCode())
		if info.ResponsesUsageInfo != nil {
			assert.Empty(t, info.ResponsesUsageInfo.BuiltInTools,
				"a rejected frame must not bill tool calls (stream=%v)", stream)
		}
	}
}

// An accepted frame keeps billing its priced tool calls, so the guard above is
// narrowing what counts rather than disabling the counter.
func TestGeminiAcceptedFrameBillsPricedToolCalls(t *testing.T) {
	gin.SetMode(gin.TestMode)
	operation_setting.SetToolPriceForTest("gemini_accepted_fn", 5)
	t.Cleanup(func() { operation_setting.DeleteToolPriceForTest("gemini_accepted_fn") })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newGeminiResponsesRelayInfo(false)
	var response dto.GeminiChatResponse
	require.NoError(t, common.UnmarshalJsonStr(`{"candidates":[{"content":{"parts":[{"functionCall":{"name":"gemini_accepted_fn","args":{}}}]},"finishReason":"STOP"}]}`, &response))
	require.Nil(t, geminiResponseRejection(c, info, &response))
	countGeminiBillableFunctionCalls(info, &response)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, "gemini_accepted_fn")
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools["gemini_accepted_fn"].CallCount)
}
