package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// Human verification protects anonymous account flows (login, registration,
// email codes, password reset) and daily check-in. One provider is active at a
// time: Cloudflare Turnstile, GeeTest v4 or Google reCAPTCHA v2.
//
// GeeTest and reCAPTCHA are reached through endpoints that serve mainland
// China: gcaptcha4.geetest.com, and www.recaptcha.net, which Google documents
// as the replacement for www.google.com where that is not accessible.
const HumanVerificationProviderTurnstile = "turnstile"

// Provider endpoints. Variables so tests can point them at a local server.
var (
	geetestValidateURL     = "https://gcaptcha4.geetest.com/validate"
	recaptchaSiteVerifyURL = "https://www.recaptcha.net/recaptcha/api/siteverify"
	turnstileSiteVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
)

const (
	humanVerificationTimeout = 8 * time.Second
	humanVerificationMaxBody = 64 << 10
)

var (
	ErrHumanVerificationMissing = errors.New("human verification response is missing")
	ErrHumanVerificationFailed  = errors.New("human verification failed")
)

// HumanVerificationProvider is the active provider, or "" when none is enabled.
func HumanVerificationProvider() string {
	if common.TurnstileCheckEnabled {
		return HumanVerificationProviderTurnstile
	}
	switch provider := system_setting.GetHumanVerificationSettings().Provider; provider {
	case system_setting.HumanVerificationProviderGeetest, system_setting.HumanVerificationProviderRecaptcha:
		return provider
	}
	return ""
}

// ValidateHumanVerificationOption checks an option update that changes which
// provider is active or the keys it depends on. It keeps at most one provider
// enabled and never lets an enabled provider lose its keys, which would leave
// every protected request failing.
func ValidateHumanVerificationOption(key string, value string) error {
	settings := system_setting.GetHumanVerificationSettings()
	switch key {
	case "TurnstileCheckEnabled":
		if value == "true" && settings.Provider != "" {
			return common.NewMessage("Only one human verification provider can be enabled at a time. Turn off the current one first.")
		}
	case "human_verification.provider":
		switch value {
		case "":
			return nil
		case system_setting.HumanVerificationProviderGeetest:
			if settings.GeetestCaptchaId == "" || settings.GeetestSecret == "" {
				return common.NewMessage("Cannot enable {{provider}} verification. Enter the {{provider}} settings first.", map[string]any{"provider": "GeeTest"})
			}
		case system_setting.HumanVerificationProviderRecaptcha:
			if settings.RecaptchaSiteKey == "" || settings.RecaptchaSecret == "" {
				return common.NewMessage("Cannot enable {{provider}} verification. Enter the {{provider}} settings first.", map[string]any{"provider": "reCAPTCHA"})
			}
		default:
			return common.NewMessage("Invalid parameters")
		}
		if common.TurnstileCheckEnabled {
			return common.NewMessage("Only one human verification provider can be enabled at a time. Turn off the current one first.")
		}
	case "human_verification.geetest_captcha_id", "human_verification.geetest_secret":
		if strings.TrimSpace(value) == "" && settings.Provider == system_setting.HumanVerificationProviderGeetest {
			return common.NewMessage("Turn off {{provider}} verification before clearing its keys.", map[string]any{"provider": "GeeTest"})
		}
	case "human_verification.recaptcha_site_key", "human_verification.recaptcha_secret":
		if strings.TrimSpace(value) == "" && settings.Provider == system_setting.HumanVerificationProviderRecaptcha {
			return common.NewMessage("Turn off {{provider}} verification before clearing its keys.", map[string]any{"provider": "reCAPTCHA"})
		}
	case "human_verification.login_enabled", "human_verification.register_enabled",
		"human_verification.email_verification_enabled", "human_verification.reset_password_enabled",
		"human_verification.checkin_enabled", "human_verification.redemption_enabled",
		"human_verification.lottery_enabled":
		if value != "true" && value != "false" {
			return common.NewMessage("Invalid parameters")
		}
	}
	return nil
}

// IsHumanVerificationSceneEnabled reports whether human verification is
// required for the given scene when a provider is active.
func IsHumanVerificationSceneEnabled(scene string) bool {
	if HumanVerificationProvider() == "" {
		return false
	}
	return system_setting.GetHumanVerificationSettings().IsSceneEnabled(scene)
}

// VerifyHuman checks token against the active provider. For Turnstile and
// reCAPTCHA token is the widget response; for GeeTest it is the JSON object
// {"lot_number","captcha_output","pass_token","gen_time"} from getValidate().
//
// A nil error means the request may proceed; it is also nil when no provider is
// enabled. Errors other than ErrHumanVerificationMissing and
// ErrHumanVerificationFailed mean the provider could not be asked, and the
// request must still be refused.
func VerifyHuman(ctx context.Context, token string, remoteIP string) error {
	provider := HumanVerificationProvider()
	if provider == "" {
		return nil
	}
	if strings.TrimSpace(token) == "" {
		return ErrHumanVerificationMissing
	}
	switch provider {
	case HumanVerificationProviderTurnstile:
		return verifySiteVerifyToken(ctx, turnstileSiteVerifyURL, common.TurnstileSecretKey, token, remoteIP)
	case system_setting.HumanVerificationProviderRecaptcha:
		return verifySiteVerifyToken(ctx, recaptchaSiteVerifyURL, system_setting.GetHumanVerificationSettings().RecaptchaSecret, token, remoteIP)
	default:
		return verifyGeetest(ctx, token)
	}
}

// verifySiteVerifyToken runs the siteverify call shared by Turnstile and
// reCAPTCHA: POST secret + response (+ remoteip), read {"success": bool}.
func verifySiteVerifyToken(ctx context.Context, endpoint string, secret string, token string, remoteIP string) error {
	if secret == "" {
		return errors.New("human verification secret is not configured")
	}
	form := url.Values{"secret": {secret}, "response": {token}}
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	var result struct {
		Success bool `json:"success"`
	}
	if err := callHumanVerificationAPI(ctx, http.MethodPost, endpoint, form, &result); err != nil {
		return err
	}
	if !result.Success {
		return ErrHumanVerificationFailed
	}
	return nil
}

// callHumanVerificationAPI sends form to a provider (as a POST body or a GET
// query) and decodes its JSON reply into out.
func callHumanVerificationAPI(ctx context.Context, method string, endpoint string, form url.Values, out any) error {
	var body io.Reader
	if method == http.MethodGet {
		endpoint += "?" + form.Encode()
	} else {
		body = strings.NewReader(form.Encode())
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	client := &http.Client{Timeout: humanVerificationTimeout}
	if shared := GetHttpClient(); shared != nil {
		client.Transport = shared.Transport
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, humanVerificationMaxBody))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return errors.New("human verification provider returned HTTP " + response.Status)
	}
	return common.Unmarshal(payload, out)
}

// verifyGeetest runs GeeTest v4 secondary validation. token is the JSON object
// from the browser's getValidate(): lot_number, captcha_output, pass_token and
// gen_time. GeeTest itself refuses an answer that was already validated
// (-50003) or has expired, so one solved puzzle passes one request.
//
// GeeTest's sample code lets requests through when /validate cannot be
// reached. This server fails closed instead: an unreachable GeeTest or an
// unusable captcha ID returns an error and the protected request is refused.
func verifyGeetest(ctx context.Context, token string) error {
	var answer struct {
		LotNumber     string `json:"lot_number"`
		CaptchaOutput string `json:"captcha_output"`
		PassToken     string `json:"pass_token"`
		GenTime       string `json:"gen_time"`
	}
	if err := common.UnmarshalJsonStr(token, &answer); err != nil {
		return ErrHumanVerificationFailed
	}
	if answer.LotNumber == "" || answer.CaptchaOutput == "" || answer.PassToken == "" || answer.GenTime == "" {
		return ErrHumanVerificationMissing
	}
	settings := system_setting.GetHumanVerificationSettings()
	if settings.GeetestCaptchaId == "" || settings.GeetestSecret == "" {
		return errors.New("geetest keys are not configured")
	}
	mac := hmac.New(sha256.New, []byte(settings.GeetestSecret))
	mac.Write([]byte(answer.LotNumber))
	form := url.Values{
		"lot_number":     {answer.LotNumber},
		"captcha_output": {answer.CaptchaOutput},
		"pass_token":     {answer.PassToken},
		"gen_time":       {answer.GenTime},
		"sign_token":     {hex.EncodeToString(mac.Sum(nil))},
	}
	endpoint := geetestValidateURL + "?" + url.Values{"captcha_id": {settings.GeetestCaptchaId}}.Encode()
	var result struct {
		Status string `json:"status"`
		Result string `json:"result"`
		Reason string `json:"reason"`
		Code   string `json:"code"`
		Msg    string `json:"msg"`
	}
	if err := callHumanVerificationAPI(ctx, http.MethodPost, endpoint, form, &result); err != nil {
		return err
	}
	if result.Status == "success" && result.Result == "success" {
		return nil
	}
	if result.Status == "error" && geetestServiceErrorCodes[result.Code] {
		return fmt.Errorf("geetest validate error %s: %s", result.Code, result.Msg)
	}
	return ErrHumanVerificationFailed
}

// geetestServiceErrorCodes are /validate errors caused by the site's GeeTest
// configuration or by GeeTest itself rather than by the visitor's answer.
// They are reported as unavailable so the admin sees them in the server log.
var geetestServiceErrorCodes = map[string]bool{
	"-50000": true, // undefined runtime error
	"-50101": true, // captcha_id missing
	"-50102": true, // illegal captcha_id
	"-50103": true, // captcha_id does not exist
	"-50104": true, // captcha_id deleted
	"-50105": true, // captcha_id paused
}
