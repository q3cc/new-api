package operation_setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// ClientDeviceSetting governs native chat clients (Lyra Box) that sign in by
// browser authorization and then sign their requests with a per-device key.
type ClientDeviceSetting struct {
	// Enabled turns browser authorization for native clients on or off.
	Enabled bool `json:"enabled"`
	// MaxDevicesPerUser bounds the active authorized devices of one user.
	MaxDevicesPerUser int `json:"max_devices_per_user"`
	// VerifiedRPMEnabled raises the model request rate limit for requests
	// signed by a verified device of the token's owner.
	VerifiedRPMEnabled bool `json:"verified_rpm_enabled"`
	// VerifiedRPMMultiplier scales both model request rate limits for those
	// requests.
	VerifiedRPMMultiplier float64 `json:"verified_rpm_multiplier"`
}

// ClientDeviceSettingMaxDevices and ClientDeviceSettingMaxMultiplier bound the
// admin-editable values.
const (
	ClientDeviceSettingMaxDevices    = 100
	ClientDeviceSettingMaxMultiplier = 100
)

var clientDeviceSetting = ClientDeviceSetting{
	Enabled:               true,
	MaxDevicesPerUser:     10,
	VerifiedRPMEnabled:    false,
	VerifiedRPMMultiplier: 2,
}

// ClientDeviceSecretSetting holds the build keys of official client builds. A
// device whose authorization request carries an HMAC made with one of them is
// marked verified. It is separate from ClientDeviceSetting because only the
// root user may change it, through the options API, which never returns it:
// option keys ending in "secret" are write-only. Several keys may be active at
// once, one per line, so a key can be rotated without breaking builds that are
// still in use.
type ClientDeviceSecretSetting struct {
	BuildSecret string `json:"build_secret"`
}

var clientDeviceSecretSetting = ClientDeviceSecretSetting{}

func init() {
	config.GlobalConfig.Register("client_device_setting", &clientDeviceSetting)
	config.GlobalConfig.Register("client_device_secret_setting", &clientDeviceSecretSetting)
}

func GetClientDeviceSetting() *ClientDeviceSetting {
	return &clientDeviceSetting
}

// ValidateClientDeviceOption bounds the numeric client device options before
// they are saved.
func ValidateClientDeviceOption(key, value string) error {
	switch key {
	case "client_device_setting.max_devices_per_user":
		count, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || count < 1 || count > ClientDeviceSettingMaxDevices {
			return common.NewMessage("Devices per user must be between 1 and {{max}}", map[string]any{"max": ClientDeviceSettingMaxDevices})
		}
	case "client_device_setting.verified_rpm_multiplier":
		multiplier, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil || multiplier < 1 || multiplier > ClientDeviceSettingMaxMultiplier {
			return common.NewMessage("The rate limit multiplier must be between 1 and {{max}}", map[string]any{"max": ClientDeviceSettingMaxMultiplier})
		}
	}
	return nil
}

// ClientBuildKeys returns the configured build keys, one per non-empty line.
func ClientBuildKeys() []string {
	var keys []string
	for line := range strings.SplitSeq(clientDeviceSecretSetting.BuildSecret, "\n") {
		if key := strings.TrimSpace(line); key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}
