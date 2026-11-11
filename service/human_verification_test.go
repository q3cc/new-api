package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// useHumanVerification sets the active provider and routes provider calls to
// handler for one test, restoring the previous state afterwards.
func useHumanVerification(t *testing.T, settings system_setting.HumanVerificationSettings, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	previousSettings := *system_setting.GetHumanVerificationSettings()
	previousTurnstile := common.TurnstileCheckEnabled
	previousGeetest, previousRecaptcha := geetestValidateURL, recaptchaSiteVerifyURL
	t.Cleanup(func() {
		server.Close()
		*system_setting.GetHumanVerificationSettings() = previousSettings
		common.TurnstileCheckEnabled = previousTurnstile
		geetestValidateURL, recaptchaSiteVerifyURL = previousGeetest, previousRecaptcha
	})
	*system_setting.GetHumanVerificationSettings() = settings
	common.TurnstileCheckEnabled = false
	geetestValidateURL = server.URL + "/validate"
	recaptchaSiteVerifyURL = server.URL + "/recaptcha/api/siteverify"
}

func geetestAnswer(lotNumber string) string {
	return `{"lot_number":"` + lotNumber + `","captcha_output":"out","pass_token":"pass","gen_time":"1794382000"}`
}

func geetestSettings() system_setting.HumanVerificationSettings {
	return system_setting.HumanVerificationSettings{
		Provider:         system_setting.HumanVerificationProviderGeetest,
		GeetestCaptchaId: "captcha-id",
		GeetestSecret:    "captcha-key",
	}
}

func TestGeetestV4SignsAndValidatesTheAnswer(t *testing.T) {
	var query, form url.Values
	useHumanVerification(t, geetestSettings(), func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/validate", r.URL.Path)
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))
		require.NoError(t, r.ParseForm())
		query, form = r.URL.Query(), r.PostForm
		_, _ = w.Write([]byte(`{"status":"success","result":"success","reason":""}`))
	})

	require.NoError(t, VerifyHuman(context.Background(), geetestAnswer("lot-1"), "203.0.113.7"))

	mac := hmac.New(sha256.New, []byte("captcha-key"))
	mac.Write([]byte("lot-1"))
	assert.Equal(t, "captcha-id", query.Get("captcha_id"))
	assert.Equal(t, url.Values{
		"lot_number":     {"lot-1"},
		"captcha_output": {"out"},
		"pass_token":     {"pass"},
		"gen_time":       {"1794382000"},
		"sign_token":     {hex.EncodeToString(mac.Sum(nil))},
	}, form, "the captcha_key is sent only as the HMAC-SHA256 of lot_number")
}

func TestGeetestV4Outcomes(t *testing.T) {
	tests := []struct {
		name    string
		token   string
		handler http.HandlerFunc
		wantErr error
		// unavailable means the error is neither Missing nor Failed, so the
		// middleware reports the check as temporarily unavailable.
		unavailable bool
	}{
		{name: "answer rejected", token: geetestAnswer("lot"), handler: reply(`{"status":"success","result":"fail","reason":"pass_token expire"}`), wantErr: ErrHumanVerificationFailed},
		{name: "answer replayed", token: geetestAnswer("lot"), handler: reply(`{"status":"error","code":"-50003","msg":"duplicate verify"}`), wantErr: ErrHumanVerificationFailed},
		{name: "lot number expired", token: geetestAnswer("lot"), handler: reply(`{"status":"error","code":"-50305","msg":"lot_number expired"}`), wantErr: ErrHumanVerificationFailed},
		{name: "field missing", token: `{"lot_number":"lot","captcha_output":"out","pass_token":"pass"}`, wantErr: ErrHumanVerificationMissing},
		{name: "not JSON", token: "a-turnstile-token", wantErr: ErrHumanVerificationFailed},
		{name: "captcha ID paused", token: geetestAnswer("lot"), handler: reply(`{"status":"error","code":"-50105","msg":"captcha_id paused"}`), unavailable: true},
		{name: "HTTP error", token: geetestAnswer("lot"), handler: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusBadGateway) }, unavailable: true},
		{name: "unexpected reply", token: geetestAnswer("lot"), handler: reply(`{}`), wantErr: ErrHumanVerificationFailed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := tt.handler
			if handler == nil {
				handler = func(w http.ResponseWriter, r *http.Request) { t.Fatal("an incomplete answer must not reach GeeTest") }
			}
			useHumanVerification(t, geetestSettings(), handler)

			err := VerifyHuman(context.Background(), tt.token, "")
			require.Error(t, err, "GeeTest fails closed")
			if tt.unavailable {
				assert.NotErrorIs(t, err, ErrHumanVerificationFailed)
				assert.NotErrorIs(t, err, ErrHumanVerificationMissing)
				return
			}
			assert.ErrorIs(t, err, tt.wantErr)
		})
	}
}

func reply(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }
}

func TestRecaptchaVerifiesThroughSiteVerify(t *testing.T) {
	var received url.Values
	useHumanVerification(t, system_setting.HumanVerificationSettings{
		Provider:         system_setting.HumanVerificationProviderRecaptcha,
		RecaptchaSiteKey: "site-key",
		RecaptchaSecret:  "secret-key",
	}, func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		received = r.PostForm
		if r.PostForm.Get("response") == "good-token" {
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":false,"error-codes":["invalid-input-response"]}`))
	})

	require.NoError(t, VerifyHuman(context.Background(), "good-token", "198.51.100.4"))
	assert.Equal(t, "secret-key", received.Get("secret"))
	assert.Equal(t, "198.51.100.4", received.Get("remoteip"))
	assert.ErrorIs(t, VerifyHuman(context.Background(), "bad-token", ""), ErrHumanVerificationFailed)
	assert.ErrorIs(t, VerifyHuman(context.Background(), "  ", ""), ErrHumanVerificationMissing)
}

func TestRecaptchaUsesMainlandChinaEndpoint(t *testing.T) {
	assert.Equal(t, "https://www.recaptcha.net/recaptcha/api/siteverify", recaptchaSiteVerifyURL)
	assert.Equal(t, "https://gcaptcha4.geetest.com/validate", geetestValidateURL)
}

func TestVerifyHumanPassesWhenNoProviderIsEnabled(t *testing.T) {
	useHumanVerification(t, system_setting.HumanVerificationSettings{}, func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("no provider call is expected")
	})
	assert.Equal(t, "", HumanVerificationProvider())
	assert.NoError(t, VerifyHuman(context.Background(), "", ""))
}

func TestValidateHumanVerificationOption(t *testing.T) {
	configured := system_setting.HumanVerificationSettings{
		GeetestCaptchaId: "id", GeetestSecret: "key",
		RecaptchaSiteKey: "site", RecaptchaSecret: "secret",
	}
	tests := []struct {
		name      string
		settings  system_setting.HumanVerificationSettings
		turnstile bool
		key       string
		value     string
		wantErr   bool
	}{
		{name: "enable GeeTest with keys", settings: configured, key: "human_verification.provider", value: "geetest"},
		{name: "enable reCAPTCHA with keys", settings: configured, key: "human_verification.provider", value: "recaptcha"},
		{name: "enable GeeTest without keys", key: "human_verification.provider", value: "geetest", wantErr: true},
		{name: "enable reCAPTCHA without secret", settings: system_setting.HumanVerificationSettings{RecaptchaSiteKey: "site"}, key: "human_verification.provider", value: "recaptcha", wantErr: true},
		{name: "unknown provider", settings: configured, key: "human_verification.provider", value: "hcaptcha", wantErr: true},
		{name: "enable GeeTest while Turnstile is on", settings: configured, turnstile: true, key: "human_verification.provider", value: "geetest", wantErr: true},
		{name: "enable Turnstile while GeeTest is on", settings: withProvider(configured, "geetest"), key: "TurnstileCheckEnabled", value: "true", wantErr: true},
		{name: "turn provider off", settings: withProvider(configured, "geetest"), key: "human_verification.provider", value: ""},
		{name: "clear active GeeTest key", settings: withProvider(configured, "geetest"), key: "human_verification.geetest_secret", value: "", wantErr: true},
		{name: "clear inactive GeeTest key", settings: withProvider(configured, "recaptcha"), key: "human_verification.geetest_secret", value: ""},
		{name: "clear active reCAPTCHA key", settings: withProvider(configured, "recaptcha"), key: "human_verification.recaptcha_site_key", value: " ", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			useHumanVerification(t, tt.settings, func(w http.ResponseWriter, r *http.Request) {
				t.Fatal("option validation must not call a provider")
			})
			common.TurnstileCheckEnabled = tt.turnstile

			err := ValidateHumanVerificationOption(tt.key, tt.value)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func withProvider(settings system_setting.HumanVerificationSettings, provider string) system_setting.HumanVerificationSettings {
	settings.Provider = provider
	return settings
}
