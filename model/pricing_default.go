package model

import (
	"slices"
	"strings"
)

// 简化的供应商映射规则
var defaultVendorRules = map[string]string{
	"gpt":      "OpenAI",
	"dall-e":   "OpenAI",
	"whisper":  "OpenAI",
	"o1":       "OpenAI",
	"o3":       "OpenAI",
	"claude":   "Anthropic",
	"gemini":   "Google",
	"moonshot": "Moonshot",
	"kimi":     "Moonshot",
	"chatglm":  "智谱",
	"glm-":     "智谱",
	"qwen":     "阿里巴巴",
	"deepseek": "DeepSeek",
	"abab":     "MiniMax",
	"minimax":  "MiniMax",
	"ernie":    "百度",
	"spark":    "讯飞",
	"hunyuan":  "腾讯",
	"command":  "Cohere",
	"@cf/":     "Cloudflare",
	"360":      "360",
	"yi":       "零一万物",
	"jina":     "Jina",
	"mistral":  "Mistral",
	"grok":     "xAI",
	"llama":    "Meta",
	"doubao":   "字节跳动",
	"kling":    "快手",
	"jimeng":   "即梦",
	"vidu":     "Vidu",
}

// 供应商默认图标映射
var defaultVendorIcons = map[string]string{
	"OpenAI":     "OpenAI",
	"Anthropic":  "Claude.Color",
	"Google":     "Gemini.Color",
	"Moonshot":   "Moonshot",
	"智谱":         "Zhipu.Color",
	"阿里巴巴":       "Qwen.Color",
	"DeepSeek":   "DeepSeek.Color",
	"MiniMax":    "Minimax.Color",
	"百度":         "Wenxin.Color",
	"讯飞":         "Spark.Color",
	"腾讯":         "Hunyuan.Color",
	"Cohere":     "Cohere.Color",
	"Cloudflare": "Cloudflare.Color",
	"360":        "Ai360.Color",
	"零一万物":       "Yi.Color",
	"Jina":       "Jina",
	"Mistral":    "Mistral.Color",
	"xAI":        "XAI",
	"Meta":       "Ollama",
	"字节跳动":       "Doubao.Color",
	"快手":         "Kling.Color",
	"即梦":         "Jimeng.Color",
	"Vidu":       "Vidu",
	"微软":         "AzureAI",
	"Microsoft":  "AzureAI",
	"Azure":      "AzureAI",
}

// initDefaultVendorMapping 简化的默认供应商映射
func initDefaultVendorMapping(metaMap map[string]*Model, vendorMap map[int]*Vendor, enableAbilities []AbilityWithChannel) {
	patterns := make([]string, 0, len(defaultVendorRules))
	for pattern := range defaultVendorRules {
		patterns = append(patterns, pattern)
	}
	slices.SortFunc(patterns, func(a, b string) int {
		if len(a) != len(b) {
			return len(b) - len(a)
		}
		return strings.Compare(a, b)
	})
	for _, ability := range enableAbilities {
		modelName := ability.Model
		if _, exists := metaMap[modelName]; exists {
			continue
		}

		// 匹配供应商
		vendorID := 0
		modelLower := strings.ToLower(modelName)
		for _, pattern := range patterns {
			vendorName := defaultVendorRules[pattern]
			if strings.Contains(modelLower, pattern) {
				vendorID = getDisplayVendor(vendorName, vendorMap)
				break
			}
		}

		// 创建模型元数据
		metaMap[modelName] = &Model{
			ModelName: modelName,
			VendorID:  vendorID,
			Status:    1,
			NameRule:  NameRuleExact,
		}
	}
}

// Default vendor entries are presentation data. Reading pricing must never
// recreate a deleted/merged database record.
var defaultVendorDisplayIDs = map[string]int{
	"360":        -1001,
	"Anthropic":  -1002,
	"Cloudflare": -1003,
	"Cohere":     -1004,
	"DeepSeek":   -1005,
	"Google":     -1006,
	"Jina":       -1007,
	"Meta":       -1008,
	"MiniMax":    -1009,
	"Mistral":    -1010,
	"Moonshot":   -1011,
	"OpenAI":     -1012,
	"Vidu":       -1013,
	"xAI":        -1014,
	"即梦":         -1015,
	"字节跳动":       -1016,
	"快手":         -1017,
	"智谱":         -1018,
	"百度":         -1019,
	"腾讯":         -1020,
	"讯飞":         -1021,
	"阿里巴巴":       -1022,
	"零一万物":       -1023,
}

func getDisplayVendor(vendorName string, vendorMap map[int]*Vendor) int {
	for id, vendor := range vendorMap {
		if strings.EqualFold(vendor.Name, vendorName) {
			return id
		}
	}
	id := defaultVendorDisplayIDs[vendorName]
	if id == 0 {
		return 0
	}
	vendorMap[id] = &Vendor{Id: id, Name: vendorName, Status: 1, Icon: getDefaultVendorIcon(vendorName)}
	return id
}

// 获取供应商默认图标
func getDefaultVendorIcon(vendorName string) string {
	if icon, exists := defaultVendorIcons[vendorName]; exists {
		return icon
	}
	return ""
}

// defaultModelTokenLimits provides catalog display metadata, not request limits
// or playground compression budgets. Only exact documented names and explicit
// aliases are recognized. Unknown/undocumented limits remain absent in JSON.
// Provider documentation checked 2026-10-16.
func defaultModelTokenLimits(name string) (context, output int) {
	switch strings.ToLower(name) {
	// https://platform.claude.com/docs/en/models/opus-5-5/overview
	// https://platform.claude.com/docs/en/models/opus-4-6/overview
	case "claude-opus-5-5", "claude-opus-4-6", "claude-opus-4-6-thinking":
		return 1000000, 128000
	// https://api-docs.deepseek.com/api/list-models/
	// The retired v4-flash alias currently resolves to V4.1-Flash.
	case "deepseek-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-v4-pro":
		return 1048576, 393216
	// https://huggingface.co/deepseek-ai/DeepSeek-V3.1/raw/main/config.json
	// https://huggingface.co/deepseek-ai/DeepSeek-V3.2/raw/main/config.json
	// Native model capacity; individual hosted APIs may impose smaller limits.
	case "deepseek-v3.1", "deepseek.v3.1", "deepseek-v3.2", "deepseek.v3.2":
		return 163840, 0
	// https://huggingface.co/google/gemma-4-31B-it/raw/main/config.json
	case "gemma-4-31b", "google.gemma-4-31b":
		return 262144, 0
	// https://ai.google.dev/gemini-api/docs/tokens
	// Gemini 3/2.5 have separate input/output budgets; show the input limit.
	case "gemini-3.1-pro", "gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-2.5-pro", "gemini-2.5-flash":
		return 1048576, 65536
	// https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
	// Long decode can use the entire shared window; ordinary synchronous output
	// is capped at 65,536. Do not present that default as the maximum.
	case "gemini-4-argon":
		return 1048576, 1048576
	// https://docs.x.ai/developers/models/grok-4.3
	case "grok-4.3", "grok-4.3-latest", "xai.grok-4.3":
		return 1000000, 0
	// https://docs.x.ai/developers/models/grok-4.6
	// No separate text output limit is published.
	case "grok-4.6", "xai.grok-4.6":
		return 500000, 0
	// https://platform.kimi.ai/docs/models
	case "kimi-k3":
		return 1000000, 0
	// https://huggingface.co/moonshotai/Kimi-K2.6/raw/main/config.json
	case "kimi-k2.6":
		return 262144, 0
	// https://docs.z.ai/guides/llm/glm-5.3
	// https://docs.z.ai/guides/vlm/glm-5.3-flash
	case "glm-5.3", "glm-5.3-flash":
		return 1000000, 128000
	// https://developers.openai.com/api/docs/models/gpt-4o
	// https://developers.openai.com/api/docs/models/gpt-4o-mini
	case "gpt-4o", "gpt-4o-mini":
		return 128000, 16384
	// https://developers.openai.com/api/docs/models/gpt-4.1
	case "gpt-4.1":
		return 1047576, 32768
	// https://developers.openai.com/api/docs/models/gpt-5
	case "gpt-5":
		return 400000, 128000
	}
	return 0, 0
}
