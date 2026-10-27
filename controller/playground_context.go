package controller

import (
	"encoding/json"
	"net/http"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/tokenkit"
	"github.com/gin-gonic/gin"
)

// Use the same entitlement source as the playground's existing model picker.
func playgroundModels(c *gin.Context, group string) ([]string, bool) {
	user, err := model.GetUserCache(c.GetInt("id"))
	if err != nil {
		playgroundError(c, err)
		return nil, false
	}
	groups := service.GetUserUsableGroups(user.Group, user.Id)
	selected := make([]string, 0, len(groups))
	if group == "" {
		for name := range groups {
			selected = append(selected, name)
		}
	} else if _, ok := groups[group]; !ok {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Group is not available"))
		return nil, false
	} else if group == "auto" {
		selected = service.GetUserAutoGroup(user.Group)
	} else {
		selected = append(selected, group)
	}
	return service.GetGroupsEnabledModels(selected), true
}

func GetPlaygroundSettings(c *gin.Context) {
	row, err := model.GetPlaygroundPreference(c.GetInt("id"))
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}

func SavePlaygroundSettings(c *gin.Context) {
	var write model.PlaygroundPreferenceWrite
	if !decodePlaygroundRequest(c, &write) {
		return
	}
	if write.Model != "" || write.Group != "" {
		models, ok := playgroundModels(c, write.Group)
		if !ok {
			return
		}
		if write.Model != "" && !slices.Contains(models, write.Model) {
			common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Model is not available"))
			return
		}
	}
	row, err := model.SavePlaygroundPreference(c.GetInt("id"), write)
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}

func GetPlaygroundModelCapabilities(c *gin.Context) {
	models, ok := playgroundModels(c, c.Query("group"))
	if !ok {
		return
	}
	rows := make([]model.PlaygroundModelCapability, 0, len(models))
	for _, name := range models {
		rows = append(rows, model.GetPlaygroundModelCapability(name))
	}
	common.ApiSuccess(c, rows)
}

func EstimatePlaygroundContext(c *gin.Context) {
	var request struct {
		Model    string `json:"model"`
		Group    string `json:"group"`
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if !decodePlaygroundRequest(c, &request) {
		return
	}
	models, ok := playgroundModels(c, request.Group)
	if !ok {
		return
	}
	if !slices.Contains(models, request.Model) {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Model is not available"))
		return
	}
	counts := make([]int, 0, len(request.Messages))
	total := 3
	for _, message := range request.Messages {
		if !slices.Contains([]string{"system", "user", "assistant"}, message.Role) {
			playgroundError(c, model.ErrPlaygroundInvalid)
			return
		}
		var text string
		count := 3
		if common.GetJsonType(message.Content) == "string" && common.Unmarshal(message.Content, &text) == nil {
			count += tokenkit.Count(request.Model, text)
		} else {
			var parts []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}
			if common.Unmarshal(message.Content, &parts) != nil || parts == nil {
				playgroundError(c, model.ErrPlaygroundInvalid)
				return
			}
			for _, part := range parts {
				switch part.Type {
				case "text":
					count += tokenkit.Count(request.Model, part.Text)
				case "image_url":
					count += 8192 // Conservative planning estimate; never fetch a user URL.
				default:
					playgroundError(c, model.ErrPlaygroundInvalid)
					return
				}
			}
		}
		counts = append(counts, count)
		total += count
	}
	common.ApiSuccess(c, gin.H{"input_tokens": total, "message_tokens": counts, "estimated": true})
}
