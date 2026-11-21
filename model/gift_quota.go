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
	summaries, err := GetGiftQuotaSummaries([]int{userId})
	if err != nil {
		return nil, err
	}
	summary, ok := summaries[userId]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return summary, nil
}

// GetGiftQuotaSummaries is GetUserGiftQuotaSummary for a page of users: one
// query per source whatever the page size. Ids that match no user are left
// out of the result.
func GetGiftQuotaSummaries(userIds []int) (map[int]*GiftQuotaSummary, error) {
	summaries := make(map[int]*GiftQuotaSummary, len(userIds))
	if len(userIds) == 0 {
		return summaries, nil
	}
	var users []User
	if err := DB.Select("id", "aff_quota", "aff_history").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, err
	}

	type userQuota struct {
		UserId int
		Source string
		Quota  int64
	}
	var recorded []userQuota
	if err := DB.Model(&GiftQuotaRecord{}).
		Select("user_id, source, COALESCE(SUM(quota), 0) AS quota").
		Where("user_id IN ?", userIds).
		Group("user_id, source").
		Scan(&recorded).Error; err != nil {
		return nil, err
	}
	bySource := make(map[int]map[string]int64, len(users))
	for _, user := range users {
		bySource[user.Id] = map[string]int64{}
	}
	for _, row := range recorded {
		if sources, ok := bySource[row.UserId]; ok {
			sources[row.Source] += row.Quota
		}
	}

	// Invitation rewards count once moved into the wallet. aff_history also
	// grows when an inviter reward is paid as trial credit, which never
	// reaches aff_quota, so that part is taken back out.
	var trialAffiliate []userQuota
	if err := DB.Model(&TrialCreditGrant{}).
		Select("user_id, COALESCE(SUM(quota), 0) AS quota").
		Where("user_id IN ? AND source = ?", userIds, "affiliate").
		Group("user_id").
		Scan(&trialAffiliate).Error; err != nil {
		return nil, err
	}
	trialAffiliateByUser := make(map[int]int64, len(trialAffiliate))
	for _, row := range trialAffiliate {
		trialAffiliateByUser[row.UserId] = row.Quota
	}
	for _, user := range users {
		bySource[user.Id][GiftSourceAffiliate] = max(int64(user.AffHistoryQuota)-int64(user.AffQuota)-trialAffiliateByUser[user.Id], 0)
	}

	summed := []struct {
		source string
		query  *gorm.DB
	}{
		{GiftSourceLottery, DB.Model(&LotteryEntry{}).
			Joins("JOIN lottery_prizes ON lottery_prizes.id = lottery_entries.prize_id").
			Select("lottery_entries.user_id, COALESCE(SUM(lottery_prizes.quota), 0) AS quota").
			Where("lottery_entries.user_id IN ? AND lottery_entries.prize_type = ? AND lottery_entries.delivery_status = ?",
				userIds, LotteryPrizeQuota, LotteryDeliveryDelivered).
			Group("lottery_entries.user_id")},
		{GiftSourceCheckin, DB.Model(&Checkin{}).
			Select("user_id, COALESCE(SUM(quota_awarded), 0) AS quota").
			Where("user_id IN ?", userIds).
			Group("user_id")},
		// A redeemed code still counts after an admin deletes it.
		{GiftSourceRedemption, DB.Unscoped().Model(&Redemption{}).
			Select("used_user_id AS user_id, COALESCE(SUM(quota), 0) AS quota").
			Where("used_user_id IN ? AND gift = ? AND redemption_type = ?", userIds, true, RedemptionTypeBalance).
			Group("used_user_id")},
	}
	for _, item := range summed {
		var rows []userQuota
		if err := item.query.Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			if sources, ok := bySource[row.UserId]; ok {
				sources[item.source] = row.Quota
			}
		}
	}

	for userId, sources := range bySource {
		summary := &GiftQuotaSummary{Items: []GiftQuotaItem{}}
		for _, source := range []string{GiftSourceRegistration, GiftSourceTopUp, GiftSourceAffiliate, GiftSourceLottery, GiftSourceCheckin, GiftSourceRedemption, GiftSourceAdmin} {
			quota := sources[source]
			if quota <= 0 {
				continue
			}
			summary.Items = append(summary.Items, GiftQuotaItem{Source: source, Quota: quota})
			summary.Total += quota
		}
		summaries[userId] = summary
	}
	return summaries, nil
}
