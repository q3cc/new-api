package model

import (
	"errors"
	"math"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
)

// IDs are assigned under the policy lock and never reused. Retire a kind by disabling issuance.
type TrialCreditType struct {
	Id      int    `json:"id"`
	Name    string `json:"name"`
	Group   string `json:"group"`
	Enabled bool   `json:"enabled"`
}

func parseTrialConfig(raw string, cfg *TrialCreditConfig) error {
	if err := common.UnmarshalJsonStr(raw, cfg); err != nil {
		return err
	}
	cfg.normalize()
	return nil
}
func (cfg *TrialCreditConfig) normalize() {
	if cfg.Types == nil && cfg.Group != "" {
		cfg.Types = []TrialCreditType{{Id: 1, Name: "Trial credit", Group: cfg.Group, Enabled: true}}
	}
	if cfg.Types == nil {
		cfg.Types = []TrialCreditType{}
	}
	if len(cfg.Types) > 0 {
		cfg.Group = cfg.Types[0].Group
	} else {
		cfg.Group = ""
	}
	if cfg.Affiliate && cfg.AffiliateTypeId == 0 && len(cfg.Types) == 1 {
		cfg.AffiliateTypeId = cfg.Types[0].Id
	}
}
func (cfg TrialCreditConfig) HasTrialGroup(group string) bool {
	cfg.normalize()
	for _, kind := range cfg.Types {
		if kind.Group == group {
			return true
		}
	}
	return false
}
func (cfg TrialCreditConfig) grantKind(typeIds ...int) (TrialCreditType, error) {
	cfg.normalize()
	id := 0
	if len(typeIds) > 0 {
		id = typeIds[0]
	}
	if id == 0 && len(cfg.Types) == 1 {
		id = cfg.Types[0].Id
	}
	if cfg.Enabled {
		for _, kind := range cfg.Types {
			if kind.Id == id && kind.Enabled {
				return kind, nil
			}
		}
	}
	return TrialCreditType{}, errors.New("请选择已启用的体验金种类")
}
func validateTrialConfig(cfg TrialCreditConfig) error {
	if cfg.AffiliateDays < 0 || cfg.AffiliateDays > 36500 || len(cfg.Types) > 100 {
		return errors.New("体验金参数无效")
	}
	if cfg.WaiveThreshold != nil {
		threshold := *cfg.WaiveThreshold
		if math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 || threshold > maxWaiveThreshold {
			return errors.New("体验金免除门槛无效")
		}
	}
	ids := map[int]bool{}
	for _, kind := range cfg.Types {
		if kind.Id <= 0 || ids[kind.Id] || kind.Name == "" || len(kind.Name) > 128 || len(kind.Group) > 64 || kind.Group == "" || kind.Group == "auto" || !ratio_setting.ContainsGroupRatio(kind.Group) {
			return errors.New("体验金种类、名称或分组无效")
		}
		ids[kind.Id] = true
	}
	if cfg.Enabled && len(cfg.Types) == 0 {
		return errors.New("请添加体验金种类")
	}
	if cfg.Affiliate {
		if _, err := cfg.grantKind(cfg.AffiliateTypeId); err != nil {
			return err
		}
	}
	return nil
}
func UpdateTrialCreditConfig(cfg TrialCreditConfig) error {
	legacy := cfg.Types == nil
	cfg.Group = strings.TrimSpace(cfg.Group)
	cfg.normalize()
	var raw []byte
	err := DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var old TrialCreditConfig
		if err = parseTrialConfig(option.Value, &old); err != nil {
			return err
		}
		oldKinds := map[int]TrialCreditType{}
		nextId := 1
		for _, kind := range old.Types {
			oldKinds[kind.Id] = kind
			if kind.Id >= nextId {
				nextId = kind.Id + 1
			}
		}
		if legacy && len(old.Types) > 1 {
			return errors.New("请保留所有体验金种类")
		}
		seen := map[int]bool{}
		for i := range cfg.Types {
			kind := &cfg.Types[i]
			kind.Name = strings.TrimSpace(kind.Name)
			kind.Group = strings.TrimSpace(kind.Group)
			if kind.Id == 0 {
				kind.Id = nextId
				nextId++
			} else if _, ok := oldKinds[kind.Id]; !ok && !(legacy && len(oldKinds) == 0 && kind.Id == 1) {
				return errors.New("体验金种类编号无效")
			}
			seen[kind.Id] = true
		}
		cfg.normalize()
		if err = validateTrialConfig(cfg); err != nil {
			return err
		}
		for id, prior := range oldKinds {
			if !seen[id] {
				return errors.New("体验金种类不能删除，请停用发放")
			}
			for _, kind := range cfg.Types {
				if kind.Id == id && kind.Group != prior.Group {
					var count int64
					if err = tx.Model(&TrialCreditGrant{}).Where("type_id = ? OR type_id = 0", id).Count(&count).Error; err != nil {
						return err
					}
					if count > 0 {
						return errors.New("已发放体验金的分组不能修改")
					}
					if err = tx.Model(&TrialCreditReservation{}).Where("group_name = ? AND status = ?", prior.Group, "reserved").Count(&count).Error; err != nil {
						return err
					}
					if count > 0 {
						return errors.New("仍有未完成请求")
					}
				}
			}
		}
		if old.Enabled && !cfg.Enabled {
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
		raw, err = common.Marshal(cfg)
		if err != nil {
			return err
		}
		return tx.Model(option).Update("value", string(raw)).Error
	})
	if err != nil {
		return err
	}
	return updateOptionMap(TrialConfigKey, string(raw))
}
func migrateTrialCreditKinds() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		option, err := trialPolicyLock(tx)
		if err != nil {
			return err
		}
		var cfg TrialCreditConfig
		if err = parseTrialConfig(option.Value, &cfg); err != nil {
			return err
		}
		if len(cfg.Types) > 0 {
			kind := cfg.Types[0]
			if err = tx.Model(&TrialCreditGrant{}).Where("type_id = 0").Updates(map[string]any{"type_id": kind.Id, "group_name": kind.Group, "type_name": kind.Name}).Error; err != nil {
				return err
			}
		} else {
			var count int64
			if err = tx.Model(&TrialCreditGrant{}).Where("type_id = 0").Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("历史体验金缺少分组，无法迁移")
			}
		}
		raw, err := common.Marshal(cfg)
		if err != nil {
			return err
		}
		return tx.Model(option).Update("value", string(raw)).Error
	})
}

func trialGroupGrants(tx *gorm.DB, userId int, group string) *gorm.DB {
	query := tx.Model(&TrialCreditGrant{}).Where("user_id = ? AND remaining > 0 AND (expires_at = 0 OR expires_at > ?)", userId, time.Now().Unix())
	return query.Where("group_name = ?", group)
}
func trialGroupBalance(tx *gorm.DB, userId int, group string) (int, error) {
	var balance int
	err := trialGroupGrants(tx, userId, group).Select("COALESCE(SUM(remaining), 0)").Scan(&balance).Error
	return balance, err
}
func GetTrialCreditGroupBalance(userId int, group string) (int, error) {
	return trialGroupBalance(DB, userId, group)
}

type TrialCreditTypeBalance struct {
	TypeId  int    `json:"type_id"`
	Name    string `json:"name" gorm:"column:type_name"`
	Group   string `json:"group" gorm:"column:group_name"`
	Balance int    `json:"balance"`
}

func GetTrialCreditTypeBalances(userId int) ([]TrialCreditTypeBalance, error) {
	balances := []TrialCreditTypeBalance{}
	err := DB.Model(&TrialCreditGrant{}).Where("user_id = ? AND remaining > 0 AND (expires_at = 0 OR expires_at > ?)", userId, time.Now().Unix()).Select("type_id, MAX(type_name) AS type_name, group_name, SUM(remaining) AS balance").Group("type_id, group_name").Order("type_id ASC").Scan(&balances).Error
	return balances, err
}
