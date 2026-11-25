package controller

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// A client moves sessions in batches: at most this many per request, and an
// upload body of at most chatSyncUploadLimit bytes.
const (
	chatSyncBatchSessions = 100
	chatSyncUploadLimit   = 16 << 20
)

// TooLarge is reported per session; the other outcomes come from the model.
const chatSyncTooLarge = "too_large"

var chatSyncSessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type chatSyncSessionWithContent struct {
	model.ChatSyncSession
	Content string `json:"content"`
}

// ListChatSyncSessions returns the user's cloud sessions without content, plus
// usage and limits, so a client can tell which sessions to fetch.
func ListChatSyncSessions(c *gin.Context) {
	identity, ok := requireChatSync(c)
	if !ok {
		return
	}
	sessions, err := model.ListChatSyncSessions(identity.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	count, bytes, err := model.ChatSyncUsage(identity.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	limits := chatSyncLimits()
	common.ApiSuccess(c, gin.H{
		"sessions": sessions,
		"usage":    gin.H{"sessions": count, "bytes": bytes},
		"limits": gin.H{
			"max_sessions":      limits.MaxSessions,
			"max_bytes":         limits.MaxBytes,
			"max_session_bytes": operation_setting.ChatSyncMaxSessionBytes,
			"batch_sessions":    chatSyncBatchSessions,
			"batch_bytes":       chatSyncUploadLimit,
		},
	})
}

// FetchChatSyncSessions returns the content of up to chatSyncBatchSessions
// named sessions.
func FetchChatSyncSessions(c *gin.Context) {
	identity, ok := requireChatSync(c)
	if !ok {
		return
	}
	var request struct {
		SessionIDs []string `json:"session_ids"`
	}
	if !decodeChatSyncRequest(c, 64<<10, &request) {
		return
	}
	if len(request.SessionIDs) == 0 || len(request.SessionIDs) > chatSyncBatchSessions {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Fetch between 1 and {{max}} sessions at a time", map[string]any{"max": chatSyncBatchSessions}))
		return
	}
	sessions, err := model.GetChatSyncSessions(identity.UserID, request.SessionIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]chatSyncSessionWithContent, 0, len(sessions))
	for _, session := range sessions {
		items = append(items, chatSyncSessionWithContent{ChatSyncSession: session, Content: string(session.Content)})
	}
	common.ApiSuccess(c, gin.H{"sessions": items})
}

// UploadChatSyncSessions stores a batch of sessions the user chose to upload.
// Each session reports its own outcome; a session another device changed
// since this one last synced it comes back as a conflict unless forced.
func UploadChatSyncSessions(c *gin.Context) {
	identity, ok := requireChatSync(c)
	if !ok {
		return
	}
	var request struct {
		DeviceName string                `json:"device_name"`
		Sessions   []model.ChatSyncWrite `json:"sessions"`
	}
	if !decodeChatSyncRequest(c, chatSyncUploadLimit, &request) {
		return
	}
	if len(request.Sessions) == 0 || len(request.Sessions) > chatSyncBatchSessions {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Upload between 1 and {{max}} sessions at a time", map[string]any{"max": chatSyncBatchSessions}))
		return
	}
	deviceName := truncateChatSyncText(request.DeviceName, 64)
	limits := chatSyncLimits()
	now := common.GetTimestamp()
	results := make([]model.ChatSyncResult, 0, len(request.Sessions))
	for _, write := range request.Sessions {
		if !chatSyncSessionIDPattern.MatchString(write.SessionId) || write.Content == "" || write.MessageCount < 0 {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid chat session"))
			return
		}
		write.Name = truncateChatSyncText(write.Name, 200)
		if len(write.Content) > operation_setting.ChatSyncMaxSessionBytes {
			results = append(results, model.ChatSyncResult{SessionId: write.SessionId, Status: chatSyncTooLarge})
			continue
		}
		result, err := model.SaveChatSyncSession(identity.UserID, write, deviceName, limits, now)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		results = append(results, result)
	}
	common.ApiSuccess(c, gin.H{"results": results})
}

// DeleteChatSyncSession removes one session from the cloud; the copies on the
// user's devices are not touched.
func DeleteChatSyncSession(c *gin.Context) {
	identity, ok := requireChatSync(c)
	if !ok {
		return
	}
	deleted, err := model.DeleteChatSyncSession(identity.UserID, c.Param("session_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !deleted {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Chat session not found"))
		return
	}
	common.ApiSuccess(c, gin.H{"session_id": c.Param("session_id")})
}

// requireChatSync admits a login session (the client's own, or the browser's)
// while chat sync is enabled. Access tokens are refused by the route rules.
func requireChatSync(c *gin.Context) (service.AuthIdentity, bool) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return identity, false
	}
	if !operation_setting.GetChatSyncSetting().Enabled {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Chat sync is disabled on this site."), gin.H{"code": "CHAT_SYNC_DISABLED"})
		return identity, false
	}
	return identity, true
}

func chatSyncLimits() model.ChatSyncLimits {
	settings := operation_setting.GetChatSyncSetting()
	return model.ChatSyncLimits{
		MaxSessions: int64(settings.MaxSessionsPerUser),
		MaxBytes:    int64(settings.MaxMegabytesPerUser) << 20,
	}
}

// decodeChatSyncRequest reads a JSON body bounded by limit and by the site's
// request body limit.
func decodeChatSyncRequest(c *gin.Context, limit int64, target any) bool {
	if constant.MaxRequestBodyMB > 0 {
		limit = min(limit, int64(constant.MaxRequestBodyMB)<<20)
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	body, err := io.ReadAll(c.Request.Body)
	if err == nil {
		err = common.Unmarshal(body, target)
	}
	if err == nil {
		return true
	}
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		common.ApiErrorStatus(c, http.StatusRequestEntityTooLarge, common.NewMessage("The upload is too large. Upload fewer sessions at a time."))
		return false
	}
	common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid chat session"))
	return false
}

func truncateChatSyncText(value string, max int) string {
	value = strings.TrimSpace(value)
	if runes := []rune(value); len(runes) > max {
		return string(runes[:max])
	}
	return value
}
