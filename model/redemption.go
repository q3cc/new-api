package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	RedemptionTypeBalance      = "balance"
	RedemptionTypeSubscription = "subscription"
)

type RedemptionResult struct {
	Type           string `json:"type"`
	Quota          int    `json:"-"`
	PlanId         int    `json:"plan_id,omitempty"`
	PlanTitle      string `json:"plan_title,omitempty"`
	SubscriptionId int    `json:"subscription_id,omitempty"`
	StartTime      int64  `json:"start_time,omitempty"`
	EndTime        int64  `json:"end_time,omitempty"`
}

type Redemption struct {
	RedemptionType string         `json:"redemption_type" gorm:"type:varchar(32);not null;default:'balance'"`
	PlanId         int            `json:"plan_id" gorm:"index;default:0"`
	PlanTitle      string         `json:"plan_title" gorm:"-"`
	Id             int            `json:"id"`
	UserId         int            `json:"user_id"`
	Key            string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status         int            `json:"status" gorm:"default:1"`
	Name           string         `json:"name" gorm:"index"`
	Quota          int            `json:"quota" gorm:"default:0"`
	CreatedTime    int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime   int64          `json:"redeemed_time" gorm:"bigint"`
	Count          int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId     int            `json:"used_user_id"`
	DeletedAt      gorm.DeletedAt `gorm:"index"`
	ExpiredTime    int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	if err := populateRedemptionPlans(redemptions); err != nil {
		return nil, 0, err
	}
	return redemptions, total, nil
}

func SearchRedemptions(keyword string, status string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})

	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
		} else {
			query = query.Where("name LIKE ?", keyword+"%")
		}
	}

	if status != "" {
		now := common.GetTimestamp()
		switch status {
		case "expired":
			query = query.Where(
				"status = ? AND expired_time != 0 AND expired_time < ?",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusEnabled):
			query = query.Where(
				"status = ? AND (expired_time = 0 OR expired_time >= ?)",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusDisabled):
			query = query.Where("status = ?", common.RedemptionCodeStatusDisabled)
		case strconv.Itoa(common.RedemptionCodeStatusUsed):
			query = query.Where("status = ?", common.RedemptionCodeStatusUsed)
		}
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	if err := populateRedemptionPlans(redemptions); err != nil {
		return nil, 0, err
	}
	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, common.NewMessage("ID is empty")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	if err := populateRedemptionPlans([]*Redemption{&redemption}); err != nil {
		return nil, err
	}
	return &redemption, nil
}

func populateRedemptionPlans(redemptions []*Redemption) error {
	ids := make([]int, 0, len(redemptions))
	for _, code := range redemptions {
		if code.RedemptionType == "" {
			code.RedemptionType = RedemptionTypeBalance
		}
		if code.RedemptionType == RedemptionTypeSubscription {
			ids = append(ids, code.PlanId)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var plans []SubscriptionPlan
	if err := DB.Select("id", "title").Where("id IN ?", ids).Find(&plans).Error; err != nil {
		return err
	}
	names := make(map[int]string, len(plans))
	for _, plan := range plans {
		names[plan.Id] = plan.Title
	}
	for _, code := range redemptions {
		code.PlanTitle = names[code.PlanId]
	}
	return nil
}

// ValidateBenefit normalizes legacy balance codes and validates the configured benefit.
func (redemption *Redemption) ValidateBenefit(tx *gorm.DB) error {
	if redemption.RedemptionType == "" {
		redemption.RedemptionType = RedemptionTypeBalance
	}
	switch redemption.RedemptionType {
	case RedemptionTypeBalance:
		if redemption.PlanId != 0 {
			return common.NewMessage("Balance redemption codes cannot bind a subscription plan")
		}
		if redemption.Quota <= 0 {
			return common.NewMessage("Redemption quota must be positive")
		}
		return common.ValidateWalletQuota(redemption.Quota)
	case RedemptionTypeSubscription:
		if redemption.PlanId <= 0 {
			return common.NewMessage("Please select an enabled subscription plan")
		}
		var plan SubscriptionPlan
		if err := tx.First(&plan, redemption.PlanId).Error; err != nil {
			return common.NewMessage("Please select an enabled subscription plan")
		}
		if !plan.Enabled {
			return common.NewMessage("Subscription plan is not enabled")
		}
		redemption.Quota = 0
		redemption.PlanTitle = plan.Title
		return nil
	default:
		return common.NewMessage("Invalid redemption type")
	}
}

// Redeem preserves the legacy numeric result for existing callers.
func Redeem(key string, userId int) (int, error) {
	result, err := RedeemWithResult(key, userId)
	if err != nil {
		return 0, err
	}
	return result.Quota, nil
}

func RedeemWithResult(key string, userId int) (*RedemptionResult, error) {
	key = strings.TrimSpace(key)
	if key == "" || userId <= 0 {
		return nil, ErrRedeemFailed
	}
	redemption := &Redemption{}
	benefit := &RedemptionResult{}
	groupChanged := false
	common.RandomSleep()
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx.Session(&gorm.Session{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})).Where(commonKeyCol+" = ?", key).First(redemption).Error; err != nil {
			return ErrRedeemFailed
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled || (redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp()) {
			return ErrRedeemFailed
		}
		// Write before reading subscription counts: SQLite must acquire its writer lock.
		result := tx.Model(&Redemption{}).Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
			Updates(map[string]any{"redeemed_time": common.GetTimestamp(), "status": common.RedemptionCodeStatusUsed, "used_user_id": userId})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrRedeemFailed
		}
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		if err := redemption.ValidateBenefit(tx); err != nil {
			return err
		}
		benefit.Type = redemption.RedemptionType
		if redemption.RedemptionType == RedemptionTypeBalance {
			benefit.Quota = redemption.Quota
			return creditTopUpQuota(tx, userId, redemption.Quota, nil)
		}
		// Deliberately bypass the plan cache: outstanding codes follow current settings.
		var plan SubscriptionPlan
		if err := tx.First(&plan, redemption.PlanId).Error; err != nil {
			return err
		}
		if !plan.Enabled {
			return common.NewMessage("Subscription plan is not enabled")
		}
		sub, err := CreateUserSubscriptionFromPlanTx(tx, userId, &plan, "redemption")
		if err != nil {
			return err
		}
		benefit.PlanId, benefit.PlanTitle, benefit.SubscriptionId = plan.Id, plan.Title, sub.Id
		benefit.StartTime, benefit.EndTime = sub.StartTime, sub.EndTime
		groupChanged = sub.PrevUserGroup != ""
		return nil
	})
	if err != nil {
		// No key or driver error is logged; driver errors can contain the lookup value.
		common.SysError(common.LogText("redemption failed for user %d", userId))
		return nil, ErrRedeemFailed
	}
	if benefit.Type == RedemptionTypeBalance {
		syncCreditUserQuotaCache(userId, benefit.Quota, common.LogText("redemption"))
		RecordLog(userId, LogTypeTopup, common.NewMessage("Topped up {{quota}} with a redemption code, code ID {{id}}", map[string]any{"quota": logger.FormatQuota(benefit.Quota), "id": redemption.Id}))
	} else {
		if groupChanged {
			refreshSubscriptionUserGroupCache(userId, common.LogText("subscription redemption"))
		}
		RecordLog(userId, LogTypeTopup, common.NewMessage("Subscription activated with a redemption code, plan: {{plan}}, code ID {{id}}, subscription ID {{subscription_id}}", map[string]any{"plan": benefit.PlanTitle, "id": redemption.Id, "subscription_id": benefit.SubscriptionId}))
	}
	return benefit, nil
}

func (redemption *Redemption) Insert() error {
	if err := redemption.ValidateBenefit(DB); err != nil {
		return err
	}
	return DB.Session(&gorm.Session{Logger: gormlogger.Default.LogMode(gormlogger.Silent)}).Create(redemption).Error
}

// Update serializes management edits with redemption and never resets redeemed state.
func (redemption *Redemption) Update(statusOnly bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var current Redemption
		if err := lockForUpdate(tx).First(&current, redemption.Id).Error; err != nil {
			return err
		}
		if current.Status == common.RedemptionCodeStatusUsed || current.UsedUserId != 0 || current.RedeemedTime != 0 {
			return common.NewMessage("Used redemption codes cannot be changed or enabled again")
		}
		if current.RedemptionType == "" {
			current.RedemptionType = RedemptionTypeBalance
		}
		if redemption.RedemptionType == "" {
			redemption.RedemptionType = current.RedemptionType
		}
		if redemption.RedemptionType != current.RedemptionType {
			return common.NewMessage("Redemption type cannot be changed")
		}
		updates := map[string]any{}
		if statusOnly {
			if redemption.Status != common.RedemptionCodeStatusEnabled && redemption.Status != common.RedemptionCodeStatusDisabled {
				return common.NewMessage("Invalid redemption status")
			}
			updates["status"] = redemption.Status
		} else {
			if err := redemption.ValidateBenefit(tx); err != nil {
				return err
			}
			updates = map[string]any{"name": redemption.Name, "quota": redemption.Quota, "plan_id": redemption.PlanId, "expired_time": redemption.ExpiredTime}
		}
		result := tx.Model(&Redemption{}).Where("id = ? AND status = ? AND used_user_id = 0 AND redeemed_time = 0", current.Id, current.Status).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		// MySQL may report zero changed rows for an unchanged value. The row
		// was locked and checked above, so this does not reset a used code.
		if result.RowsAffected != 1 && !common.UsingMainDatabase(common.DatabaseTypeMySQL) {
			return common.NewMessage("Redemption code changed, please reload")
		}
		return nil
	})
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return common.NewMessage("ID is empty")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}

// BatchDeleteRedemptions soft-deletes the selected codes in one statement.
func BatchDeleteRedemptions(ids []int) (int64, error) {
	if len(ids) == 0 || len(ids) > 1000 {
		return 0, errors.New("select between 1 and 1000 redemption codes")
	}
	for _, id := range ids {
		if id <= 0 {
			return 0, errors.New("redemption IDs must be positive")
		}
	}
	result := DB.Where("id IN ?", ids).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
