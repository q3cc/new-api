package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func chatSyncHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// upload sends one batch and returns each session's status by id.
func (env *clientDeviceTestEnv) upload(t *testing.T, bearer, device string, sessions ...map[string]any) map[string]map[string]any {
	t.Helper()
	status, response := env.do(t, http.MethodPut, "/api/user/chat-sessions", bearer, map[string]any{"device_name": device, "sessions": sessions})
	require.Equal(t, http.StatusOK, status, response)
	results := map[string]map[string]any{}
	for _, item := range response["data"].(map[string]any)["results"].([]any) {
		result := item.(map[string]any)
		results[result["session_id"].(string)] = result
	}
	return results
}

func chatSession(id, content, baseHash string) map[string]any {
	return map[string]any{"session_id": id, "name": "Chat " + id, "content": content, "message_count": 2, "client_updated_at": 1700000000000, "base_hash": baseHash}
}

func TestChatSyncPullAllAndManualUpload(t *testing.T) {
	runClientDeviceDialects(t, func(t *testing.T, env *clientDeviceTestEnv) {
		// A second signed-in device of the same user, e.g. the phone.
		_, phone := createAccessTokenTestSession(t, env.userID, "phone-session")

		results := env.upload(t, env.userJWT, "Laptop", chatSession("s-1", `{"v":1}`, ""), chatSession("s-2", `{"v":"two"}`, ""))
		assert.Equal(t, model.ChatSyncSaved, results["s-1"]["status"])
		assert.Equal(t, chatSyncHash(`{"v":1}`), results["s-1"]["content_hash"])

		// The list carries what a client needs to decide what to fetch, never content.
		status, response := env.do(t, http.MethodGet, "/api/user/chat-sessions", phone, nil)
		require.Equal(t, http.StatusOK, status, response)
		data := response["data"].(map[string]any)
		sessions := data["sessions"].([]any)
		require.Len(t, sessions, 2)
		for _, item := range sessions {
			assert.NotContains(t, item.(map[string]any), "content")
			assert.Equal(t, "Laptop", item.(map[string]any)["device_name"])
		}
		assert.EqualValues(t, 2, data["usage"].(map[string]any)["sessions"])

		// Pull: the other device fetches content by id.
		status, response = env.do(t, http.MethodPost, "/api/user/chat-sessions/fetch", phone, map[string]any{"session_ids": []string{"s-1", "s-2", "missing"}})
		require.Equal(t, http.StatusOK, status, response)
		fetched := response["data"].(map[string]any)["sessions"].([]any)
		require.Len(t, fetched, 2)
		contents := map[string]string{}
		for _, item := range fetched {
			contents[item.(map[string]any)["session_id"].(string)] = item.(map[string]any)["content"].(string)
		}
		assert.Equal(t, `{"v":"two"}`, contents["s-2"])

		// Uploading an unchanged session writes nothing.
		results = env.upload(t, env.userJWT, "Laptop", chatSession("s-1", `{"v":1}`, chatSyncHash(`{"v":1}`)))
		assert.Equal(t, model.ChatSyncUnchanged, results["s-1"]["status"])

		// The phone edits s-1 on top of the version it pulled.
		results = env.upload(t, phone, "Phone", chatSession("s-1", `{"v":"phone"}`, chatSyncHash(`{"v":1}`)))
		assert.Equal(t, model.ChatSyncSaved, results["s-1"]["status"])

		// The laptop's stale upload is refused with the cloud's version, until forced.
		results = env.upload(t, env.userJWT, "Laptop", chatSession("s-1", `{"v":"laptop"}`, chatSyncHash(`{"v":1}`)))
		assert.Equal(t, model.ChatSyncConflict, results["s-1"]["status"])
		assert.Equal(t, chatSyncHash(`{"v":"phone"}`), results["s-1"]["content_hash"])
		forced := chatSession("s-1", `{"v":"laptop"}`, chatSyncHash(`{"v":1}`))
		forced["force"] = true
		results = env.upload(t, env.userJWT, "Laptop", forced)
		assert.Equal(t, model.ChatSyncSaved, results["s-1"]["status"])

		// Deleting from the cloud is per session.
		status, _ = env.do(t, http.MethodDelete, "/api/user/chat-sessions/s-2", env.userJWT, nil)
		assert.Equal(t, http.StatusOK, status)
		status, _ = env.do(t, http.MethodDelete, "/api/user/chat-sessions/s-2", env.userJWT, nil)
		assert.Equal(t, http.StatusNotFound, status)
	})
}

func TestChatSyncLimitsAndAccess(t *testing.T) {
	runClientDeviceDialects(t, func(t *testing.T, env *clientDeviceTestEnv) {
		t.Run("the session count limit holds per upload", func(t *testing.T) {
			operation_setting.GetChatSyncSetting().MaxSessionsPerUser = 2
			results := env.upload(t, env.userJWT, "Laptop", chatSession("a", "{}", ""), chatSession("b", "{}", ""), chatSession("c", "{}", ""))
			assert.Equal(t, model.ChatSyncSaved, results["b"]["status"])
			assert.Equal(t, model.ChatSyncLimited, results["c"]["status"])
			// Replacing a stored session stays allowed at the limit.
			results = env.upload(t, env.userJWT, "Laptop", chatSession("a", `{"edited":true}`, chatSyncHash("{}")))
			assert.Equal(t, model.ChatSyncSaved, results["a"]["status"])
			operation_setting.GetChatSyncSetting().MaxSessionsPerUser = 2000
		})

		t.Run("the storage limit counts content bytes", func(t *testing.T) {
			operation_setting.GetChatSyncSetting().MaxMegabytesPerUser = 1
			results := env.upload(t, env.userJWT, "Laptop", chatSession("big", strings.Repeat("x", 1<<20), ""))
			assert.Equal(t, model.ChatSyncLimited, results["big"]["status"])
			operation_setting.GetChatSyncSetting().MaxMegabytesPerUser = 200
		})

		t.Run("a session over the size limit is reported, not stored", func(t *testing.T) {
			results := env.upload(t, env.userJWT, "Laptop", chatSession("huge", strings.Repeat("x", operation_setting.ChatSyncMaxSessionBytes+1), ""))
			assert.Equal(t, "too_large", results["huge"]["status"])
		})

		t.Run("one user cannot read another user's sessions", func(t *testing.T) {
			other := model.User{Username: "chat-sync-other", Password: "x", AffCode: "chat-sync-other", Status: common.UserStatusEnabled, AuthVersion: 1}
			require.NoError(t, model.DB.Create(&other).Error)
			_, otherJWT := createAccessTokenTestSession(t, other.Id, "other-session")
			_, response := env.do(t, http.MethodPost, "/api/user/chat-sessions/fetch", otherJWT, map[string]any{"session_ids": []string{"a", "b"}})
			assert.Empty(t, response["data"].(map[string]any)["sessions"])
			status, _ := env.do(t, http.MethodDelete, "/api/user/chat-sessions/a", otherJWT, nil)
			assert.Equal(t, http.StatusNotFound, status)
		})

		t.Run("access tokens are refused", func(t *testing.T) {
			pat, _ := createScopedAccessToken(t, env.userID, 0, "profile:read")
			status, _ := env.do(t, http.MethodGet, "/api/user/chat-sessions", pat, nil)
			assert.Equal(t, http.StatusForbidden, status)
		})

		t.Run("chat sync can be switched off", func(t *testing.T) {
			operation_setting.GetChatSyncSetting().Enabled = false
			status, response := env.do(t, http.MethodGet, "/api/user/chat-sessions", env.userJWT, nil)
			assert.Equal(t, http.StatusForbidden, status)
			assert.Equal(t, "CHAT_SYNC_DISABLED", response["code"])
		})
	})
}
