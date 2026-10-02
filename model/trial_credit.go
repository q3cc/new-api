package model

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const TrialConfigKey = "TrialCreditConfig"

var ErrTrialInsufficient = errors.New("体验金不足或已过期")

type TrialCreditConfig struct {
	Enabled       bool   `json:"enabled"`
	Group         string `json:"group"`
	Affiliate     bool   `json:"affiliate"`
	AffiliateDays int    `json:"affiliate_days"`
}

type TrialCreditGrant struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"index"`
	GrantKey  string `json:"-" gorm:"size:128;uniqueIndex"`
	Quota     int    `json:"quota" gorm:"type:bigint"`
	Remaining int    `json:"remaining" gorm:"type:bigint"`
	ExpiresAt int64  `json:"expires_at" gorm:"index"`
	CreatedAt int64  `json:"created_at"`
	Source    string `json:"source" gorm:"size:24"`
	ActorId   int    `json:"actor_id"`
}

type TrialCreditReservation struct {
	LegacyTaskId  int     `json:"-" gorm:"index"`
	Applied       bool    `json:"-" gorm:"-"`
	Id            int     `json:"id" gorm:"primaryKey"`
	RequestId     string  `json:"request_id" gorm:"size:128;uniqueIndex"`
	UserId        int     `json:"user_id" gorm:"index"`
	GroupName     string  `json:"group" gorm:"size:64"`
	Reserved      int     `json:"reserved" gorm:"type:bigint"`
	Actual        int     `json:"actual" gorm:"type:bigint"`
	TrialCharged  int     `json:"trial_charged" gorm:"type:bigint"`
	WalletCharged int     `json:"wallet_charged" gorm:"type:bigint"`
	Waived        int     `json:"waived" gorm:"type:bigint"`
	CNYRate       float64 `json:"cny_rate"`
	QuotaUnit     float64 `json:"quota_unit"`
	Status        string  `json:"status" gorm:"size:16;index"`
	CreatedAt     int64   `json:"created_at"`
}

type TrialCreditAllocation struct {
	Id            int `gorm:"primaryKey"`
	ReservationId int `gorm:"uniqueIndex:trial_allocation"`
	GrantId       int `gorm:"uniqueIndex:trial_allocation"`
	Quota         int `gorm:"type:bigint"`
}

var trialCreditDatabase atomic.Pointer[gorm.DB]

func MigrateTrialCredit() error {
	if err := DB.AutoMigrate(&TrialCreditGrant{}, &TrialCreditReservation{}, &TrialCreditAllocation{}); err != nil {
		return err
	}
	if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: TrialConfigKey, Value: "{}"}).Error; err != nil {
		return err
	}
	trialCreditDatabase.Store(DB)
	return nil
}
func ReadTrialCreditConfig() (TrialCreditConfig, error) {
	var cfg TrialCreditConfig
	if DB != nil && trialCreditDatabase.Load() == DB {
		var option Option
		err := DB.Where(map[string]any{"key": TrialConfigKey}).First(&option).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return cfg, nil
		}
		if err != nil {
			return cfg, err
		}
		err = common.UnmarshalJsonStr(option.Value, &cfg)
		return cfg, err
	}
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[TrialConfigKey]
	common.OptionMapRWMutex.RUnlock()
	if raw == "" {
		return cfg, nil
	}
	err := common.UnmarshalJsonStr(raw, &cfg)
	return cfg, err
}
func GetTrialCreditConfig() TrialCreditConfig {
	if cfg, err := ReadTrialCreditConfig(); err == nil {
		return cfg
	}

	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[TrialConfigKey]
	common.OptionMapRWMutex.RUnlock()
	var cfg TrialCreditConfig
	_ = common.UnmarshalJsonStr(raw, &cfg)
	return cfg
}

func trialPolicyLock(tx *gorm.DB) (*Option, error) {
	// The write also serializes transactions on SQLite before any balance reads.
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: TrialConfigKey, Value: "{}"}).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&Option{}).Where(map[string]any{"key": TrialConfigKey}).UpdateColumn("value", gorm.Expr("value")).Error; err != nil {
		return nil, err
	}
	var option Option
	err := lockForUpdate(tx).Where(map[string]any{"key": TrialConfigKey}).First(&option).Error
	return &option, err
}

func validateTrialConfig(cfg TrialCreditConfig) error {
	if cfg.AffiliateDays < 0 || cfg.AffiliateDays > 36500 {
		return errors.New("有效天数无效")
	}
	if len(cfg.Group) > 64 {
		return errors.New("体验分组名称过长")
	}
	if cfg.Enabled && (cfg.Group == "" || cfg.Group == "auto" || !ratio_setting.ContainsGroupRatio(cfg.Group)) {
		return errors.New("请选择体验分组")
	}
	if cfg.Affiliate && !cfg.Enabled {
		return errors.New("请先启用体验金")
	}
	return nil
}

func UpdateTrialCreditConfig(cfg TrialCreditConfig) error {
	cfg.Group = strings.TrimSpace(cfg.Group)
	if err := validateTrialConfig(cfg); err != nil {
		return err
	}
	raw, err := common.Marshal(cfg)
	if err != nil {
		return err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var old TrialCreditConfig
		if err = common.UnmarshalJsonStr(option.Value, &old); err != nil {
			return err
		}
		if old.Group != cfg.Group || old.Enabled && !cfg.Enabled {
			var count int64
			if err = tx.Model(&TrialCreditGrant{}).Where("remaining > 0 AND (expires_at = 0 OR expires_at > ?)", time.Now().Unix()).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("仍有可用体验金")
			}
			if err = tx.Model(&TrialCreditReservation{}).Where("status = ?", "reserved").Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("仍有未完成请求")
			}
		}
		return tx.Model(option).Update("value", string(raw)).Error
	})
	if err != nil {
		return err
	}
	return updateOptionMap(TrialConfigKey, string(raw))
}

func GrantTrialCredit(userId, quota int, expiresAt int64, key, source string, actorId int) error {
	if userId <= 0 || quota <= 0 || quota > common.MaxWalletQuota || len(key) == 0 || len(key) > 128 || expiresAt < 0 || expiresAt > 0 && expiresAt <= time.Now().Unix() {
		return errors.New("体验金参数无效")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var cfg TrialCreditConfig
		if err = common.UnmarshalJsonStr(option.Value, &cfg); err != nil {
			return err
		}
		if !cfg.Enabled {
			return errors.New("体验金未启用")
		}
		var user User
		if err = lockForUpdate(tx).First(&user, userId).Error; err != nil {
			return err
		}
		return grantTrialCreditTx(tx, userId, quota, expiresAt, key, source, actorId)
	})
}

func grantTrialCreditTx(tx *gorm.DB, userId, quota int, expiresAt int64, key, source string, actorId int) error {
	var existing TrialCreditGrant
	err := tx.Where("grant_key = ?", key).First(&existing).Error
	if err == nil {
		if existing.UserId != userId || existing.Quota != quota || existing.ExpiresAt != expiresAt || existing.Source != source || existing.ActorId != actorId {
			return errors.New("发放编号已使用")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	balance, err := trialBalance(tx, userId)
	if err != nil {
		return err
	}
	var reserved int
	if err = tx.Model(&TrialCreditReservation{}).Where("user_id = ? AND status = ?", userId, "reserved").Select("COALESCE(SUM(reserved), 0)").Scan(&reserved).Error; err != nil {
		return err
	}
	if reserved > common.MaxWalletQuota-balance || quota > common.MaxWalletQuota-balance-reserved {
		return errors.New("体验金超过上限")
	}
	return tx.Create(&TrialCreditGrant{UserId: userId, Quota: quota, Remaining: quota, ExpiresAt: expiresAt, GrantKey: key, Source: source, ActorId: actorId, CreatedAt: time.Now().Unix()}).Error
}

func trialBalance(tx *gorm.DB, userId int) (int, error) {
	var balance int
	err := tx.Model(&TrialCreditGrant{}).Where("user_id = ? AND remaining > 0 AND (expires_at = 0 OR expires_at > ?)", userId, time.Now().Unix()).Select("COALESCE(SUM(remaining), 0)").Scan(&balance).Error
	return balance, err
}
func GetTrialCreditBalance(userId int) (int, error) { return trialBalance(DB, userId) }

func ReserveTrialCredit(requestId string, userId int, group string, target int) error {
	if requestId == "" || len(requestId) > 128 || target < 0 || target > math.MaxInt32 {
		return errors.New("体验请求参数无效")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var cfg TrialCreditConfig
		if err = common.UnmarshalJsonStr(option.Value, &cfg); err != nil {
			return err
		}
		if !cfg.Enabled || cfg.Group != group {
			return ErrTrialInsufficient
		}
		var user User
		if err = lockForUpdate(tx).First(&user, userId).Error; err != nil {
			return err
		}
		var r TrialCreditReservation
		err = tx.Where("request_id = ?", requestId).First(&r).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			balance, err := trialBalance(tx, userId)
			if err != nil {
				return err
			}
			if balance <= 0 {
				return ErrTrialInsufficient
			}
			rate := operation_setting.USDExchangeRate
			if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || common.QuotaPerUnit <= 0 || math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) {
				return errors.New("汇率无效")
			}
			r = TrialCreditReservation{RequestId: requestId, UserId: userId, GroupName: group, Status: "reserved", CNYRate: rate, QuotaUnit: common.QuotaPerUnit, CreatedAt: time.Now().Unix()}
			if err = tx.Create(&r).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if r.UserId != userId || r.GroupName != group || r.Status != "reserved" {
			return errors.New("体验请求已结束")
		}
		if target <= r.Reserved {
			return nil
		}
		needed := target - r.Reserved
		used, err := allocateTrialCredit(tx, &r, needed)
		if err != nil {
			return err
		}
		if used != needed {
			return ErrTrialInsufficient
		}
		r.Reserved = target
		return tx.Save(&r).Error
	})
}

func allocateTrialCredit(tx *gorm.DB, r *TrialCreditReservation, amount int) (int, error) {
	var grants []TrialCreditGrant
	if err := tx.Where("user_id = ? AND remaining > 0 AND (expires_at = 0 OR expires_at > ?)", r.UserId, time.Now().Unix()).Find(&grants).Error; err != nil {
		return 0, err
	}
	sort.Slice(grants, func(i, j int) bool {
		a, b := grants[i].ExpiresAt, grants[j].ExpiresAt
		if a == b {
			return grants[i].Id < grants[j].Id
		}
		if a == 0 {
			return false
		}
		if b == 0 {
			return true
		}
		return a < b
	})
	left := amount
	for _, g := range grants {
		if left == 0 {
			break
		}
		n := min(g.Remaining, left)
		if err := tx.Model(&g).UpdateColumn("remaining", gorm.Expr("remaining - ?", n)).Error; err != nil {
			return 0, err
		}
		var a TrialCreditAllocation
		err := tx.Where("reservation_id = ? AND grant_id = ?", r.Id, g.Id).First(&a).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			a = TrialCreditAllocation{ReservationId: r.Id, GrantId: g.Id}
		} else if err != nil {
			return 0, err
		}
		a.Quota += n
		if err = tx.Save(&a).Error; err != nil {
			return 0, err
		}
		left -= n
	}
	return amount - left, nil
}

func releaseTrialCredit(tx *gorm.DB, r *TrialCreditReservation, amount int) error {
	var allocations []TrialCreditAllocation
	if err := tx.Where("reservation_id = ?", r.Id).Order("id DESC").Find(&allocations).Error; err != nil {
		return err
	}
	for _, a := range allocations {
		if amount == 0 {
			break
		}
		n := min(a.Quota, amount)
		if err := tx.Model(&TrialCreditGrant{}).Where("id = ?", a.GrantId).UpdateColumn("remaining", gorm.Expr("remaining + ?", n)).Error; err != nil {
			return err
		}
		a.Quota -= n
		if err := tx.Save(&a).Error; err != nil {
			return err
		}
		amount -= n
	}
	if amount != 0 {
		return errors.New("体验金流水不一致")
	}
	return nil
}

// Resize only releases a failed supplementary reserve; it never settles debt.
func ReleaseTrialCreditReserve(requestId string, target int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := trialPolicyLock(tx); err != nil {
			return err
		}
		var r TrialCreditReservation
		if err := tx.Where("request_id = ?", requestId).First(&r).Error; err != nil {
			return err
		}
		if r.Status != "reserved" || target < 0 || target > r.Reserved {
			return errors.New("体验金预留无效")
		}
		if err := releaseTrialCredit(tx, &r, r.Reserved-target); err != nil {
			return err
		}
		r.Reserved = target
		return tx.Save(&r).Error
	})
}

// Finalize uses an absolute charge, not a delta, so a callback retry is harmless.
func FinalizeTrialCredit(requestId string, actual int, refund bool) (*TrialCreditReservation, error) {
	if actual < 0 || actual > math.MaxInt32 {
		return nil, errors.New("体验金费用无效")
	}
	var r TrialCreditReservation
	cacheReserved := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := trialPolicyLock(tx); err != nil {
			return err
		}
		if err := tx.Where("request_id = ?", requestId).First(&r).Error; err != nil {
			return err
		}
		if r.Status != "reserved" {
			return nil
		}
		var user User
		if err := lockForUpdate(tx).First(&user, r.UserId).Error; err != nil {
			return err
		}
		if refund {
			actual = 0
		}
		available := r.Reserved
		if actual > available {
			n, err := allocateTrialCredit(tx, &r, actual-available)
			if err != nil {
				return err
			}
			available += n
		}
		if available > actual {
			if err := releaseTrialCredit(tx, &r, available-actual); err != nil {
				return err
			}
		}
		r.Actual = actual
		r.TrialCharged = min(available, actual)
		debt := actual - r.TrialCharged
		excess := decimal.Max(decimal.Zero, decimal.NewFromInt(int64(debt)).Sub(decimal.NewFromFloat(r.QuotaUnit).Div(decimal.NewFromFloat(r.CNYRate))))
		charge, err := common.WalletQuotaFromDecimalStrict(excess.Mul(decimal.NewFromFloat(0.2)))
		if err != nil {
			return err
		}
		charge = max(0, charge)
		if charge > 0 && user.Quota >= charge && common.RedisEnabled {
			result, cacheErr := cacheTryReserveUserQuota(user.Id, int64(charge))
			if cacheErr == nil && result == cacheQuotaMiss {
				cacheErr = populateUserCache(user)
				if cacheErr == nil {
					result, cacheErr = cacheTryReserveUserQuota(user.Id, int64(charge))
				}
			}
			if cacheErr != nil {
				return cacheErr
			}
			if result != cacheQuotaOK {
				charge = 0
			} else {
				cacheReserved = charge
			}
		}
		if charge > 0 && user.Quota >= charge {
			if err = tx.Model(&user).UpdateColumn("quota", gorm.Expr("quota - ?", charge)).Error; err != nil {
				return err
			}
			r.WalletCharged = charge
		}
		r.Waived = debt - r.WalletCharged
		r.Status = "settled"
		if refund {
			r.Status = "refunded"
		}
		if err := tx.Save(&r).Error; err != nil {
			return err
		}
		r.Applied = true
		return nil
	})
	if err != nil && cacheReserved > 0 {
		if _, cacheErr := cacheApplyUserQuotaDelta(r.UserId, int64(cacheReserved)); cacheErr != nil {
			common.SysError(cacheErr.Error())
		}
	}
	return &r, err
}

func AwardTrialAffiliate(inviterId, inviteeId int) (bool, error) {
	cfg, readErr := ReadTrialCreditConfig()
	if readErr != nil {
		return true, readErr
	}
	if DB != nil && trialCreditDatabase.Load() == DB {
		var count int64
		if err := DB.Model(&TrialCreditGrant{}).Where("grant_key = ?", fmt.Sprintf("affiliate:%d", inviteeId)).Count(&count).Error; err != nil {
			return true, err
		}
		if count > 0 {
			return true, nil
		}
	}
	if !cfg.Enabled || !cfg.Affiliate {
		return false, nil
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		if err = common.UnmarshalJsonStr(option.Value, &cfg); err != nil {
			return err
		}
		if !cfg.Enabled || !cfg.Affiliate {
			return errors.New("邀请奖励设置已变更")
		}
		var user User
		if err = lockForUpdate(tx).First(&user, inviterId).Error; err != nil {
			return err
		}
		key := fmt.Sprintf("affiliate:%d", inviteeId)
		var count int64
		if err = tx.Model(&TrialCreditGrant{}).Where("grant_key = ?", key).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		expires := int64(0)
		if cfg.AffiliateDays > 0 {
			expires = time.Now().Unix() + int64(cfg.AffiliateDays)*86400
		}
		if err = grantTrialCreditTx(tx, inviterId, common.QuotaForInviter, expires, key, "affiliate", 0); err != nil {
			return err
		}
		return tx.Model(&user).Updates(map[string]any{"aff_count": gorm.Expr("aff_count + 1"), "aff_history": gorm.Expr("aff_history + ?", common.QuotaForInviter)}).Error
	})
	return true, err
}

func ValidateTrialGroupOption(key, value string) error {
	if key != "GroupRatio" && key != "group_ratio_setting.group_ratio" {
		return nil
	}
	cfg := GetTrialCreditConfig()
	if cfg.Group == "" {
		return nil
	}
	var groups map[string]float64
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return err
	}
	if _, ok := groups[cfg.Group]; !ok {
		return errors.New("不能删除体验分组")
	}
	return nil
}

func LinkTrialMidjourney(requestId string, taskId int) error {
	return DB.Model(&TrialCreditReservation{}).Where("request_id = ? AND status = ?", requestId, "reserved").Update("legacy_task_id", taskId).Error
}
func GetMidjourneyTrialReservation(taskId int) (*TrialCreditReservation, error) {
	if GetTrialCreditConfig().Group == "" {
		return nil, nil
	}
	var r TrialCreditReservation
	err := DB.Where("legacy_task_id = ?", taskId).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &r, err
}
