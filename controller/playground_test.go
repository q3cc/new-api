package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundConversationAuthorization(t *testing.T) {
	previousDB := model.DB
	initModelListColumnNames(t)
	model.DB = previousDB
	admin, legacy := setupAccessTokenAudit(t)
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundConversation{}, &model.PlaygroundImport{}, &model.PlaygroundUploadChunk{}, &model.PlaygroundPreference{}, &model.Ability{}))
	user := model.User{Username: "playground-owner", AffCode: "playground-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default"}
	root := model.User{Username: "playground-root", AffCode: "playground-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&root).Error)
	_, userJWT := createAccessTokenTestSession(t, user.Id, "playground-owner")
	_, adminJWT := createAccessTokenTestSession(t, admin.Id, "playground-admin")
	_, rootJWT := createAccessTokenTestSession(t, root.Id, "playground-root")
	pat, _ := createScopedAccessToken(t, user.Id, 0, "profile:read")
	var requestLogs bytes.Buffer
	previousWriter := gin.DefaultWriter
	gin.DefaultWriter = &requestLogs
	t.Cleanup(func() { gin.DefaultWriter = previousWriter })
	r := gin.New()
	middleware.SetUpLogger(r)
	pg := r.Group("/api/playground/conversations", middleware.UserAuth())
	pg.GET("", ListPlaygroundConversations)
	pg.POST("", CreatePlaygroundConversation)
	pg.POST("/import", ImportPlaygroundConversation)
	pg.GET("/import/chunks/:fingerprint", PlaygroundUploadStatus)
	pg.PUT("/import/chunks/:fingerprint", PlaygroundUploadChunk)
	pg.POST("/import/chunks/:fingerprint/complete", PlaygroundUploadComplete)
	pg.GET("/:id", GetPlaygroundConversation)
	pg.PUT("/:id", SavePlaygroundConversation)
	pg.PATCH("/:id", PatchPlaygroundConversation)
	pg.DELETE("/:id", DeletePlaygroundConversation)
	settings := r.Group("/api/playground", middleware.UserAuth())
	settings.GET("/settings", GetPlaygroundSettings)
	settings.PUT("/settings", SavePlaygroundSettings)
	settings.GET("/model-capabilities", GetPlaygroundModelCapabilities)
	settings.POST("/context/estimate", EstimatePlaygroundContext)
	require.NoError(t, model.DB.Create(&model.Ability{Group: "default", Model: "gpt-4o", ChannelId: 1, Enabled: true}).Error)
	require.NoError(t, model.DB.Create(&model.Ability{Group: "private", Model: "private-model", ChannelId: 2, Enabled: true}).Error)
	oldGroups := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldGroups)) })
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","DSS":"DSS"}`))
	require.NoError(t, model.DB.Create(&model.Ability{Group: "DSS", Model: "gpt-4o-mini", ChannelId: 3, Enabled: true}).Error)
	prefBody := `{"model":"gpt-4o","automatic":true,"revision":0,"operation_id":"compression-pref-create","user_id":999}`
	pref := accessTokenRequest(r, http.MethodPut, "/api/playground/settings", userJWT, "", prefBody)
	require.Equal(t, http.StatusOK, pref.Code, pref.Body.String())
	assert.Contains(t, pref.Body.String(), `"revision":1`)
	assert.Contains(t, accessTokenRequest(r, http.MethodGet, "/api/playground/settings", adminJWT, "", "").Body.String(), `"model":""`)
	assert.Contains(t, accessTokenRequest(r, http.MethodGet, "/api/playground/settings", userJWT, "", "").Body.String(), `"model":"gpt-4o"`)
	assert.Equal(t, http.StatusConflict, accessTokenRequest(r, http.MethodPut, "/api/playground/settings", userJWT, "", strings.Replace(prefBody, "compression-pref-create", "compression-pref-stale", 1)).Code)
	crossGroup := `{"model":"gpt-4o-mini","group":"DSS","automatic":true,"revision":1,"operation_id":"compression-group-save"}`
	for _, invalid := range []string{strings.Replace(crossGroup, "DSS", "private", 1), strings.Replace(crossGroup, "DSS", "default", 1)} {
		assert.Equal(t, http.StatusForbidden, accessTokenRequest(r, http.MethodPut, "/api/playground/settings", userJWT, "", invalid).Code)
	}
	pref = accessTokenRequest(r, http.MethodPut, "/api/playground/settings", userJWT, "", crossGroup)
	require.Equal(t, http.StatusOK, pref.Code, pref.Body.String())
	assert.Contains(t, pref.Body.String(), `"group":"DSS"`)
	assert.Contains(t, accessTokenRequest(r, http.MethodGet, "/api/playground/settings", userJWT, "", "").Body.String(), `"group":"DSS"`)
	capabilities := accessTokenRequest(r, http.MethodGet, "/api/playground/model-capabilities?group=default", userJWT, "", "")
	assert.Contains(t, capabilities.Body.String(), `"context_window":128000`)
	assert.NotContains(t, capabilities.Body.String(), "private-model")
	assert.Equal(t, http.StatusForbidden, accessTokenRequest(r, http.MethodGet, "/api/playground/model-capabilities?group=private", userJWT, "", "").Code)
	estimateBody := `{"model":"gpt-4o","group":"default","messages":[{"role":"user","content":"hello"}]}`
	estimate := accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", estimateBody)
	require.Equal(t, http.StatusOK, estimate.Code, estimate.Body.String())
	assert.Contains(t, estimate.Body.String(), `"input_tokens":7`)
	imageRead := false
	imageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { imageRead = true }))
	t.Cleanup(imageServer.Close)
	imageBody := fmt.Sprintf(`{"model":"gpt-4o","group":"default","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":%q}}]}]}`, imageServer.URL)
	imageEstimate := accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", imageBody)
	require.Equal(t, http.StatusOK, imageEstimate.Code)
	assert.Contains(t, imageEstimate.Body.String(), `"input_tokens":8198`)
	assert.False(t, imageRead, "estimation must not fetch remote images")
	assert.Equal(t, http.StatusForbidden, accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", strings.Replace(estimateBody, "gpt-4o", "private-model", 1)).Code)
	assert.Equal(t, http.StatusRequestEntityTooLarge, accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", strings.Replace(estimateBody, "hello", strings.Repeat("x", model.PlaygroundDocumentLimit), 1)).Code)
	assert.Equal(t, http.StatusBadRequest, accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", strings.Replace(estimateBody, `"hello"`, "null", 1)).Code)
	assert.Equal(t, http.StatusBadRequest, accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", strings.Replace(estimateBody, `"user"`, `"tool"`, 1)).Code)
	assert.Equal(t, http.StatusBadRequest, accessTokenRequest(r, http.MethodPost, "/api/playground/context/estimate", userJWT, "", strings.Replace(estimateBody, `"hello"`, `[{"type":"audio","text":"x"}]`, 1)).Code)
	body := `{"operation_id":"playground-auth-create","title":"private conversation","document":{"messages":[{"key":"u","from":"user","versions":[{"id":"v","content":"private-body-sentinel"}]}],"config":{},"parameterEnabled":{},"draft":""},"user_id":999}`
	created := accessTokenRequest(r, http.MethodPost, "/api/playground/conversations", userJWT, "", body)
	require.Equal(t, http.StatusOK, created.Code)
	var result struct {
		Data model.PlaygroundConversationDetail `json:"data"`
	}
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &result))
	require.Positive(t, result.Data.Id)
	var row model.PlaygroundConversation
	require.NoError(t, model.DB.First(&row, result.Data.Id).Error)
	assert.Equal(t, user.Id, row.UserId)
	assert.NotContains(t, created.Body.String(), "last_operation")
	assert.NotContains(t, created.Body.String(), "creation_hash")
	path := fmt.Sprintf("/api/playground/conversations/%d", result.Data.Id)
	assert.Contains(t, created.Body.String(), "private-body-sentinel", "a client that does not ask for metadata still gets the document")
	resaveBody := fmt.Sprintf(`{"operation_id":"playground-auth-resave","revision":%d,"title":"private conversation","document":{"messages":[{"key":"u","from":"user","versions":[{"id":"v","content":"private-body-sentinel"}]}],"config":{},"parameterEnabled":{},"draft":"typed"}}`, result.Data.Revision)
	resaved := accessTokenRequest(r, http.MethodPut, path+"?return=meta", userJWT, "", resaveBody)
	require.Equal(t, http.StatusOK, resaved.Code)
	assert.NotContains(t, resaved.Body.String(), "private-body-sentinel", "return=meta sends no second copy of the document")
	assert.NotContains(t, resaved.Body.String(), `"document"`)
	assert.Contains(t, resaved.Body.String(), fmt.Sprintf(`"revision":%d`, result.Data.Revision+1))
	// A metadata patch leaves the messages alone and never echoes them back.
	patchBody := fmt.Sprintf(`{"operation_id":"playground-auth-patch","revision":%d,"patch":{"draft":"patched"}}`, result.Data.Revision+1)
	patched := accessTokenRequest(r, http.MethodPatch, path+"?return=meta", userJWT, "", patchBody)
	require.Equal(t, http.StatusOK, patched.Code, patched.Body.String())
	assert.NotContains(t, patched.Body.String(), "private-body-sentinel")
	assert.Contains(t, patched.Body.String(), fmt.Sprintf(`"revision":%d`, result.Data.Revision+2))
	fetched := accessTokenRequest(r, http.MethodGet, path, userJWT, "", "")
	assert.Contains(t, fetched.Body.String(), "private-body-sentinel")
	assert.Contains(t, fetched.Body.String(), `"draft":"patched"`)
	assert.Equal(t, http.StatusConflict, accessTokenRequest(r, http.MethodPatch, path, userJWT, "", strings.Replace(patchBody, "playground-auth-patch", "playground-auth-patch-stale", 1)).Code)
	assert.Equal(t, http.StatusBadRequest, accessTokenRequest(r, http.MethodPatch, path, userJWT, "", fmt.Sprintf(`{"operation_id":"playground-auth-patch-messages","revision":%d,"patch":{"messages":[]}}`, result.Data.Revision+2)).Code)
	assert.Equal(t, http.StatusOK, accessTokenRequest(r, http.MethodGet, "/api/playground/conversations?page_size=-1", userJWT, "", "").Code)
	assert.Equal(t, http.StatusBadRequest, accessTokenRequest(r, http.MethodGet, "/api/playground/conversations?keyword="+strings.Repeat("k", 201), userJWT, "", "").Code)
	legacyMessages := `[{"key":"legacy","from":"user","versions":[{"id":"v","content":"private-upload-sentinel"}]}]`
	sourceBody, err := common.Marshal(model.PlaygroundLegacySource{Messages: &legacyMessages})
	require.NoError(t, err)
	digest := sha256.Sum256(sourceBody)
	fingerprint := hex.EncodeToString(digest[:])
	uploadPath := "/api/playground/conversations/import/chunks/" + fingerprint
	uploadBody, err := common.Marshal(map[string]any{"size": len(sourceBody), "index": 0, "hash": fingerprint, "content": base64.StdEncoding.EncodeToString(sourceBody)})
	require.NoError(t, err)
	upload := accessTokenRequest(r, http.MethodPut, uploadPath, userJWT, "", string(uploadBody))
	require.Equal(t, http.StatusOK, upload.Code)
	for _, credential := range []string{adminJWT, rootJWT} {
		status := accessTokenRequest(r, http.MethodGet, fmt.Sprintf("%s?size=%d", uploadPath, len(sourceBody)), credential, "", "")
		assert.Contains(t, status.Body.String(), `"chunks":{}`)
		complete := accessTokenRequest(r, http.MethodPost, uploadPath+"/complete", credential, "", fmt.Sprintf(`{"size":%d}`, len(sourceBody)))
		assert.Equal(t, http.StatusBadRequest, complete.Code)
	}
	for _, credential := range []string{adminJWT, rootJWT} {
		for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
			response := accessTokenRequest(r, method, path, credential, "", body)
			assert.Equal(t, http.StatusNotFound, response.Code)
			assert.NotContains(t, response.Body.String(), "private-body-sentinel")
		}
		list := accessTokenRequest(r, http.MethodGet, fmt.Sprintf("/api/playground/conversations?user_id=%d", user.Id), credential, "", "")
		assert.NotContains(t, list.Body.String(), "private conversation")
	}
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/playground/settings"}, {http.MethodPut, "/api/playground/settings"}, {http.MethodGet, "/api/playground/model-capabilities"}, {http.MethodPost, "/api/playground/context/estimate"},
		{http.MethodGet, uploadPath}, {http.MethodPut, uploadPath}, {http.MethodPost, uploadPath + "/complete"},
		{http.MethodGet, "/api/playground/conversations"}, {http.MethodPost, "/api/playground/conversations"},
		{http.MethodPost, "/api/playground/conversations/import"}, {http.MethodGet, path}, {http.MethodPut, path}, {http.MethodPatch, path}, {http.MethodDelete, path},
	} {
		assert.Equal(t, http.StatusUnauthorized, accessTokenRequest(r, route.method, route.path, "", "", body).Code)
		for _, credential := range []string{pat, legacy} {
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(r, route.method, route.path, credential, "", body).Code)
		}
	}
	conflict := strings.Replace(body, "playground-auth-create", "playground-auth-update", 1)
	response := accessTokenRequest(r, http.MethodPut, path, userJWT, "", conflict)
	assert.Equal(t, http.StatusConflict, response.Code)
	oversized := strings.Replace(body, "private-body-sentinel", strings.Repeat("x", model.PlaygroundDocumentLimit), 1)
	assert.Equal(t, http.StatusRequestEntityTooLarge, accessTokenRequest(r, http.MethodPost, "/api/playground/conversations", userJWT, "", oversized).Code)
	assert.Equal(t, http.StatusBadRequest, accessTokenRequest(r, http.MethodPost, "/api/playground/conversations", userJWT, "", "{").Code)
	assert.Equal(t, http.StatusOK, accessTokenRequest(r, http.MethodGet, path, userJWT, "", "").Code)
	assert.Equal(t, http.StatusOK, accessTokenRequest(r, http.MethodGet, "/api/playground/conversations?keyword=private-query-sentinel", userJWT, "", "").Code)
	assert.NotContains(t, requestLogs.String(), "private-query-sentinel")
	assert.NotContains(t, requestLogs.String(), "private-body-sentinel")
	assert.NotContains(t, requestLogs.String(), userJWT)
}
