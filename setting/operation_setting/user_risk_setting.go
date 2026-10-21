package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// UserRiskSetting weights the periodic user risk score computed from client IPs.
type UserRiskSetting struct {
	Enabled          bool `json:"enabled"`
	WindowDays       int  `json:"window_days"`        // IP observation window
	SharedIpScore    int  `json:"shared_ip_score"`    // per other account sharing an exact IP
	SameSubnetScore  int  `json:"same_subnet_score"`  // per other account sharing only an IPv4 /24 or IPv6 /64
	MultiIpThreshold int  `json:"multi_ip_threshold"` // distinct IPs allowed before scoring
	MultiIpScore     int  `json:"multi_ip_score"`     // per distinct IP above the threshold
	MaxScore         int  `json:"max_score"`
}

var userRiskSetting = UserRiskSetting{
	Enabled:          true,
	WindowDays:       30,
	SharedIpScore:    10,
	SameSubnetScore:  2,
	MultiIpThreshold: 10,
	MultiIpScore:     1,
	MaxScore:         100,
}

func init() {
	config.GlobalConfig.Register("user_risk_setting", &userRiskSetting)
}

func GetUserRiskSetting() *UserRiskSetting {
	return &userRiskSetting
}
