package controller

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const clientDeviceTestBuildKey = "build-key-for-tests"

// clientDeviceKey is a device key pair as the client makes it with WebCrypto:
// the public key travels as SPKI DER and signatures as raw r||s, both base64url.
type clientDeviceKey struct {
	private *ecdsa.PrivateKey
	public  string
}

func newClientDeviceKey(t *testing.T) clientDeviceKey {
	t.Helper()
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	der, err := x509.MarshalPKIXPublicKey(&private.PublicKey)
	require.NoError(t, err)
	return clientDeviceKey{private: private, public: base64.RawURLEncoding.EncodeToString(der)}
}

func (k clientDeviceKey) sign(t *testing.T, message string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(message))
	r, s, err := ecdsa.Sign(rand.Reader, k.private, digest[:])
	require.NoError(t, err)
	raw := make([]byte, 64)
	r.FillBytes(raw[:32])
	s.FillBytes(raw[32:])
	return base64.RawURLEncoding.EncodeToString(raw)
}

var clientDeviceNonceSeq int

func clientDeviceProof(t *testing.T, key clientDeviceKey, purpose string, parts ...string) map[string]any {
	t.Helper()
	clientDeviceNonceSeq++
	timestamp := time.Now().Unix()
	nonce := fmt.Sprintf("nonce-%016d", clientDeviceNonceSeq)
	message := strings.Join(append([]string{purpose, strconv.FormatInt(timestamp, 10), nonce}, parts...), "\n")
	return map[string]any{"timestamp": timestamp, "nonce": nonce, "signature": key.sign(t, message)}
}

type clientDeviceTestEnv struct {
	router  *gin.Engine
	userJWT string
	user    service.AuthIdentity
	userID  int
}

// runClientDeviceDialects runs on SQLite, and on MySQL and PostgreSQL when
// their DSNs are configured, migrating twice to prove the migration is stable.
func runClientDeviceDialects(t *testing.T, test func(t *testing.T, env *clientDeviceTestEnv)) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("database DSN not configured")
			}
			test(t, newClientDeviceTestEnv(t, dialect.kind, dsn))
		})
	}
}

func newClientDeviceTestEnv(t *testing.T, kind, dsn string) *clientDeviceTestEnv {
	db, _ := newAuditTestDatabase(t, kind, dsn)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousMaster := common.RedisEnabled, common.IsMasterNode
	setting := *operation_setting.GetClientDeviceSetting()
	chatSync := *operation_setting.GetChatSyncSetting()
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(kind), common.DatabaseType(kind))
	common.RedisEnabled, common.IsMasterNode = false, true
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"client_device_secret_setting.build_secret": "old-key\n" + clientDeviceTestBuildKey}))
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled, common.IsMasterNode = previousRedis, previousMaster
		*operation_setting.GetClientDeviceSetting() = setting
		*operation_setting.GetChatSyncSetting() = chatSync
		_ = config.GlobalConfig.LoadFromDB(map[string]string{"client_device_secret_setting.build_secret": ""})
	})
	tables := []any{&model.User{}, &model.UserSession{}, &model.Log{}, &model.AuditLog{}, &model.CasbinRule{}, &model.AuthzRole{},
		&model.UserAccessToken{}, &model.Option{}, &model.AuthFlow{}, &model.TwoFA{}, &model.TwoFABackupCode{},
		&model.PasskeyCredential{}, &model.UserOAuthBinding{}, &model.ClientDeviceAuthorization{}, &model.ClientDevice{}, &model.ChatSyncSession{}}
	require.NoError(t, db.AutoMigrate(tables...))
	require.NoError(t, db.AutoMigrate(&model.ClientDeviceAuthorization{}, &model.ClientDevice{}, &model.ChatSyncSession{}), "a second migration must be a no-op")
	require.NoError(t, authz.Init(db))

	user := model.User{Username: "device-owner", Password: "placeholder", AffCode: "device-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default"}
	require.NoError(t, db.Create(&user).Error)
	identity, jwt := createAccessTokenTestSession(t, user.Id, "browser-session")

	router := gin.New()
	userRoute := router.Group("/api/user")
	userRoute.POST("/device-auth/start", StartClientDeviceAuthorization)
	userRoute.POST("/device-auth/token", ExchangeClientDeviceCode)
	userRoute.POST("/device-auth/refresh", RefreshClientDeviceSession)
	selfRoute := userRoute.Group("/", middleware.UserAuth())
	selfRoute.GET("/device-auth/requests/:user_code", GetClientDeviceAuthorization)
	selfRoute.POST("/device-auth/requests/:user_code/approve", ApproveClientDeviceAuthorization)
	selfRoute.POST("/device-auth/requests/:user_code/deny", DenyClientDeviceAuthorization)
	selfRoute.GET("/client-devices", ListClientDevices)
	selfRoute.DELETE("/client-devices/:id", RevokeClientDevice)
	selfRoute.GET("/chat-sessions", ListChatSyncSessions)
	selfRoute.POST("/chat-sessions/fetch", FetchChatSyncSessions)
	selfRoute.PUT("/chat-sessions", UploadChatSyncSessions)
	selfRoute.DELETE("/chat-sessions/:session_id", DeleteChatSyncSession)
	return &clientDeviceTestEnv{router: router, userJWT: jwt, user: identity, userID: user.Id}
}

func (env *clientDeviceTestEnv) do(t *testing.T, method, path, bearer string, body any, headers ...string) (int, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := common.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = "192.0.2.10:5000"
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	response := httptest.NewRecorder()
	env.router.ServeHTTP(response, request)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &decoded), response.Body.String())
	return response.Code, decoded
}

// start begins an authorization signed by key, with the build key when signed.
func (env *clientDeviceTestEnv) start(t *testing.T, key clientDeviceKey, buildKey string) (deviceCode, userCode string) {
	t.Helper()
	proof := clientDeviceProof(t, key, "client-device-authorize", "ios", "1.2.0", "Lyra Box on iPhone", key.public)
	body := map[string]any{"client_name": "Lyra Box on iPhone", "platform": "ios", "app_version": "1.2.0", "public_key": key.public}
	for k, v := range proof {
		body[k] = v
	}
	if buildKey != "" {
		message := strings.Join([]string{"client-device-authorize", strconv.FormatInt(proof["timestamp"].(int64), 10), proof["nonce"].(string), "ios", "1.2.0", "Lyra Box on iPhone", key.public}, "\n")
		mac := hmac.New(sha256.New, []byte(buildKey))
		mac.Write([]byte(message))
		body["build_signature"] = base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	}
	status, response := env.do(t, http.MethodPost, "/api/user/device-auth/start", "", body)
	require.Equal(t, http.StatusOK, status, response)
	data := response["data"].(map[string]any)
	assert.Equal(t, "http://localhost:3000/device?code="+data["user_code"].(string), data["verification_uri_complete"])
	return data["device_code"].(string), data["user_code"].(string)
}

func (env *clientDeviceTestEnv) poll(t *testing.T, key clientDeviceKey, deviceCode string) (int, map[string]any) {
	t.Helper()
	body := clientDeviceProof(t, key, "client-device-token", deviceCode)
	body["device_code"] = deviceCode
	return env.do(t, http.MethodPost, "/api/user/device-auth/token", "", body)
}

func (env *clientDeviceTestEnv) approve(t *testing.T, userCode, proofCode string) (int, map[string]any) {
	t.Helper()
	context, err := common.Marshal(service.ClientDeviceAuthorizeContext{UserCode: proofCode})
	require.NoError(t, err)
	proof := issueSecurityEnrollmentProof(t, env.user, service.VerificationOperation{Scope: service.VerificationScopeClientDeviceAuthorize, Context: context}, "password")
	return env.do(t, http.MethodPost, "/api/user/device-auth/requests/"+userCode+"/approve", env.userJWT, nil, "X-Security-Proof", proof)
}

func (env *clientDeviceTestEnv) refresh(t *testing.T, key clientDeviceKey, deviceID, refreshToken string) (int, map[string]any) {
	t.Helper()
	digest := sha256.Sum256([]byte(refreshToken))
	body := clientDeviceProof(t, key, "client-device-refresh", deviceID, hex.EncodeToString(digest[:]))
	body["device_id"] = deviceID
	body["refresh_token"] = refreshToken
	return env.do(t, http.MethodPost, "/api/user/device-auth/refresh", "", body)
}

func TestClientDeviceBrowserAuthorization(t *testing.T) {
	runClientDeviceDialects(t, func(t *testing.T, env *clientDeviceTestEnv) {
		key := newClientDeviceKey(t)
		deviceCode, userCode := env.start(t, key, clientDeviceTestBuildKey)

		// Before approval the device is told to wait, and to slow down when it
		// polls again within the interval.
		status, response := env.poll(t, key, deviceCode)
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, "authorization_pending", response["code"])
		_, response = env.poll(t, key, deviceCode)
		assert.Equal(t, "slow_down", response["code"])

		// The approving user sees what is asking for access.
		status, response = env.do(t, http.MethodGet, "/api/user/device-auth/requests/"+strings.ToLower(userCode), env.userJWT, nil)
		require.Equal(t, http.StatusOK, status, response)
		view := response["data"].(map[string]any)
		assert.Equal(t, "Lyra Box on iPhone", view["client_name"])
		assert.Equal(t, true, view["verified"])

		// Approval needs a proof bound to this very code.
		status, response = env.do(t, http.MethodPost, "/api/user/device-auth/requests/"+userCode+"/approve", env.userJWT, nil)
		assert.Equal(t, http.StatusForbidden, status)
		assert.Equal(t, "SECURITY_PROOF_REQUIRED", response["code"])
		status, response = env.approve(t, userCode, "BBBBBBBB")
		assert.Equal(t, http.StatusForbidden, status)
		assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", response["code"])
		status, response = env.approve(t, userCode, userCode)
		require.Equal(t, http.StatusOK, status, response)
		status, _ = env.approve(t, userCode, userCode)
		assert.Equal(t, http.StatusNotFound, status, "a decided request cannot be decided again")

		// The approved device signs in once, as a verified Lyra Box session.
		status, response = env.poll(t, key, deviceCode)
		require.Equal(t, http.StatusOK, status, response)
		login := response["data"].(map[string]any)
		device := login["device"].(map[string]any)
		assert.Equal(t, true, device["verified"])
		assert.NotEmpty(t, login["access_token"])
		refreshToken := login["refresh_token"].(string)
		session := login["session"].(map[string]any)
		assert.Equal(t, "client_device", session["login_method"])
		assert.Equal(t, "LyraBox/1.2.0 (ios; Lyra Box on iPhone)", session["user_agent"])
		_, response = env.poll(t, key, deviceCode)
		assert.Equal(t, "expired_token", response["code"], "a device code is exchanged at most once")

		// A replayed request is refused even with a valid signature.
		replay := clientDeviceProof(t, key, "client-device-token", deviceCode)
		replay["device_code"] = deviceCode
		env.do(t, http.MethodPost, "/api/user/device-auth/token", "", replay)
		status, response = env.do(t, http.MethodPost, "/api/user/device-auth/token", "", replay)
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, "CLIENT_DEVICE_SIGNATURE_INVALID", response["code"])

		// Refresh needs the device key: the refresh token alone is not enough.
		deviceID := device["device_id"].(string)
		status, _ = env.refresh(t, newClientDeviceKey(t), deviceID, refreshToken)
		assert.Equal(t, http.StatusUnauthorized, status)
		status, response = env.refresh(t, key, deviceID, refreshToken)
		require.Equal(t, http.StatusOK, status, response)
		rotated := response["data"].(map[string]any)["refresh_token"].(string)
		assert.NotEqual(t, refreshToken, rotated)

		// The browser session lists the device; revoking it signs it out.
		status, response = env.do(t, http.MethodGet, "/api/user/client-devices", env.userJWT, nil)
		require.Equal(t, http.StatusOK, status, response)
		devices := response["data"].([]any)
		require.Len(t, devices, 1)
		id := int(devices[0].(map[string]any)["id"].(float64))
		status, response = env.do(t, http.MethodDelete, "/api/user/client-devices/"+strconv.Itoa(id), env.userJWT, nil)
		require.Equal(t, http.StatusOK, status, response)
		status, _ = env.refresh(t, key, deviceID, rotated)
		assert.Equal(t, http.StatusUnauthorized, status, "a revoked device cannot refresh")
	})
}

func TestClientDeviceAuthorizationRefusals(t *testing.T) {
	runClientDeviceDialects(t, func(t *testing.T, env *clientDeviceTestEnv) {
		key := newClientDeviceKey(t)

		t.Run("unsigned builds sign in unverified", func(t *testing.T) {
			_, userCode := env.start(t, key, "wrong-key")
			_, response := env.do(t, http.MethodGet, "/api/user/device-auth/requests/"+userCode, env.userJWT, nil)
			assert.Equal(t, false, response["data"].(map[string]any)["verified"])
		})

		t.Run("a request signed by another key is refused", func(t *testing.T) {
			other := newClientDeviceKey(t)
			body := clientDeviceProof(t, other, "client-device-authorize", "ios", "1.2.0", "Lyra Box", key.public)
			body["client_name"], body["platform"], body["app_version"], body["public_key"] = "Lyra Box", "ios", "1.2.0", key.public
			status, response := env.do(t, http.MethodPost, "/api/user/device-auth/start", "", body)
			assert.Equal(t, http.StatusUnauthorized, status)
			assert.Equal(t, "CLIENT_DEVICE_SIGNATURE_INVALID", response["code"])
		})

		t.Run("an unknown platform is refused", func(t *testing.T) {
			body := clientDeviceProof(t, key, "client-device-authorize", "toaster", "1.2.0", "Lyra Box", key.public)
			body["client_name"], body["platform"], body["app_version"], body["public_key"] = "Lyra Box", "toaster", "1.2.0", key.public
			status, _ := env.do(t, http.MethodPost, "/api/user/device-auth/start", "", body)
			assert.Equal(t, http.StatusBadRequest, status)
		})

		t.Run("a denied request tells the device so", func(t *testing.T) {
			deviceCode, userCode := env.start(t, key, "")
			status, response := env.do(t, http.MethodPost, "/api/user/device-auth/requests/"+userCode+"/deny", env.userJWT, nil)
			require.Equal(t, http.StatusOK, status, response)
			_, response = env.poll(t, key, deviceCode)
			assert.Equal(t, "access_denied", response["code"])
		})

		t.Run("an expired request cannot be approved or exchanged", func(t *testing.T) {
			deviceCode, userCode := env.start(t, key, "")
			require.NoError(t, model.DB.Model(&model.ClientDeviceAuthorization{}).
				Where("user_code = ?", service.NormalizeClientDeviceUserCode(userCode)).Update("expires_at", time.Now().Unix()-1).Error)
			status, _ := env.approve(t, userCode, userCode)
			assert.Equal(t, http.StatusNotFound, status)
			_, response := env.poll(t, key, deviceCode)
			assert.Equal(t, "expired_token", response["code"])
		})

		t.Run("an access token cannot approve a device", func(t *testing.T) {
			_, userCode := env.start(t, key, "")
			pat, _ := createScopedAccessToken(t, env.userID, 0, "profile:write")
			status, _ := env.do(t, http.MethodPost, "/api/user/device-auth/requests/"+userCode+"/approve", pat, nil)
			assert.Equal(t, http.StatusForbidden, status)
		})

		t.Run("approval stops at the device limit", func(t *testing.T) {
			operation_setting.GetClientDeviceSetting().MaxDevicesPerUser = 1
			require.NoError(t, model.CreateClientDevice(&model.ClientDevice{UserId: env.userID, DeviceId: "existing-device", PublicKey: key.public, Status: model.ClientDeviceStatusActive, CreatedAt: time.Now().Unix()}))
			_, userCode := env.start(t, key, "")
			status, response := env.approve(t, userCode, userCode)
			assert.Equal(t, http.StatusConflict, status)
			assert.Equal(t, "CLIENT_DEVICE_LIMIT", response["code"])
		})

		t.Run("browser authorization can be switched off", func(t *testing.T) {
			operation_setting.GetClientDeviceSetting().Enabled = false
			body := clientDeviceProof(t, key, "client-device-authorize", "ios", "1.2.0", "Lyra Box", key.public)
			body["client_name"], body["platform"], body["app_version"], body["public_key"] = "Lyra Box", "ios", "1.2.0", key.public
			status, response := env.do(t, http.MethodPost, "/api/user/device-auth/start", "", body)
			assert.Equal(t, http.StatusForbidden, status)
			assert.Equal(t, "CLIENT_DEVICE_DISABLED", response["code"])
		})
	})
}

func TestVerifiedClientRateLimit(t *testing.T) {
	runClientDeviceDialects(t, func(t *testing.T, env *clientDeviceTestEnv) {
		previous := struct {
			enabled        bool
			count, success int
			minutes        int
			clientSettings operation_setting.ClientDeviceSetting
		}{setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount, setting.ModelRequestRateLimitDurationMinutes, *operation_setting.GetClientDeviceSetting()}
		t.Cleanup(func() {
			setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitCount = previous.enabled, previous.count
			setting.ModelRequestRateLimitSuccessCount, setting.ModelRequestRateLimitDurationMinutes = previous.success, previous.minutes
			*operation_setting.GetClientDeviceSetting() = previous.clientSettings
		})
		setting.ModelRequestRateLimitEnabled = true
		setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = 2, 0
		setting.ModelRequestRateLimitDurationMinutes = 1
		operation_setting.GetClientDeviceSetting().VerifiedRPMEnabled = true
		operation_setting.GetClientDeviceSetting().VerifiedRPMMultiplier = 2

		// Each case gets its own user, with an ID unique across dialects, because
		// the in-memory limiter is shared by the whole test process.
		newDevice := func(t *testing.T, verified bool) (int, clientDeviceKey, string) {
			clientDeviceNonceSeq++
			user := model.User{Id: 900_000 + clientDeviceNonceSeq, Username: "rpm-" + strconv.FormatInt(time.Now().UnixNano(), 36), Password: "x", Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default"}
			user.AffCode = user.Username
			require.NoError(t, model.DB.Create(&user).Error)
			sid := "rpm-session-" + user.Username
			createAccessTokenTestSession(t, user.Id, sid)
			key := newClientDeviceKey(t)
			deviceID := "device-" + user.Username
			require.NoError(t, model.CreateClientDevice(&model.ClientDevice{UserId: user.Id, DeviceId: deviceID, PublicKey: key.public, Verified: verified, SessionSID: sid, Status: model.ClientDeviceStatusActive, CreatedAt: time.Now().Unix()}))
			return user.Id, key, deviceID
		}
		send := func(t *testing.T, userID int, key *clientDeviceKey, deviceID, signedBody string) int {
			body := `{"model":"gpt-4o","messages":[]}`
			router := gin.New()
			router.POST("/v1/chat/completions", func(c *gin.Context) { c.Set("id", userID) }, middleware.ModelRequestRateLimit(), func(c *gin.Context) {
				assert.Empty(t, c.GetHeader(service.ClientDeviceHeaderSignature), "proof headers must not reach the relay")
				c.Status(http.StatusOK)
			})
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
			if key != nil {
				digest := sha256.Sum256([]byte(signedBody))
				proof := clientDeviceProof(t, *key, "client-device-request", http.MethodPost, "/v1/chat/completions", hex.EncodeToString(digest[:]))
				request.Header.Set(service.ClientDeviceHeaderID, deviceID)
				request.Header.Set(service.ClientDeviceHeaderTimestamp, strconv.FormatInt(proof["timestamp"].(int64), 10))
				request.Header.Set(service.ClientDeviceHeaderNonce, proof["nonce"].(string))
				request.Header.Set(service.ClientDeviceHeaderSignature, proof["signature"].(string))
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			return response.Code
		}
		allowed := func(t *testing.T, userID int, key *clientDeviceKey, deviceID string, tamper bool) int {
			count := 0
			for range 6 {
				signed := `{"model":"gpt-4o","messages":[]}`
				if tamper {
					signed = `{"model":"o3","messages":[]}`
				}
				if send(t, userID, key, deviceID, signed) == http.StatusOK {
					count++
				}
			}
			return count
		}

		userID, _, _ := newDevice(t, true)
		assert.Equal(t, 2, allowed(t, userID, nil, "", false), "unsigned requests keep the ordinary limit")

		userID, key, deviceID := newDevice(t, true)
		assert.Equal(t, 4, allowed(t, userID, &key, deviceID, false), "a verified device gets the multiplied limit")

		userID, key, deviceID = newDevice(t, false)
		assert.Equal(t, 2, allowed(t, userID, &key, deviceID, false), "an unverified build gets the ordinary limit")

		userID, key, deviceID = newDevice(t, true)
		assert.Equal(t, 2, allowed(t, userID, &key, deviceID, true), "a signature over another body is ignored")

		otherUser, _, _ := newDevice(t, true)
		_, key, deviceID = newDevice(t, true)
		assert.Equal(t, 2, allowed(t, otherUser, &key, deviceID, false), "a device only counts for its owner's tokens")
	})
}
