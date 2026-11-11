package system_setting

import "github.com/QuantumNous/new-api/setting/config"

const (
	HumanVerificationProviderGeetest   = "geetest"
	HumanVerificationProviderRecaptcha = "recaptcha"

	HumanVerificationSceneLogin             = "login"
	HumanVerificationSceneRegister          = "register"
	HumanVerificationSceneEmailVerification = "email_verification"
	HumanVerificationSceneResetPassword     = "reset_password"
	HumanVerificationSceneCheckin           = "checkin"
	HumanVerificationSceneRedemption        = "redemption"
	HumanVerificationSceneLottery           = "lottery"
)

// HumanVerificationSettings selects GeeTest v4 or reCAPTCHA v2 as the human
// check and controls which scenes require human verification. GeetestCaptchaId
// and GeetestSecret are the captcha_id and captcha_key of a GeeTest v4
// scenario. Cloudflare Turnstile keeps its legacy TurnstileCheckEnabled switch,
// and the option API allows only one of them to be active at a time.
//
// Secret fields end in "secret" so the option list never returns them.
type HumanVerificationSettings struct {
	Provider                 string `json:"provider"`
	GeetestCaptchaId         string `json:"geetest_captcha_id"`
	GeetestSecret            string `json:"geetest_secret"`
	RecaptchaSiteKey         string `json:"recaptcha_site_key"`
	RecaptchaSecret          string `json:"recaptcha_secret"`
	LoginEnabled             bool   `json:"login_enabled"`
	RegisterEnabled          bool   `json:"register_enabled"`
	EmailVerificationEnabled bool   `json:"email_verification_enabled"`
	ResetPasswordEnabled     bool   `json:"reset_password_enabled"`
	CheckinEnabled           bool   `json:"checkin_enabled"`
	RedemptionEnabled        bool   `json:"redemption_enabled"`
	LotteryEnabled           bool   `json:"lottery_enabled"`
}

func DefaultHumanVerificationSettings() HumanVerificationSettings {
	return HumanVerificationSettings{
		LoginEnabled:             true,
		RegisterEnabled:          true,
		EmailVerificationEnabled: true,
		ResetPasswordEnabled:     true,
		CheckinEnabled:           true,
		RedemptionEnabled:        false,
		LotteryEnabled:           false,
	}
}

func (s *HumanVerificationSettings) IsSceneEnabled(scene string) bool {
	switch scene {
	case HumanVerificationSceneLogin:
		return s.LoginEnabled
	case HumanVerificationSceneRegister:
		return s.RegisterEnabled
	case HumanVerificationSceneEmailVerification:
		return s.EmailVerificationEnabled
	case HumanVerificationSceneResetPassword:
		return s.ResetPasswordEnabled
	case HumanVerificationSceneCheckin:
		return s.CheckinEnabled
	case HumanVerificationSceneRedemption:
		return s.RedemptionEnabled
	case HumanVerificationSceneLottery:
		return s.LotteryEnabled
	default:
		return true
	}
}

func (s *HumanVerificationSettings) ScenesMap() map[string]bool {
	return map[string]bool{
		HumanVerificationSceneLogin:             s.LoginEnabled,
		HumanVerificationSceneRegister:          s.RegisterEnabled,
		HumanVerificationSceneEmailVerification: s.EmailVerificationEnabled,
		HumanVerificationSceneResetPassword:     s.ResetPasswordEnabled,
		HumanVerificationSceneCheckin:           s.CheckinEnabled,
		HumanVerificationSceneRedemption:        s.RedemptionEnabled,
		HumanVerificationSceneLottery:           s.LotteryEnabled,
	}
}

var defaultHumanVerificationSettings = DefaultHumanVerificationSettings()

func init() {
	config.GlobalConfig.Register("human_verification", &defaultHumanVerificationSettings)
}

func GetHumanVerificationSettings() *HumanVerificationSettings {
	return &defaultHumanVerificationSettings
}
