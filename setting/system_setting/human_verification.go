package system_setting

import "github.com/QuantumNous/new-api/setting/config"

const (
	HumanVerificationProviderGeetest   = "geetest"
	HumanVerificationProviderRecaptcha = "recaptcha"
)

// HumanVerificationSettings selects GeeTest v4 or reCAPTCHA v2 as the human
// check. GeetestCaptchaId and GeetestSecret are the captcha_id and captcha_key
// of a GeeTest v4 scenario. Cloudflare Turnstile keeps its legacy TurnstileCheckEnabled switch, and
// the option API allows only one of them to be active at a time.
//
// Secret fields end in "secret" so the option list never returns them.
type HumanVerificationSettings struct {
	Provider         string `json:"provider"`
	GeetestCaptchaId string `json:"geetest_captcha_id"`
	GeetestSecret    string `json:"geetest_secret"`
	RecaptchaSiteKey string `json:"recaptcha_site_key"`
	RecaptchaSecret  string `json:"recaptcha_secret"`
}

var defaultHumanVerificationSettings = HumanVerificationSettings{}

func init() {
	config.GlobalConfig.Register("human_verification", &defaultHumanVerificationSettings)
}

func GetHumanVerificationSettings() *HumanVerificationSettings {
	return &defaultHumanVerificationSettings
}
