package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTurnstileCheckRespectsSceneSwitches(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousSettings := *system_setting.GetHumanVerificationSettings()
	previousTurnstile := common.TurnstileCheckEnabled
	t.Cleanup(func() {
		*system_setting.GetHumanVerificationSettings() = previousSettings
		common.TurnstileCheckEnabled = previousTurnstile
	})

	settings := system_setting.DefaultHumanVerificationSettings()
	settings.Provider = system_setting.HumanVerificationProviderGeetest
	settings.GeetestCaptchaId = "captcha-id"
	settings.GeetestSecret = "captcha-secret"
	settings.LoginEnabled = false
	settings.RedemptionEnabled = true
	*system_setting.GetHumanVerificationSettings() = settings
	common.TurnstileCheckEnabled = false

	r := gin.New()
	r.POST("/login", TurnstileCheck(system_setting.HumanVerificationSceneLogin), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})
	r.POST("/topup", TurnstileCheck(system_setting.HumanVerificationSceneRedemption), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})
	r.POST("/lottery", TurnstileCheck(system_setting.HumanVerificationSceneLottery), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Login scene is disabled -> passes without turnstile token
	wLogin := httptest.NewRecorder()
	reqLogin, _ := http.NewRequest(http.MethodPost, "/login", nil)
	r.ServeHTTP(wLogin, reqLogin)
	assert.Contains(t, wLogin.Body.String(), `"success":true`)

	// Lottery scene defaults to disabled -> passes without turnstile token
	wLottery := httptest.NewRecorder()
	reqLottery, _ := http.NewRequest(http.MethodPost, "/lottery", nil)
	r.ServeHTTP(wLottery, reqLottery)
	assert.Contains(t, wLottery.Body.String(), `"success":true`)

	// Redemption scene is enabled -> blocked when turnstile token is missing
	wTopup := httptest.NewRecorder()
	reqTopup, _ := http.NewRequest(http.MethodPost, "/topup", nil)
	r.ServeHTTP(wTopup, reqTopup)
	assert.Contains(t, wTopup.Body.String(), `"success":false`)
}
