package operation_setting

import (
	"math"

	"github.com/QuantumNous/new-api/setting/config"
)

// AffiliateRebateSetting configures the rebate an inviter earns from the paid
// orders of the users they invited, and the checks on those invitations.
type AffiliateRebateSetting struct {
	Enabled         bool    `json:"enabled"`
	RatePercent     float64 `json:"rate_percent"`      // share of each paid order's credited quota
	ConfirmDays     int     `json:"confirm_days"`      // days before a rebate is credited
	RiskReviewScore int     `json:"risk_review_score"` // invitee risk score sending a rebate to review; 0 disables
	// CancelSharedIp cancels an invitation once the inviter and the invitee
	// are seen on the same public IP. It applies whether rebates are enabled.
	CancelSharedIp bool `json:"cancel_shared_ip"`
	// RestoreSharedIpPaidAmount restores an invitation cancelled for a shared
	// IP once the invitee has paid more than this in successful orders; 0
	// never restores automatically.
	RestoreSharedIpPaidAmount float64 `json:"restore_shared_ip_paid_amount"`
}

const affiliateRebateMaxConfirmDays = 90

var affiliateRebateSetting = AffiliateRebateSetting{
	Enabled:         false,
	RatePercent:     10,
	ConfirmDays:     7,
	RiskReviewScore: 50,
	CancelSharedIp:  true,

	RestoreSharedIpPaidAmount: 3,
}

func init() {
	config.GlobalConfig.Register("affiliate_rebate_setting", &affiliateRebateSetting)
}

func GetAffiliateRebateSetting() *AffiliateRebateSetting {
	return &affiliateRebateSetting
}

// RateBps is the rebate rate in basis points, clamped to [0, 10000].
func (s AffiliateRebateSetting) RateBps() int {
	if math.IsNaN(s.RatePercent) {
		return 0
	}
	return int(math.Round(min(max(s.RatePercent, 0), 100) * 100))
}

// ConfirmSeconds is the confirmation period, clamped to [0, 90] days.
func (s AffiliateRebateSetting) ConfirmSeconds() int64 {
	return int64(min(max(s.ConfirmDays, 0), affiliateRebateMaxConfirmDays)) * 24 * 3600
}
