package channel

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

type compiledResponseTextReplacement struct {
	pattern     *regexp.Regexp
	replacement string
}

type cachedResponseTextPattern struct {
	pattern *regexp.Regexp
	err     error
}

var responseTextPatternCache sync.Map

func applyResponseTextReplacements(resp *http.Response, info *relaycommon.RelayInfo) error {
	if resp == nil || resp.Body == nil || info == nil || info.ChannelMeta == nil {
		return nil
	}
	if resp.Header == nil {
		resp.Header = make(http.Header)
	}
	if resp.Header.Get("Content-Encoding") != "" || !isTextResponse(resp.Header.Get("Content-Type")) {
		return nil
	}

	rules := info.ChannelSetting.ResponseTextReplacements
	replacements := make([]compiledResponseTextReplacement, 0, len(rules))
	for i, rule := range rules {
		if !responseTextReplacementApplies(rule.Scope, resp.StatusCode) {
			continue
		}
		pattern, err := compileResponseTextPattern(rule.Pattern)
		if err != nil {
			return fmt.Errorf("compile response text replacement rule %d: %w", i, err)
		}
		replacements = append(replacements, compiledResponseTextReplacement{
			pattern:     pattern,
			replacement: rule.Replacement,
		})
	}
	if len(replacements) == 0 {
		return nil
	}

	if info.IsStream {
		resp.Body = &responseTextReplacingReadCloser{
			source:       resp.Body,
			reader:       bufio.NewReader(resp.Body),
			replacements: replacements,
		}
		resp.ContentLength = -1
		resp.Header.Del("Content-Length")
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response for text replacement: %w", err)
	}
	_ = resp.Body.Close()
	body = replaceResponseText(body, replacements)
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	return nil
}

func compileResponseTextPattern(pattern string) (*regexp.Regexp, error) {
	if cached, ok := responseTextPatternCache.Load(pattern); ok {
		entry := cached.(cachedResponseTextPattern)
		return entry.pattern, entry.err
	}
	compiled, err := regexp.Compile(pattern)
	entry := cachedResponseTextPattern{pattern: compiled, err: err}
	actual, _ := responseTextPatternCache.LoadOrStore(pattern, entry)
	cached := actual.(cachedResponseTextPattern)
	return cached.pattern, cached.err
}

func responseTextReplacementApplies(scope dto.ResponseTextReplacementScope, statusCode int) bool {
	isError := statusCode >= http.StatusBadRequest
	switch scope {
	case dto.ResponseTextReplacementScopeError:
		return isError
	case dto.ResponseTextReplacementScopeResponse:
		return !isError
	case dto.ResponseTextReplacementScopeAll:
		return true
	default:
		return false
	}
}

func isTextResponse(contentType string) bool {
	if strings.TrimSpace(contentType) == "" {
		return true
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	mediaType = strings.ToLower(mediaType)
	if strings.HasPrefix(mediaType, "audio/") ||
		strings.HasPrefix(mediaType, "image/") ||
		strings.HasPrefix(mediaType, "video/") ||
		strings.HasPrefix(mediaType, "multipart/") {
		return false
	}
	return mediaType != "application/octet-stream" && mediaType != "application/pdf"
}

func replaceResponseText(data []byte, replacements []compiledResponseTextReplacement) []byte {
	for _, replacement := range replacements {
		data = replacement.pattern.ReplaceAll(data, []byte(replacement.replacement))
	}
	return data
}

type responseTextReplacingReadCloser struct {
	source       io.ReadCloser
	reader       *bufio.Reader
	replacements []compiledResponseTextReplacement
	pending      []byte
	terminalErr  error
}

func (r *responseTextReplacingReadCloser) Read(p []byte) (int, error) {
	for len(r.pending) == 0 && r.terminalErr == nil {
		line, err := r.reader.ReadBytes('\n')
		if len(line) > 0 {
			r.pending = replaceResponseText(line, r.replacements)
		}
		if err != nil {
			r.terminalErr = err
		}
	}
	if len(r.pending) == 0 {
		return 0, r.terminalErr
	}
	n := copy(p, r.pending)
	r.pending = r.pending[n:]
	return n, nil
}

func (r *responseTextReplacingReadCloser) Close() error {
	return r.source.Close()
}
