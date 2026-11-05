package operation_setting

import (
	"fmt"
	"strings"
	"sync/atomic"
)

// UpstreamErrorRewriteRule replaces an upstream error message that contains
// Keyword, ignoring case, with Message.
type UpstreamErrorRewriteRule struct {
	Keyword string
	Message string
}

// upstreamErrorRewriteSeparator splits a rule line into keyword and message.
const upstreamErrorRewriteSeparator = "=>"

// DefaultUpstreamErrorRewriteRules turns provider moderation rejections into
// one message readers understand.
const DefaultUpstreamErrorRewriteRules = "content policy => 会话被模型提供商云端拦截，请修改后重新尝试"

var upstreamErrorRewriteText atomic.Pointer[string]
var upstreamErrorRewriteRules atomic.Pointer[[]UpstreamErrorRewriteRule]

func init() {
	if err := UpstreamErrorRewriteRulesFromString(DefaultUpstreamErrorRewriteRules); err != nil {
		panic(err)
	}
}

// ParseUpstreamErrorRewriteRules reads one "keyword => message" rule per
// line. Blank lines are skipped; a line without both parts is an error.
func ParseUpstreamErrorRewriteRules(text string) ([]UpstreamErrorRewriteRule, error) {
	var rules []UpstreamErrorRewriteRule
	number := 0
	for line := range strings.SplitSeq(text, "\n") {
		number++
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		keyword, message, found := strings.Cut(line, upstreamErrorRewriteSeparator)
		keyword, message = strings.TrimSpace(keyword), strings.TrimSpace(message)
		if !found || keyword == "" || message == "" {
			return nil, fmt.Errorf("upstream error rewrite line %d must be \"keyword => message\"", number)
		}
		rules = append(rules, UpstreamErrorRewriteRule{Keyword: strings.ToLower(keyword), Message: message})
	}
	return rules, nil
}

func UpstreamErrorRewriteRulesFromString(text string) error {
	rules, err := ParseUpstreamErrorRewriteRules(text)
	if err != nil {
		return err
	}
	upstreamErrorRewriteRules.Store(&rules)
	upstreamErrorRewriteText.Store(&text)
	return nil
}

func UpstreamErrorRewriteRulesToString() string {
	return *upstreamErrorRewriteText.Load()
}

// RewriteUpstreamErrorMessage returns the message of the first rule whose
// keyword the upstream message contains.
func RewriteUpstreamErrorMessage(message string) (string, bool) {
	lower := strings.ToLower(message)
	for _, rule := range *upstreamErrorRewriteRules.Load() {
		if strings.Contains(lower, rule.Keyword) {
			return rule.Message, true
		}
	}
	return "", false
}
