package model

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const TrialConfigKey = "TrialCreditConfig"

var ErrTrialInsufficient = errors.New("体验金不足或已过期")

type TrialCreditConfig struct {
	Enabled         bool              `json:"enabled"`
	Group           string            `json:"group"`
	Affiliate       bool              `json:"affiliate"`
	AffiliateDays   int               `json:"affiliate_days"`
	AffiliateTypeId int               `json:"affiliate_type_id"`
	Types           []TrialCreditType `json:"types"`
	// WaiveThreshold is the wallet shortfall below which the unpaid remainder of
	// a trial request is waived instead of carried as a negative balance. It is
	// expressed in the site's current display currency (see
	// operation_setting.QuotaDisplayType). Nil means the default; an explicit 0
	// disables waiving.
	WaiveThreshold *float64 `json:"waive_threshold,omitempty"`
}

// DefaultWaiveThreshold waives a remainder smaller than half a display-currency
// unit, so a wallet emptied by a trial request is not left with a token debt.
const DefaultWaiveThreshold = 0.5

// maxWaiveThreshold bounds the configured waiver. A larger value would let a
// single request silently forgive a substantial balance.
const maxWaiveThreshold = 100

// waiveThresholdQuota converts the configured waiver into quota units using the
// currency and unit in force when the request reserved its trial credit, so a
// later settings change cannot alter an in-flight request. quotaUnit is quota
// units per USD and usdToCny is the CNY rate per USD.
func (cfg TrialCreditConfig) waiveThresholdQuota(quotaUnit, usdToCny float64) int {
	amount := DefaultWaiveThreshold
	if cfg.WaiveThreshold != nil {
		amount = *cfg.WaiveThreshold
	}
	if amount <= 0 || quotaUnit <= 0 {
		return 0
	}
	// Tokens display is not a currency, so the configured amount already counts
	// in quota units.
	if !operation_setting.IsCurrencyDisplay() {
		return clampWaiveQuota(amount)
	}
	rate := operation_setting.GetUsdToCurrencyRate(usdToCny)
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return 0
	}
	return clampWaiveQuota(amount / rate * quotaUnit)
}

// clampWaiveQuota keeps the frozen threshold inside the single-request quota
// range so an extreme currency configuration cannot overflow it.
func clampWaiveQuota(value float64) int {
	if math.IsNaN(value) || value <= 0 {
		return 0
	}
	return int(min(math.Round(value), math.MaxInt32))
}

type TrialCreditGrant struct {
	TypeId    int    `json:"type_id" gorm:"index;default:0"`
	GroupName string `json:"group" gorm:"size:64;default:''"`
	TypeName  string `json:"type_name" gorm:"size:128;default:''"`
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
	LegacyTaskId int    `json:"-" gorm:"index"`
	Applied      bool   `json:"-" gorm:"-"`
	Id           int    `json:"id" gorm:"primaryKey"`
	RequestId    string `json:"request_id" gorm:"size:128;uniqueIndex"`
	UserId       int    `json:"user_id" gorm:"index"`
	GroupName    string `json:"group" gorm:"size:64"`
	// Reserved is the total held quota; WalletReserved is its wallet-funded part.
	// Existing reservations are entirely trial-funded and migrate with zero here.
	Reserved       int     `json:"reserved" gorm:"type:bigint"`
	WalletReserved int     `json:"-" gorm:"type:bigint;default:0"`
	Actual         int     `json:"actual" gorm:"type:bigint"`
	TrialCharged   int     `json:"trial_charged" gorm:"type:bigint"`
	WalletCharged  int     `json:"wallet_charged" gorm:"type:bigint"`
	Waived         int     `json:"waived" gorm:"type:bigint"`
	CNYRate        float64 `json:"cny_rate"`
	QuotaUnit      float64 `json:"quota_unit"`
	// WaiveQuota is the waiver threshold in quota units, frozen when the request
	// reserved its trial credit. Rows created before this field existed keep 0,
	// which charges the full remainder.
	WaiveQuota int    `json:"waive_quota" gorm:"type:bigint;default:0"`
	Status     string `json:"status" gorm:"size:16;index"`
	CreatedAt  int64  `json:"created_at"`
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
	if err := migrateTrialCreditKinds(); err != nil {
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
		err = parseTrialConfig(option.Value, &cfg)
		return cfg, err
	}
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[TrialConfigKey]
	common.OptionMapRWMutex.RUnlock()
	if raw == "" {
		return cfg, nil
	}
	err := parseTrialConfig(raw, &cfg)
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
	_ = parseTrialConfig(raw, &cfg)
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

func GrantTrialCredit(userId, quota int, expiresAt int64, key, source string, actorId int, typeIds ...int) error {
	if userId <= 0 || quota <= 0 || quota > common.MaxWalletQuota || len(key) == 0 || len(key) > 128 || expiresAt < 0 || expiresAt > 0 && expiresAt <= time.Now().Unix() {
		return errors.New("体验金参数无效")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var cfg TrialCreditConfig
		if err = parseTrialConfig(option.Value, &cfg); err != nil {
			return err
		}
		kind, err := cfg.grantKind(typeIds...)
		if err != nil {
			return err
		}
		var user User
		if err = lockForUpdate(tx).First(&user, userId).Error; err != nil {
			return err
		}
		return grantTrialCreditTx(tx, userId, quota, expiresAt, key, source, actorId, kind)
	})
}

func grantTrialCreditTx(tx *gorm.DB, userId, quota int, expiresAt int64, key, source string, actorId int, kind TrialCreditType) error {
	if quota <= 0 || quota > common.MaxWalletQuota {
		return errors.New("体验金参数无效")
	}
	var existing TrialCreditGrant
	err := tx.Where("grant_key = ?", key).First(&existing).Error
	if err == nil {
		if existing.UserId != userId || existing.Quota != quota || existing.ExpiresAt != expiresAt || existing.Source != source || existing.ActorId != actorId || existing.TypeId != kind.Id || existing.GroupName != kind.Group {
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
	if err = tx.Model(&TrialCreditReservation{}).Where("user_id = ? AND status = ?", userId, "reserved").Select("COALESCE(SUM(reserved - wallet_reserved), 0)").Scan(&reserved).Error; err != nil {
		return err
	}
	if reserved > common.MaxWalletQuota-balance || quota > common.MaxWalletQuota-balance-reserved {
		return errors.New("体验金超过上限")
	}
	return tx.Create(&TrialCreditGrant{TypeId: kind.Id, GroupName: kind.Group, TypeName: kind.Name, UserId: userId, Quota: quota, Remaining: quota, ExpiresAt: expiresAt, GrantKey: key, Source: source, ActorId: actorId, CreatedAt: time.Now().Unix()}).Error
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
	cacheStale := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var cfg TrialCreditConfig
		if err = parseTrialConfig(option.Value, &cfg); err != nil {
			return err
		}
		if !cfg.Enabled || !cfg.HasTrialGroup(group) {
			return ErrTrialInsufficient
		}
		var user User
		if err = lockForUpdate(tx).First(&user, userId).Error; err != nil {
			return err
		}
		var r TrialCreditReservation
		err = tx.Where("request_id = ?", requestId).First(&r).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			balance, err := trialGroupBalance(tx, userId, group)
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
			r = TrialCreditReservation{RequestId: requestId, UserId: userId, GroupName: group, Status: "reserved", CNYRate: rate, QuotaUnit: common.QuotaPerUnit, WaiveQuota: cfg.waiveThresholdQuota(common.QuotaPerUnit, rate), CreatedAt: time.Now().Unix()}
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
		wallet := needed - used
		if wallet > max(user.Quota, 0) {
			return ErrTrialInsufficient
		}
		if wallet > 0 {
			if err := tx.Model(&user).UpdateColumn("quota", gorm.Expr("quota - ?", wallet)).Error; err != nil {
				return err
			}
			cacheStale = true
		}
		r.WalletReserved += wallet
		r.Reserved = target
		return tx.Save(&r).Error
	})
	if err == nil && cacheStale {
		invalidateTrialWalletCache(userId)
	}
	return err
}

// Trial transactions update the authoritative wallet directly. Drop the cached
// balance only after commit, including when a reservation is returned.
func invalidateTrialWalletCache(userId int) {
	if common.RedisEnabled {
		if err := invalidateUserCache(userId); err != nil {
			common.SysError(fmt.Sprintf("failed to invalidate user quota cache after trial wallet update: %s", err))
		}
	}
}

func allocateTrialCredit(tx *gorm.DB, r *TrialCreditReservation, amount int) (int, error) {
	var grants []TrialCreditGrant
	if err := trialGroupGrants(tx, r.UserId, r.GroupName).Find(&grants).Error; err != nil {
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
	var r TrialCreditReservation
	walletReturn := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := trialPolicyLock(tx); err != nil {
			return err
		}
		if err := tx.Where("request_id = ?", requestId).First(&r).Error; err != nil {
			return err
		}
		if r.Status != "reserved" || target < 0 || target > r.Reserved {
			return errors.New("体验金预留无效")
		}
		var user User
		if err := lockForUpdate(tx).First(&user, r.UserId).Error; err != nil {
			return err
		}
		walletReturn = min(r.WalletReserved, r.Reserved-target)
		if err := releaseTrialCredit(tx, &r, r.Reserved-target-walletReturn); err != nil {
			return err
		}
		if walletReturn > 0 {
			if err := tx.Model(&user).UpdateColumn("quota", gorm.Expr("quota + ?", walletReturn)).Error; err != nil {
				return err
			}
		}
		r.WalletReserved -= walletReturn
		r.Reserved = target
		return tx.Save(&r).Error
	})
	if err == nil && walletReturn > 0 {
		invalidateTrialWalletCache(r.UserId)
	}
	return err
}

// Finalize uses an absolute charge, not a delta, so a callback retry is harmless.
func FinalizeTrialCredit(requestId string, actual int, refund bool) (*TrialCreditReservation, error) {
	if actual < 0 || actual > math.MaxInt32 {
		return nil, errors.New("体验金费用无效")
	}
	var r TrialCreditReservation
	cacheStale := false
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
		available := r.Reserved - r.WalletReserved
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
		// Whatever trial credit could not cover is charged to the wallet exactly
		// like ordinary balance, so a large remainder becomes a real negative
		// balance the user settles by topping up. A remainder below the threshold
		// frozen at reservation time is waived instead, so a wallet emptied by a
		// trial request is not left with a token debt. An empty or already-negative
		// wallet covers nothing, so only a charge that is actually due is applied.
		debt := actual - r.TrialCharged
		charge := 0
		if debt > 0 {
			covered := min(debt, r.WalletReserved+max(user.Quota, 0))
			uncovered := debt - covered
			if uncovered == 0 || uncovered >= r.WaiveQuota {
				charge = debt
			} else {
				charge = covered
			}
		}
		walletDelta := charge - r.WalletReserved
		if walletDelta != 0 {
			if err := tx.Model(&user).UpdateColumn("quota", gorm.Expr("quota - ?", walletDelta)).Error; err != nil {
				return err
			}
			cacheStale = true
		}
		r.WalletCharged = charge
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
	if err != nil {
		return &r, err
	}
	if cacheStale {
		invalidateTrialWalletCache(r.UserId)
	}
	return &r, nil
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
		if err = parseTrialConfig(option.Value, &cfg); err != nil {
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
		kind, err := cfg.grantKind(cfg.AffiliateTypeId)
		if err != nil {
			return err
		}
		if err = grantTrialCreditTx(tx, inviterId, common.QuotaForInviter, expires, key, "affiliate", 0, kind); err != nil {
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
	if len(cfg.Types) == 0 {
		return nil
	}
	var groups map[string]float64
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return err
	}
	for _, kind := range cfg.Types {
		if _, ok := groups[kind.Group]; !ok {
			return errors.New("不能删除体验分组")
		}
	}
	return nil
}

func LinkTrialMidjourney(requestId string, taskId int) error {
	return DB.Model(&TrialCreditReservation{}).Where("request_id = ? AND status = ?", requestId, "reserved").Update("legacy_task_id", taskId).Error
}
func GetMidjourneyTrialReservation(taskId int) (*TrialCreditReservation, error) {
	if len(GetTrialCreditConfig().Types) == 0 {
		return nil, nil
	}
	var r TrialCreditReservation
	err := DB.Where("legacy_task_id = ?", taskId).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &r, err
}

// createWithRegistrationRewards is shared by password, OAuth and administrator creation.
// Binding failure rolls the account and all registration benefits back together.
func (user *User) createWithRegistrationRewards(tx *gorm.DB, inviterId int) error {
	signup := common.QuotaForNewUser
	invitee := 0
	if inviterId != 0 && operation_setting.IsPaymentComplianceConfirmed() {
		invitee = common.QuotaForInvitee
	}
	if signup < 0 || invitee < 0 || signup > common.MaxWalletQuota || invitee > common.MaxWalletQuota-signup {
		return errors.New("注册奖励金额无效")
	}
	var cfg TrialCreditConfig
	if signup > 0 || invitee > 0 {
		if trialCreditDatabase.Load() == DB {
			option, err := trialPolicyLock(tx)
			if err != nil {
				return err
			}
			if err = parseTrialConfig(option.Value, &cfg); err != nil {
				return err
			}
		} else {
			var err error
			cfg, err = ReadTrialCreditConfig()
			if err != nil {
				return err
			}
		}
	}
	trial := cfg.Enabled && cfg.Affiliate
	user.Quota = signup + invitee
	var kind TrialCreditType
	if trial {
		var err error
		kind, err = cfg.grantKind(cfg.AffiliateTypeId)
		if err != nil {
			return err
		}
		user.Quota = 0
	}
	if err := tx.Create(user).Error; err != nil {
		return err
	}
	if !trial {
		return nil
	}
	expires := int64(0)
	if cfg.AffiliateDays > 0 {
		expires = time.Now().Unix() + int64(cfg.AffiliateDays)*86400
	}
	for _, reward := range []struct {
		source string
		quota  int
	}{{"signup", signup}, {"invitee", invitee}} {
		if reward.quota <= 0 {
			continue
		}
		key := fmt.Sprintf("%s:%d", reward.source, user.Id)
		if err := grantTrialCreditTx(tx, user.Id, reward.quota, expires, key, reward.source, 0, kind); err != nil {
			return err
		}
	}
	return nil
}

func recordRegistrationReward(userId int, source string, quota int) {
	if trialCreditDatabase.Load() == DB {
		var grant TrialCreditGrant
		if err := DB.Where("grant_key = ? AND user_id = ?", fmt.Sprintf("%s:%d", source, userId), userId).Find(&grant).Error; err == nil && grant.Id != 0 {
			message := "Sign-up trial credit {{quota}}: {{name}} ({{group}})"
			if source == "invitee" {
				message = "Invitation trial credit {{quota}}: {{name}} ({{group}})"
			}
			RecordLog(userId, LogTypeSystem, common.NewMessage(message, map[string]any{"quota": logger.FormatQuota(grant.Quota), "name": grant.TypeName, "group": grant.GroupName}))
			return
		}
	}
	message := "New user sign-up bonus {{quota}}"
	if source == "invitee" {
		message = "Invitation code bonus {{quota}}"
	}
	RecordLog(userId, LogTypeSystem, common.NewMessage(message, map[string]any{"quota": logger.FormatQuota(quota)}))
}
