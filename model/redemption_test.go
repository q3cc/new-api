package model

import (
	"bytes"
	gormlogger "gorm.io/gorm/logger"
	"os"
	"path/filepath"
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
)

func TestSearchRedemptionsFiltersAndPaginates(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	now := common.GetTimestamp()
	redemptions := []Redemption{
		{Id: 1, Name: "alpha-active", Key: "00000000000000000000000000000001", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: 0},
		{Id: 2, Name: "alpha-future", Key: "00000000000000000000000000000002", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now + 3600},
		{Id: 3, Name: "alpha-expired", Key: "00000000000000000000000000000003", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now - 10},
		{Id: 4, Name: "beta-disabled", Key: "00000000000000000000000000000004", Status: common.RedemptionCodeStatusDisabled, ExpiredTime: 0},
		{Id: 5, Name: "beta-used", Key: "00000000000000000000000000000005", Status: common.RedemptionCodeStatusUsed, ExpiredTime: 0},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	tests := []struct {
		name      string
		keyword   string
		status    string
		startIdx  int
		num       int
		wantTotal int64
		wantIds   []int
	}{
		{
			name:      "no filters returns all rows",
			num:       10,
			wantTotal: 5,
			wantIds:   []int{5, 4, 3, 2, 1},
		},
		{
			name:      "keyword filters by name prefix",
			keyword:   "alpha",
			num:       10,
			wantTotal: 3,
			wantIds:   []int{3, 2, 1},
		},
		{
			name:      "enabled status excludes expired rows",
			status:    "1",
			num:       10,
			wantTotal: 2,
			wantIds:   []int{2, 1},
		},
		{
			name:      "expired status returns enabled expired rows",
			status:    "expired",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{3},
		},
		{
			name:      "disabled status",
			status:    "2",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{4},
		},
		{
			name:      "used status",
			status:    "3",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{5},
		},
		{
			name:      "pagination keeps unpaged total",
			startIdx:  1,
			num:       2,
			wantTotal: 5,
			wantIds:   []int{4, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, total, err := SearchRedemptions(tt.keyword, tt.status, tt.startIdx, tt.num)
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, total)
			gotIds := make([]int, 0, len(rows))
			for _, row := range rows {
				gotIds = append(gotIds, row.Id)
			}
			assert.Equal(t, tt.wantIds, gotIds)
		})
	}
}

func setupRedeemFixture(t *testing.T, quota int) (userId int, key string) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	user := &User{Username: "redeem-user", Password: "password", Status: common.UserStatusEnabled, Quota: 0}
	require.NoError(t, DB.Create(user).Error)

	key = "10000000000000000000000000000001"
	redemption := &Redemption{
		Name:        "redeem-test",
		Key:         key,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       quota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(redemption).Error)
	return user.Id, key
}

func TestRedeemCreditsQuotaExactlyOnce(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "name = ?", "redeem-test").Error)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, userId, redemption.UsedUserId)

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

func TestRedeemRejectsWalletOverflow(t *testing.T) {
	userId, key := setupRedeemFixture(t, 11)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("quota", common.MaxWalletQuota-10).Error)

	_, err := Redeem(key, userId)
	require.ErrorIs(t, err, ErrRedeemFailed)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, common.MaxWalletQuota-10, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "key = ?", key).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, redemption.Status)
}

func TestRedemptionQuotaRejectsWalletOverflow(t *testing.T) {
	setupRedeemFixture(t, 500)

	redemption := &Redemption{
		Name:        "overflow-redemption",
		Key:         "10000000000000000000000000000002",
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       common.MaxWalletQuota + 1,
		CreatedTime: common.GetTimestamp(),
	}
	require.Error(t, redemption.Insert())
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(key, userId); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, ok := range successes {
		if ok {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount, "exactly one concurrent redeem should succeed")

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 300, user.Quota, "quota must be credited exactly once")
}

func TestRedeemSubscriptionDoesNotCreditWallet(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)
	require.NoError(t, DB.AutoMigrate(&SubscriptionPlan{}, &UserSubscription{}))
	plan := &SubscriptionPlan{Title: "Monthly code", DurationUnit: "month", DurationValue: 1, TotalAmount: 1500, Enabled: true}
	require.NoError(t, DB.Create(plan).Error)
	t.Cleanup(func() {
		DB.Where("user_id = ?", userId).Delete(&UserSubscription{})
		DB.Delete(plan)
	})
	var code Redemption
	require.NoError(t, DB.Where("key = ?", key).First(&code).Error)
	payload, err := common.Marshal(map[string]any{"redemption_type": "subscription", "plan_id": plan.Id, "quota": 0})
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(payload, &code))
	require.NoError(t, DB.Save(&code).Error)
	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Zero(t, quota)
	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	assert.Zero(t, user.Quota)
	var subscriptions []UserSubscription
	require.NoError(t, DB.Where("user_id = ?", userId).Find(&subscriptions).Error)
	require.Len(t, subscriptions, 1)
	assert.Equal(t, "redemption", subscriptions[0].Source)
	assert.EqualValues(t, 1500, subscriptions[0].AmountTotal)
}

// The prior release schema has no redemption_type or plan_id columns.
type legacySubscriptionRedemption struct {
	Id           int `gorm:"primaryKey"`
	UserId       int
	Key          string `gorm:"type:char(32);uniqueIndex"`
	Status       int    `gorm:"default:1"`
	Name         string `gorm:"index"`
	Quota        int    `gorm:"default:100"`
	CreatedTime  int64  `gorm:"bigint"`
	RedeemedTime int64  `gorm:"bigint"`
	UsedUserId   int
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `gorm:"bigint"`
}

func (legacySubscriptionRedemption) TableName() string { return "redemptions" }

func TestSubscriptionRedemptionDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "redemption.db"))
			case "mysql":
				dsn := os.Getenv("TEST_REDEMPTION_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_REDEMPTION_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_REDEMPTION_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_REDEMPTION_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			oldDB, oldLogDB := DB, LOG_DB
			oldTrial := trialCreditDatabase.Load()
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			oldMethods := operation_setting.PayMethods2JsonString()
			common.OptionMapRWMutex.Lock()
			oldOptions := common.OptionMap
			common.OptionMap = make(map[string]string)
			common.OptionMapRWMutex.Unlock()
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				_ = getSubscriptionPlanCache().Purge()
				resetEpayMatrixDatabase(t, db)
				DB, LOG_DB = oldDB, oldLogDB
				trialCreditDatabase.Store(oldTrial)
				common.SetDatabaseTypes(oldMain, oldLog)
				initCol()
				common.OptionMapRWMutex.Lock()
				common.OptionMap = oldOptions
				common.OptionMapRWMutex.Unlock()
				require.NoError(t, operation_setting.UpdatePayMethodsByJsonString(oldMethods))
				require.NoError(t, sqlDB.Close())
			})
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			resetEpayMatrixDatabase(t, db)
			require.NoError(t, db.AutoMigrate(&legacySubscriptionRedemption{}))
			legacy := []legacySubscriptionRedemption{
				{Name: "legacy", Key: "legacy-balance", Quota: 1234, Status: 1},
				{Name: "used", Key: "legacy-used", Quota: 987, Status: 3, UsedUserId: 10, RedeemedTime: 123},
			}
			require.NoError(t, db.Create(&legacy).Error)
			for range 2 {
				require.NoError(t, migrateDB())
			}
			var codes []Redemption
			require.NoError(t, db.Order("id").Find(&codes).Error)
			require.Len(t, codes, 2)
			assert.Equal(t, RedemptionTypeBalance, codes[0].RedemptionType)
			assert.Equal(t, 1234, codes[0].Quota)
			assert.Equal(t, 3, codes[1].Status)
			assert.EqualValues(t, 123, codes[1].RedeemedTime)
			assert.Equal(t, 10, codes[1].UsedUserId)
			assert.Error(t, db.Create(&Redemption{Name: "duplicate", Key: "legacy-balance", Quota: 1}).Error)
			user := &User{Username: "matrix-code-user", Quota: 2000000, Group: "default", AffCode: "matrix-code", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(user).Error)
			result, err := RedeemWithResult("legacy-balance", user.Id)
			require.NoError(t, err)
			assert.Equal(t, 1234, result.Quota)
			assert.Equal(t, RedemptionTypeBalance, result.Type)
			codes[1].Status = 1
			assert.Error(t, codes[1].Update(true))

			plan := &SubscriptionPlan{Title: "Monthly", DurationUnit: "month", DurationValue: 1, TotalAmount: 1000, QuotaResetPeriod: "monthly", Enabled: true, UpgradeGroup: "pro", PriceAmount: 1}
			require.NoError(t, db.Create(plan).Error)
			_, err = GetSubscriptionPlanById(plan.Id) // Seed cache with old settings.
			require.NoError(t, err)
			require.NoError(t, db.Model(plan).Updates(map[string]any{"total_amount": 1700, "title": "Updated monthly"}).Error)
			newCode := func(name string) *Redemption {
				code := &Redemption{Name: name, Key: name, RedemptionType: RedemptionTypeSubscription, PlanId: plan.Id, Quota: 999}
				require.NoError(t, code.Insert())
				assert.Zero(t, code.Quota)
				require.NoError(t, code.Update(true)) // No-op updates must also work on MySQL.
				return code
			}
			first := newCode("subscription-first")
			result, err = RedeemWithResult("  "+first.Key+"  ", user.Id)
			require.NoError(t, err)
			assert.Equal(t, "Updated monthly", result.PlanTitle)
			assert.Equal(t, RedemptionTypeSubscription, result.Type)
			assert.Zero(t, result.Quota)
			var sub UserSubscription
			require.NoError(t, db.First(&sub, result.SubscriptionId).Error)
			assert.EqualValues(t, 1700, sub.AmountTotal)
			assert.Equal(t, "redemption", sub.Source)
			assert.Equal(t, time.Unix(sub.StartTime, 0).AddDate(0, 1, 0).Unix(), sub.EndTime)
			assert.Greater(t, sub.NextResetTime, sub.StartTime)
			var updatedUser User
			require.NoError(t, db.First(&updatedUser, user.Id).Error)
			assert.Equal(t, 2001234, updatedUser.Quota)
			assert.Equal(t, "pro", updatedUser.Group)
			first.Status = 1
			assert.Error(t, first.Update(true))
			first.Name = "changed"
			assert.Error(t, first.Update(false))
			_, err = RedeemWithResult(first.Key, user.Id)
			assert.ErrorIs(t, err, ErrRedeemFailed)
			detail, err := GetRedemptionById(first.Id)
			require.NoError(t, err)
			assert.Equal(t, "Updated monthly", detail.PlanTitle)
			rows, total, err := SearchRedemptions("subscription", "", 0, 10)
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, rows, 1)
			assert.Equal(t, detail.PlanTitle, rows[0].PlanTitle)
			var logs []Log
			require.NoError(t, db.Where("user_id = ?", user.Id).Find(&logs).Error)
			require.NotEmpty(t, logs)
			encoded, err := common.Marshal(logs)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "subscription-first")
			assert.Contains(t, string(encoded), "Updated monthly")
			for _, table := range []any{&TopUp{}, &SubscriptionOrder{}} {
				var count int64
				require.NoError(t, db.Model(table).Count(&count).Error)
				assert.Zero(t, count)
			}
			// A second code creates a separate active subscription.
			second := newCode("subscription-second")
			_, err = RedeemWithResult(second.Key, user.Id)
			require.NoError(t, err)

			// Unused codes can change their bound plan but cannot change benefit type.
			yearly := &SubscriptionPlan{Title: "Two years", DurationUnit: "year", DurationValue: 2, Enabled: true, TotalAmount: 0}
			require.NoError(t, db.Create(yearly).Error)
			editable := newCode("editable-subscription")
			editable.RedemptionType = RedemptionTypeBalance
			assert.Error(t, editable.Update(false))
			editable.RedemptionType = RedemptionTypeSubscription
			editable.PlanId = yearly.Id
			editable.Name, editable.Quota = "Yearly gift", 999
			require.NoError(t, editable.Update(false))
			assert.Zero(t, editable.Quota)
			result, err = RedeemWithResult(editable.Key, user.Id)
			require.NoError(t, err)
			assert.Equal(t, yearly.Id, result.PlanId)
			assert.Equal(t, time.Unix(result.StartTime, 0).AddDate(2, 0, 0).Unix(), result.EndTime)
			sub = UserSubscription{}
			require.NoError(t, db.First(&sub, result.SubscriptionId).Error)
			assert.Zero(t, sub.AmountTotal)
			for _, invalid := range []Redemption{
				{Name: "invalid type", Key: "invalid-type", RedemptionType: "unknown", Quota: 1},
				{Name: "invalid balance", Key: "invalid-balance", RedemptionType: RedemptionTypeBalance, Quota: 1, PlanId: yearly.Id},
				{Name: "invalid plan", Key: "invalid-plan", RedemptionType: RedemptionTypeSubscription, PlanId: 999999},
			} {
				assert.Error(t, invalid.Insert())
			}

			for _, kind := range []string{"disabled", "expired", "plan-disabled", "plan-deleted", "limit", "missing-user"} {
				t.Run(kind, func(t *testing.T) {
					isolated := &SubscriptionPlan{Title: kind, DurationUnit: "year", DurationValue: 1, Enabled: true, TotalAmount: 99}
					require.NoError(t, db.Create(isolated).Error)
					code := &Redemption{Name: kind, Key: kind, RedemptionType: RedemptionTypeSubscription, PlanId: isolated.Id}
					require.NoError(t, code.Insert())
					uid := user.Id
					switch kind {
					case "disabled":
						require.NoError(t, db.Model(code).Update("status", 2).Error)
					case "expired":
						require.NoError(t, db.Model(code).Update("expired_time", common.GetTimestamp()-1).Error)
					case "plan-disabled":
						require.NoError(t, db.Model(isolated).Update("enabled", false).Error)
					case "plan-deleted":
						require.NoError(t, db.Delete(isolated).Error)
					case "limit":
						require.NoError(t, db.Model(isolated).Update("max_purchase_per_user", 1).Error)
						require.NoError(t, db.Create(&UserSubscription{UserId: uid, PlanId: isolated.Id}).Error)
					case "missing-user":
						uid = 999999
					}
					_, err := RedeemWithResult(code.Key, uid)
					assert.ErrorIs(t, err, ErrRedeemFailed)
					var saved Redemption
					require.NoError(t, db.First(&saved, code.Id).Error)
					assert.Zero(t, saved.UsedUserId)
					assert.Zero(t, saved.RedeemedTime)
					if kind != "disabled" {
						assert.Equal(t, 1, saved.Status)
					}
				})
			}
			// A single code cannot open multiple subscriptions, even across users.
			otherUser := &User{Username: "other-code-user", AffCode: "other-code", Group: "default", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(otherUser).Error)
			shared := newCode("shared-code")
			var wg sync.WaitGroup
			start := make(chan struct{})
			results := make([]error, 4)
			for i := range 4 {
				wg.Go(func() {
					<-start
					uid := user.Id
					if i%2 != 0 {
						uid = otherUser.Id
					}
					_, results[i] = RedeemWithResult(shared.Key, uid)
				})
			}
			close(start)
			wg.Wait()
			successes := 0
			for _, err := range results {
				if err == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)

			// Different codes and a balance purchase compete for the same remaining slot.
			limited := &SubscriptionPlan{Title: "Limited", DurationUnit: "day", DurationValue: 1, Enabled: true, TotalAmount: 100, MaxPurchasePerUser: 1, PriceAmount: 1}
			require.NoError(t, db.Create(limited).Error)
			InvalidateSubscriptionPlanCache(limited.Id)
			limitedKeys := []string{"limited-a", "limited-b"}
			for _, key := range limitedKeys {
				require.NoError(t, (&Redemption{Name: key, Key: key, RedemptionType: RedemptionTypeSubscription, PlanId: limited.Id}).Insert())
			}
			start = make(chan struct{})
			results = make([]error, 3)
			for i := range 3 {
				wg.Go(func() {
					<-start
					if i == 2 {
						results[i] = PurchaseSubscriptionWithBalance(user.Id, limited.Id)
					} else {
						_, results[i] = RedeemWithResult(limitedKeys[i], user.Id)
					}
				})
			}
			close(start)
			wg.Wait()
			successes = 0
			for _, err := range results {
				if err == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)
			var count int64
			require.NoError(t, db.Model(&UserSubscription{}).Where("user_id = ? AND plan_id = ?", user.Id, limited.Id).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			for i, key := range limitedKeys {
				var code Redemption
				require.NoError(t, db.Where(commonKeyCol+" = ?", key).First(&code).Error)
				if results[i] != nil {
					assert.Equal(t, 1, code.Status)
				}
			}

			// Fresh installation remains stable across two production migrations.
			resetEpayMatrixDatabase(t, db)
			for range 2 {
				require.NoError(t, migrateDB())
			}
			assert.True(t, db.Migrator().HasColumn(&Redemption{}, "redemption_type"))
			assert.True(t, db.Migrator().HasColumn(&Redemption{}, "plan_id"))
		})
	}
}

func TestRedemptionSecretsAreExcludedFromSQLLogs(t *testing.T) {
	userID, key := setupRedeemFixture(t, 50)
	oldDB, oldDebug := DB, common.DebugEnabled
	common.DebugEnabled = true
	var sqlLogs bytes.Buffer
	DB = oldDB.Session(&gorm.Session{Logger: newGormLogger(&sqlLogs).LogMode(gormlogger.Info)})
	t.Cleanup(func() { DB = oldDB; common.DebugEnabled = oldDebug })
	_, err := RedeemWithResult("missing-secret-code", userID)
	assert.ErrorIs(t, err, ErrRedeemFailed)
	assert.Error(t, (&Redemption{Name: "duplicate", Key: key, Quota: 50}).Insert())
	_, err = RedeemWithResult(key, userID)
	require.NoError(t, err)
	assert.NotContains(t, sqlLogs.String(), key)
	assert.NotContains(t, sqlLogs.String(), "missing-secret-code")
}
