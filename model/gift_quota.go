package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Gift quota is wallet credit the platform granted for free. Users see its
// running total, and refunds deduct it from the refundable balance.
const (
	GiftSourceRegistration = "registration"
	// GiftSourceTopUp is extra credit a top-up promotion added on top of
	// what the user paid. Group top-up discounts are not gifts.
	GiftSourceTopUp      = "topup"
	GiftSourceAffiliate  = "affiliate"
	GiftSourceLottery    = "lottery"
	GiftSourceCheckin    = "checkin"
	GiftSourceRedemption = "redemption"
	GiftSourceAdmin      = "admin"
)

// GiftQuotaRecord stores the gift credits that leave no record of their own:
// registration rewards, admin gifts and top-up promotion bonuses (entered by
// operators for each promotion). Lottery prizes, check-ins, gift
// redemption codes and transferred invitation rewards are summed from their
// own tables, so their history needs no copy here.
type GiftQuotaRecord struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"index"`
	Source    string `json:"source" gorm:"type:varchar(32);not null"`
	Quota     int    `json:"quota" gorm:"type:bigint;not null"`
	RefKey    string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
}

type GiftQuotaItem struct {
	Source string `json:"source"`
	Quota  int64  `json:"quota"`
}

type GiftQuotaSummary struct {
	Total int64           `json:"total"`
	Items []GiftQuotaItem `json:"items"`
}

func recordGiftQuotaTx(tx *gorm.DB, userId int, source string, quota int, refKey string) error {
	if quota <= 0 {
		return nil
	}
	return tx.Create(&GiftQuotaRecord{
		UserId:    userId,
		Source:    source,
		Quota:     quota,
		RefKey:    refKey,
		CreatedAt: common.GetTimestamp(),
	}).Error
}

// GetUserGiftQuotaSummary adds up every gift credit that reached the user's
// wallet. Items with no credit are left out.
func GetUserGiftQuotaSummary(userId int) (*GiftQuotaSummary, error) {
	var user User
	if err := DB.Select("id", "aff_quota", "aff_history").First(&user, userId).Error; err != nil {
		return nil, err
	}

	var recorded []GiftQuotaItem
	if err := DB.Model(&GiftQuotaRecord{}).
		Select("source, COALESCE(SUM(quota), 0) AS quota").
		Where("user_id = ?", userId).
		Group("source").
		Scan(&recorded).Error; err != nil {
		return nil, err
	}
	bySource := make(map[string]int64, len(recorded)+4)
	for _, item := range recorded {
		bySource[item.Source] += item.Quota
	}

	// Invitation rewards count once moved into the wallet. aff_history also
	// grows when an inviter reward is paid as trial credit, which never
	// reaches aff_quota, so that part is taken back out.
	var trialAffiliate int64
	if err := DB.Model(&TrialCreditGrant{}).
		Where("user_id = ? AND source = ?", userId, "affiliate").
		Select("COALESCE(SUM(quota), 0)").Scan(&trialAffiliate).Error; err != nil {
		return nil, err
	}
	bySource[GiftSourceAffiliate] = max(int64(user.AffHistoryQuota)-int64(user.AffQuota)-trialAffiliate, 0)

	var lottery int64
	if err := DB.Model(&LotteryEntry{}).
		Joins("JOIN lottery_prizes ON lottery_prizes.id = lottery_entries.prize_id").
		Where("lottery_entries.user_id = ? AND lottery_entries.prize_type = ? AND lottery_entries.delivery_status = ?",
			userId, LotteryPrizeQuota, LotteryDeliveryDelivered).
		Select("COALESCE(SUM(lottery_prizes.quota), 0)").Scan(&lottery).Error; err != nil {
		return nil, err
	}
	bySource[GiftSourceLottery] = lottery

	var checkin int64
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).
		Select("COALESCE(SUM(quota_awarded), 0)").Scan(&checkin).Error; err != nil {
		return nil, err
	}
	bySource[GiftSourceCheckin] = checkin

	// A redeemed code still counts after an admin deletes it.
	var redemption int64
	if err := DB.Unscoped().Model(&Redemption{}).
		Where("used_user_id = ? AND gift = ? AND redemption_type = ?", userId, true, RedemptionTypeBalance).
		Select("COALESCE(SUM(quota), 0)").Scan(&redemption).Error; err != nil {
		return nil, err
	}
	bySource[GiftSourceRedemption] = redemption

	summary := &GiftQuotaSummary{Items: []GiftQuotaItem{}}
	for _, source := range []string{GiftSourceRegistration, GiftSourceTopUp, GiftSourceAffiliate, GiftSourceLottery, GiftSourceCheckin, GiftSourceRedemption, GiftSourceAdmin} {
		quota := bySource[source]
		if quota <= 0 {
			continue
		}
		summary.Items = append(summary.Items, GiftQuotaItem{Source: source, Quota: quota})
		summary.Total += quota
	}
	return summary, nil
}
