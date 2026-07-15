package channel

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyResponseTextReplacementsByScope(t *testing.T) {
	rules := []dto.ResponseTextReplacementRule{
		{Pattern: `secret-(\d+)`, Replacement: `code-$1`, Scope: dto.ResponseTextReplacementScopeError},
		{Pattern: `old`, Replacement: `new`, Scope: dto.ResponseTextReplacementScopeResponse},
		{Pattern: `internal`, Replacement: `public`, Scope: dto.ResponseTextReplacementScopeAll},
	}

	tests := []struct {
		name       string
		statusCode int
		body       string
		want       string
	}{
		{
			name:       "error response",
			statusCode: http.StatusBadGateway,
			body:       `{"error":"secret-42 internal old"}`,
			want:       `{"error":"code-42 public old"}`,
		},
		{
			name:       "successful response",
			statusCode: http.StatusOK,
			body:       `{"content":"secret-42 internal old"}`,
			want:       `{"content":"secret-42 public new"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := &http.Response{
				StatusCode: tt.statusCode,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(tt.body)),
			}
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
				ChannelSetting: dto.ChannelSettings{ResponseTextReplacements: rules},
			}}

			require.NoError(t, applyResponseTextReplacements(resp, info))
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			assert.Equal(t, tt.want, string(body))
			assert.Equal(t, int64(len(tt.want)), resp.ContentLength)
			contentLength, err := strconv.Atoi(resp.Header.Get("Content-Length"))
			require.NoError(t, err)
			assert.Equal(t, len(tt.want), contentLength)
		})
	}
}

func TestApplyResponseTextReplacementsToStreamLines(t *testing.T) {
	body := "data: {\"content\":\"old-12\"}\n\ndata: [DONE]\n\n"
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
	info := &relaycommon.RelayInfo{
		IsStream: true,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{
			ResponseTextReplacements: []dto.ResponseTextReplacementRule{
				{Pattern: `old-(\d+)`, Replacement: `new-$1`, Scope: dto.ResponseTextReplacementScopeResponse},
			},
		}},
	}

	require.NoError(t, applyResponseTextReplacements(resp, info))
	data, err := io.ReadAll(&oneByteReader{reader: resp.Body})
	require.NoError(t, err)
	assert.Equal(t, "data: {\"content\":\"new-12\"}\n\ndata: [DONE]\n\n", string(data))
	assert.Equal(t, int64(-1), resp.ContentLength)
	assert.Empty(t, resp.Header.Get("Content-Length"))
}

func TestApplyResponseTextReplacementsSkipsBinaryBody(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"audio/mpeg"}, "Content-Length": []string{"3"}},
		Body:       io.NopCloser(strings.NewReader("old")),
	}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{
		ResponseTextReplacements: []dto.ResponseTextReplacementRule{
			{Pattern: "old", Replacement: "new", Scope: dto.ResponseTextReplacementScopeAll},
		},
	}}}

	require.NoError(t, applyResponseTextReplacements(resp, info))
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, "old", string(body))
	assert.Equal(t, "3", resp.Header.Get("Content-Length"))
}

type oneByteReader struct {
	reader io.Reader
}

func (r *oneByteReader) Read(p []byte) (int, error) {
	return r.reader.Read(p[:1])
}
