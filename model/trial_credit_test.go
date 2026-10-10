package model

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestTrialCreditAccounting(t *testing.T) {
	engines := []struct{ name, dsn string }{{"sqlite", ":memory:"}, {"mysql", os.Getenv("TRIAL_MYSQL_DSN")}, {"postgres", os.Getenv("TRIAL_POSTGRES_DSN")}}
	for _, engine := range engines {
		t.Run(engine.name, func(t *testing.T) {
			if engine.dsn == "" {
				t.Skip("database DSN not configured")
			}
			var dialect gorm.Dialector
			switch engine.name {
			case "mysql":
				dialect = mysql.Open(engine.dsn)
			case "postgres":
				dialect = postgres.Open(engine.dsn)
			default:
				dialect = sqlite.Open(engine.dsn)
			}
			db, err := gorm.Open(dialect, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			oldDB, oldReady := DB, trialCreditDatabase.Load()
			oldGroup, oldKey := commonGroupCol, commonKeyCol
			oldRedis, oldBatch := common.RedisEnabled, common.BatchUpdateEnabled
			oldUnit, oldRate := common.QuotaPerUnit, operation_setting.USDExchangeRate
			oldMap := common.OptionMap
			common.OptionMap = map[string]string{}
			oldType := common.MainDatabaseType()
			common.SetMainDatabaseType(common.DatabaseType(engine.name))
			oldCfg := GetTrialCreditConfig()
			DB = db
			common.RedisEnabled = false
			common.BatchUpdateEnabled = false
			common.QuotaPerUnit = 1000
			operation_setting.USDExchangeRate = 1
			commonKeyCol = "`key`"
			commonGroupCol = "`group`"
			if engine.name == "postgres" {
				commonKeyCol = `"key"`
				commonGroupCol = `"group"`
			}
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if engine.name == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() {
				DB = oldDB
				trialCreditDatabase.Store(oldReady)
				commonGroupCol, commonKeyCol = oldGroup, oldKey
				common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
				common.QuotaPerUnit, operation_setting.USDExchangeRate = oldUnit, oldRate
				raw, _ := common.Marshal(oldCfg)
				_ = updateOptionMap(TrialConfigKey, string(raw))
				common.OptionMap = oldMap
				common.SetMainDatabaseType(oldType)
				_ = sqlDB.Close()
			})
			// Dedicated throwaway databases only. Exercise the legacy tables before additive migration.
			require.NoError(t, db.Migrator().DropTable(&TrialCreditAllocation{}, &TrialCreditReservation{}, &TrialCreditGrant{}, &Option{}, &User{}))
			require.NoError(t, db.AutoMigrate(&User{}, &Option{}))
			user := User{Username: "trial-owner", Quota: 10000, AffCode: "trial-owner", Group: "default"}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, MigrateTrialCredit())
			require.NoError(t, MigrateTrialCredit())
			require.NoError(t, db.Migrator().DropTable(&TrialCreditAllocation{}, &TrialCreditReservation{}, &TrialCreditGrant{}))
			require.NoError(t, db.Where(map[string]any{"key": TrialConfigKey}).Delete(&Option{}).Error)
			// Upgrade an actual pre-kind grant table and verify a second migration preserves ownership.
			require.NoError(t, db.AutoMigrate(&legacyTrialCreditGrant{}))
			legacyUser := User{Username: "trial-legacy", AffCode: "trial-legacy"}
			require.NoError(t, db.Create(&legacyUser).Error)
			require.NoError(t, db.Create(&Option{Key: TrialConfigKey, Value: `{"enabled":false,"group":"default"}`}).Error)
			require.NoError(t, db.Create(&legacyTrialCreditGrant{UserId: legacyUser.Id, GrantKey: "legacy-grant", Quota: 321, Remaining: 123, Source: "admin"}).Error)
			require.NoError(t, MigrateTrialCredit())
			require.NoError(t, MigrateTrialCredit())
			var migrated TrialCreditGrant
			require.NoError(t, db.Where("grant_key = ?", "legacy-grant").First(&migrated).Error)
			assert.Equal(t, 1, migrated.TypeId)
			assert.Equal(t, "default", migrated.GroupName)
			assert.Equal(t, 321, migrated.Quota)
			assert.Equal(t, 123, migrated.Remaining)
			var preserved User
			require.NoError(t, db.First(&preserved, user.Id).Error)
			assert.Equal(t, 10000, preserved.Quota)
			require.NoError(t, UpdateTrialCreditConfig(TrialCreditConfig{Enabled: true, Group: "default", Affiliate: true, AffiliateDays: 7}))
			for _, tc := range []struct {
				name               string
				debt, wallet, want int
			}{{"small", 600, 1000, 0}, {"threshold", 1000, 1000, 0}, {"over", 1500, 1000, 100}, {"insufficient", 1500, 99, 0}} {
				t.Run(tc.name, func(t *testing.T) {
					u := User{Username: "trial-" + tc.name, Quota: tc.wallet, AffCode: "trial-" + tc.name}
					require.NoError(t, db.Create(&u).Error)
					require.NoError(t, GrantTrialCredit(u.Id, 2000, 0, tc.name, "admin", 1))
					require.NoError(t, GrantTrialCredit(u.Id, 2000, 0, tc.name, "admin", 1))
					require.NoError(t, ReserveTrialCredit(tc.name, u.Id, "default", 2000))
					require.ErrorIs(t, ReserveTrialCredit(tc.name+"-empty", u.Id, "default", 0), ErrTrialInsufficient)
					r, err := FinalizeTrialCredit(tc.name, 2000+tc.debt, false)
					require.NoError(t, err)
					assert.Equal(t, tc.want, r.WalletCharged)
					assert.Equal(t, tc.debt-tc.want, r.Waived)
					again, err := FinalizeTrialCredit(tc.name, 2000+tc.debt, false)
					require.NoError(t, err)
					assert.False(t, again.Applied)
					r.Applied = false
					assert.Equal(t, r, again)
					_, err = FinalizeTrialCredit(tc.name, 0, true)
					require.NoError(t, err)
					require.NoError(t, db.First(&u, u.Id).Error)
					assert.Equal(t, tc.wallet-tc.want, u.Quota)
					balance, err := GetTrialCreditBalance(u.Id)
					require.NoError(t, err)
					assert.Zero(t, balance)
				})
			}
			t.Run("expiry and refund", func(t *testing.T) {
				require.NoError(t, GrantTrialCredit(user.Id, 100, 0, "permanent", "admin", 1))
				require.NoError(t, GrantTrialCredit(user.Id, 60, time.Now().Unix()+100, "expiring", "admin", 1))
				require.NoError(t, ReserveTrialCredit("expiry", user.Id, "default", 80))
				var exp TrialCreditGrant
				require.NoError(t, db.Where("grant_key = ?", "expiring").First(&exp).Error)
				assert.Zero(t, exp.Remaining)
				require.NoError(t, db.Model(&exp).Update("expires_at", time.Now().Unix()-1).Error)
				_, err := FinalizeTrialCredit("expiry", 0, true)
				require.NoError(t, err)
				balance, err := GetTrialCreditBalance(user.Id)
				require.NoError(t, err)
				assert.Equal(t, 100, balance)
				require.NoError(t, ReserveTrialCredit("release", user.Id, "default", 90))
				require.NoError(t, ReleaseTrialCreditReserve("release", 40))
				balance, err = GetTrialCreditBalance(user.Id)
				require.NoError(t, err)
				assert.Equal(t, 60, balance)
				_, err = FinalizeTrialCredit("release", 40, false)
				require.NoError(t, err)
			})
			t.Run("isolation concurrency config", func(t *testing.T) {
				u := User{Username: "concurrent", AffCode: "concurrent"}
				require.NoError(t, db.Create(&u).Error)
				require.NoError(t, GrantTrialCredit(u.Id, 100, 0, "concurrent", "admin", 1))
				require.ErrorIs(t, ReserveTrialCredit("wrong", u.Id, "vip", 10), ErrTrialInsufficient)
				results := make(chan error, 2)
				var wg sync.WaitGroup
				for i := range 2 {
					wg.Go(func() {
						results <- ReserveTrialCredit(fmt.Sprintf("parallel-%d", i), u.Id, "default", 80)
					})
				}
				wg.Wait()
				close(results)
				success := 0
				for err := range results {
					if err == nil {
						success++
					} else {
						assert.ErrorIs(t, err, ErrTrialInsufficient)
					}
				}
				assert.Equal(t, 1, success)
				require.Error(t, UpdateTrialCreditConfig(TrialCreditConfig{Enabled: true, Group: "vip"}))
				require.Error(t, UpdateTrialCreditConfig(TrialCreditConfig{}))
				require.Error(t, UpdateOption("GroupRatio", `{"vip":1}`))
			})
			t.Run("failed reserve and frozen currency", func(t *testing.T) {
				u := User{Username: "trial-freeze", Quota: 1000, AffCode: "trial-freeze"}
				require.NoError(t, db.Create(&u).Error)
				require.NoError(t, GrantTrialCredit(u.Id, 2000, 0, "freeze", "admin", 1))
				require.ErrorIs(t, ReserveTrialCredit("failed-reserve", u.Id, "default", 2001), ErrTrialInsufficient)
				balance, err := GetTrialCreditBalance(u.Id)
				require.NoError(t, err)
				assert.Equal(t, 2000, balance)
				require.NoError(t, ReserveTrialCredit("frozen-rate", u.Id, "default", 2000))
				operation_setting.USDExchangeRate = 2
				r, err := FinalizeTrialCredit("frozen-rate", 3500, false)
				require.NoError(t, err)
				assert.Equal(t, 100, r.WalletCharged)
				operation_setting.USDExchangeRate = 1
			})
			t.Run("wallet cache controls waiver", func(t *testing.T) {
				if engine.name != "sqlite" {
					return
				}
				useUserCacheMiniRedis(t)
				u := User{Username: "trial-cache", Quota: 1000, AffCode: "trial-cache"}
				require.NoError(t, db.Create(&u).Error)
				require.NoError(t, populateUserCache(u))
				require.NoError(t, cacheDecrUserQuota(u.Id, 950))
				require.NoError(t, GrantTrialCredit(u.Id, 2000, 0, "cache", "admin", 1))
				require.NoError(t, ReserveTrialCredit("cache", u.Id, "default", 2000))
				r, err := FinalizeTrialCredit("cache", 3500, false)
				require.NoError(t, err)
				assert.Zero(t, r.WalletCharged)
				cached, err := getUserQuotaCache(u.Id)
				require.NoError(t, err)
				assert.Equal(t, 50, cached)
			})
			t.Run("affiliate idempotency", func(t *testing.T) {
				oldReward := common.QuotaForInviter
				common.QuotaForInviter = 500
				t.Cleanup(func() { common.QuotaForInviter = oldReward })
				handled, err := AwardTrialAffiliate(user.Id, 1234)
				require.NoError(t, err)
				require.True(t, handled)
				_, err = AwardTrialAffiliate(user.Id, 1234)
				require.NoError(t, err)
				require.NoError(t, db.First(&user, user.Id).Error)
				assert.Equal(t, 1, user.AffCount)
				assert.Zero(t, user.AffQuota)
				assert.Equal(t, 500, user.AffHistoryQuota)
				var grant TrialCreditGrant
				require.NoError(t, db.Where("grant_key = ?", "affiliate:1234").First(&grant).Error)
				assert.InDelta(t, time.Now().Unix()+7*86400, grant.ExpiresAt, 2)
			})
			t.Run("multiple kinds can be configured independently", func(t *testing.T) {
				var cfg TrialCreditConfig
				require.NoError(t, common.UnmarshalJsonStr(`{"enabled":true,"affiliate":true,"affiliate_type_id":1,"types":[{"id":1,"name":"Ds credit","group":"default","enabled":true},{"id":0,"name":"Gpt credit","group":"vip","enabled":true}]}`, &cfg))
				require.NoError(t, UpdateTrialCreditConfig(cfg))
				cfg, err := ReadTrialCreditConfig()
				require.NoError(t, err)
				require.Len(t, cfg.Types, 2)
				assert.Equal(t, 2, cfg.Types[1].Id)
				u := User{Username: "multi-credit", AffCode: "multi-credit", Quota: 1000}
				require.NoError(t, db.Create(&u).Error)
				require.Error(t, GrantTrialCredit(u.Id, 100, 0, "ambiguous", "admin", 1))
				require.Error(t, GrantTrialCredit(u.Id, 100, 0, "unknown", "admin", 1, 99))
				require.NoError(t, GrantTrialCredit(u.Id, 100, 0, "kind-ds", "admin", 1, 1))
				require.NoError(t, GrantTrialCredit(u.Id, 300, 0, "kind-gpt", "admin", 1, 2))
				require.Error(t, GrantTrialCredit(u.Id, 100, 0, "kind-ds", "admin", 1, 2))
				balances, err := GetTrialCreditTypeBalances(u.Id)
				require.NoError(t, err)
				require.Len(t, balances, 2)
				require.Error(t, GrantTrialCredit(u.Id, common.MaxWalletQuota, 0, "multi-overflow", "admin", 1, 2))
				assert.Equal(t, 100, balances[0].Balance)
				assert.Equal(t, 300, balances[1].Balance)
				require.ErrorIs(t, ReserveTrialCredit("no-cross-kind", u.Id, "default", 101), ErrTrialInsufficient)
				require.NoError(t, ReserveTrialCredit("consume-ds", u.Id, "default", 80))
				_, err = FinalizeTrialCredit("consume-ds", 150, false)
				require.NoError(t, err)
				balance, err := GetTrialCreditGroupBalance(u.Id, "vip")
				require.NoError(t, err)
				assert.Equal(t, 300, balance)
				require.NoError(t, ReserveTrialCredit("refund-gpt", u.Id, "vip", 100))
				_, err = FinalizeTrialCredit("refund-gpt", 0, true)
				require.NoError(t, err)
				balance, err = GetTrialCreditGroupBalance(u.Id, "vip")
				require.NoError(t, err)
				assert.Equal(t, 300, balance)
				require.NoError(t, db.First(&u, u.Id).Error)
				assert.Equal(t, 1000, u.Quota)
				// Concurrent requests use only the selected pool; finalization remains idempotent.
				results := make(chan error, 2)
				var wg sync.WaitGroup
				for i := range 2 {
					wg.Go(func() { results <- ReserveTrialCredit(fmt.Sprintf("multi-parallel-%d", i), u.Id, "vip", 200) })
				}
				wg.Wait()
				close(results)
				success := 0
				for err := range results {
					if err == nil {
						success++
					} else {
						assert.ErrorIs(t, err, ErrTrialInsufficient)
					}
				}
				assert.Equal(t, 1, success)
				balance, err = GetTrialCreditGroupBalance(u.Id, "default")
				require.NoError(t, err)
				assert.Zero(t, balance)
				// A chosen invitation kind remains independent from the first kind.
				cfg.AffiliateTypeId = 2
				cfg.AffiliateDays = 7
				require.NoError(t, UpdateTrialCreditConfig(cfg))
				oldReward := common.QuotaForInviter
				common.QuotaForInviter = 42
				t.Cleanup(func() { common.QuotaForInviter = oldReward })
				for range 2 {
					handled, err := AwardTrialAffiliate(u.Id, 8888)
					require.NoError(t, err)
					require.True(t, handled)
				}
				var reward TrialCreditGrant
				require.NoError(t, db.Where("grant_key = ?", "affiliate:8888").First(&reward).Error)
				assert.Equal(t, 2, reward.TypeId)
				assert.Equal(t, "vip", reward.GroupName)
				assert.Equal(t, 42, reward.Quota)
				require.InDelta(t, time.Now().Unix()+7*86400, reward.ExpiresAt, 2)
				// Kind IDs cannot disappear or be redirected after issuance, including generic option updates.
				bad := cfg
				bad.Types = append([]TrialCreditType{}, cfg.Types...)
				bad.Types[1].Group = "another"
				raw, _ := common.Marshal(bad)
				require.Error(t, UpdateOption(TrialConfigKey, string(raw)))
				bad = cfg
				bad.Types = bad.Types[:1]
				require.Error(t, UpdateTrialCreditConfig(bad))
				require.Error(t, UpdateOption("GroupRatio", `{"default":1}`))
				cfg.Affiliate = false
				cfg.Types[1].Enabled = false
				require.NoError(t, UpdateTrialCreditConfig(cfg))
				require.Error(t, GrantTrialCredit(u.Id, 10, 0, "disabled-kind", "admin", 1, 2))
				require.NoError(t, ReserveTrialCredit("disabled-issued", u.Id, "vip", 10))
				_, err = FinalizeTrialCredit("disabled-issued", 0, true)
				require.NoError(t, err)
				require.NoError(t, MigrateTrialCredit())
				require.NoError(t, MigrateTrialCredit())
				reward = TrialCreditGrant{}
				require.NoError(t, db.Where("grant_key = ?", "kind-gpt").First(&reward).Error)
				assert.Equal(t, 2, reward.TypeId)
				assert.Equal(t, "vip", reward.GroupName)
				// Kinds may share a group while retaining separate balances and IDs.
				cfg.Types = append(cfg.Types, TrialCreditType{Name: "Other Ds credit", Group: "default", Enabled: true})
				require.NoError(t, UpdateTrialCreditConfig(cfg))
				cfg = GetTrialCreditConfig()
				require.Len(t, cfg.Types, 3)
				assert.Equal(t, 3, cfg.Types[2].Id)
				require.NoError(t, GrantTrialCredit(u.Id, 5, 0, "same-group-kind", "admin", 1, 3))
				balance, err = GetTrialCreditGroupBalance(u.Id, "default")
				require.NoError(t, err)
				assert.Equal(t, 5, balance)
				// Renaming does not duplicate the balance row.
				cfg.Types[2].Name = "Renamed Ds credit"
				require.NoError(t, UpdateTrialCreditConfig(cfg))
				require.NoError(t, GrantTrialCredit(u.Id, 7, 0, "renamed-kind", "admin", 1, 3))
				balances, err = GetTrialCreditTypeBalances(u.Id)
				require.NoError(t, err)
				found := 0
				for _, item := range balances {
					if item.TypeId == 3 {
						found++
						assert.Equal(t, 12, item.Balance)
					}
				}
				assert.Equal(t, 1, found)
			})
			require.NoError(t, MigrateTrialCredit())
		})
	}
}

type legacyTrialCreditGrant struct {
	Id        int `gorm:"primaryKey"`
	UserId    int
	GrantKey  string `gorm:"size:128;uniqueIndex"`
	Quota     int    `gorm:"type:bigint"`
	Remaining int    `gorm:"type:bigint"`
	ExpiresAt int64
	CreatedAt int64
	Source    string `gorm:"size:24"`
	ActorId   int
}

func (legacyTrialCreditGrant) TableName() string { return "trial_credit_grants" }
