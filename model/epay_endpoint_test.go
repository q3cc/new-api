package model

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// These schemas reproduce the released order tables before endpoint columns.
type legacyEpayTopUp struct {
	Id              int `gorm:"primaryKey"`
	UserId          int `gorm:"index"`
	Amount          int64
	Money           float64
	TradeNo         string `gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `gorm:"type:varchar(50)"`
	PaymentProvider string `gorm:"type:varchar(50);default:''"`
	CreateTime      int64
	CompleteTime    int64
	Status          string
}

func (legacyEpayTopUp) TableName() string { return "top_ups" }

type legacyEpaySubscriptionOrder struct {
	Id              int `gorm:"primaryKey"`
	UserId          int `gorm:"index"`
	PlanId          int `gorm:"index"`
	Money           float64
	TradeNo         string `gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `gorm:"type:varchar(50)"`
	PaymentProvider string `gorm:"type:varchar(50);default:''"`
	CreateTime      int64
	CompleteTime    int64
	Status          string
	ProviderPayload string `gorm:"type:text"`
}

func (legacyEpaySubscriptionOrder) TableName() string { return "subscription_orders" }

func TestEpayDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "epay.db"))
			case "mysql":
				dsn := os.Getenv("TEST_EPAY_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_EPAY_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_EPAY_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_EPAY_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			previousDB, previousLogDB := DB, LOG_DB
			previousTrialDB := trialCreditDatabase.Load()
			previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
			previousMethods := operation_setting.PayMethods2JsonString()
			previousQuota := common.QuotaPerUnit
			common.OptionMapRWMutex.Lock()
			previousOptions := common.OptionMap
			common.OptionMap = make(map[string]string)
			common.OptionMapRWMutex.Unlock()
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			common.QuotaPerUnit = 500000
			initCol()
			t.Cleanup(func() {
				DB, LOG_DB = previousDB, previousLogDB
				trialCreditDatabase.Store(previousTrialDB)
				common.SetDatabaseTypes(previousMain, previousLog)
				initCol()
				common.QuotaPerUnit = previousQuota
				common.OptionMapRWMutex.Lock()
				common.OptionMap = previousOptions
				common.OptionMapRWMutex.Unlock()
				require.NoError(t, operation_setting.UpdatePayMethodsByJsonString(previousMethods))
				sqlDB, err := db.DB()
				require.NoError(t, err)
				require.NoError(t, sqlDB.Close())
			})
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			resetEpayMatrixDatabase(t, db)
			t.Cleanup(func() { resetEpayMatrixDatabase(t, db) })

			// Upgrade a released schema with a pending order and existing secret.
			require.NoError(t, db.AutoMigrate(&Option{}, &legacyEpayTopUp{}, &legacyEpaySubscriptionOrder{}))
			for key, value := range map[string]string{"PayAddress": "https://legacy.example.com", "EpayId": "100", "EpayKey": "legacy-secret", "PayMethods": `[{"name":"Alipay","type":"alipay"}]`} {
				require.NoError(t, db.Create(&Option{Key: key, Value: value}).Error)
			}
			require.NoError(t, db.Create(&legacyEpayTopUp{UserId: 701, Amount: 2, Money: 10, TradeNo: "legacy-pending", PaymentMethod: "alipay", PaymentProvider: "", CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}).Error)
			require.NoError(t, db.Create(&legacyEpaySubscriptionOrder{UserId: 701, PlanId: 701, Money: 9.99, TradeNo: "legacy-subscription", PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay, CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}).Error)
			for range 2 {
				require.NoError(t, migrateDB())
			}
			legacy := GetTopUpByTradeNo("legacy-pending")
			require.NotNil(t, legacy)
			assert.True(t, legacy.LegacyEpayCallback)
			legacyVersion, err := GetEpayOrderVersion(legacy.TradeNo, "", false)
			require.NoError(t, err)
			assert.Equal(t, "legacy-secret", legacyVersion.SecretKey)
			migratedSub := GetSubscriptionOrderByTradeNo("legacy-subscription")
			require.NotNil(t, migratedSub)
			assert.True(t, migratedSub.LegacyEpayCallback)
			assert.Equal(t, legacyVersion.Id, migratedSub.EpayVersionId)
			var versionCount int64
			require.NoError(t, db.Model(&EpayEndpointVersion{}).Count(&versionCount).Error)
			assert.Equal(t, int64(1), versionCount)
			assert.Error(t, db.Create(&TopUp{TradeNo: legacy.TradeNo}).Error, "order uniqueness survives upgrade")

			// New services never inherit another service's identity or key.
			aKey, bKey := "a-secret", "b-secret"
			config := EpayConfig{Endpoints: []EpayEndpointConfig{
				{Id: "a", Name: "Service A", Address: "https://a.example.com", MerchantId: "101", Enabled: true, Key: &aKey},
				{Id: "b", Name: "Service B", Address: "https://b.example.com", MerchantId: "102", Enabled: true, Key: &bKey},
			}, PayMethods: []map[string]string{{"name": "Alipay", "type": "alipay", "epay_endpoint_id": "a"}, {"name": "WeChat", "type": "wxpay", "epay_endpoint_id": "b"}}}
			require.NoError(t, SaveEpayConfig(config))
			a, err := ResolveEpayPaymentMethod("alipay")
			require.NoError(t, err)
			b, err := ResolveEpayPaymentMethod("wxpay")
			require.NoError(t, err)
			public, err := GetEpayConfig()
			require.NoError(t, err)
			encoded, err := common.Marshal(public)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), aKey)
			assert.NotContains(t, string(encoded), bKey)
			assert.NotContains(t, string(encoded), "legacy-secret")
			assert.Contains(t, string(encoded), `"has_key":true`)
			config.Endpoints[1].Key = &aKey
			require.Error(t, SaveEpayConfig(config))
			unchanged, err := ResolveEpayPaymentMethod("wxpay")
			require.NoError(t, err)
			assert.Equal(t, b.Id, unchanged.Id)
			config.Endpoints[1].Key = &bKey

			user := &User{Id: 701, Username: "epay_user", DisplayName: "Target Nickname", Email: "target@example.com", AffCode: "epay-matrix", Quota: 0, Status: common.UserStatusEnabled, Group: "default"}
			require.NoError(t, db.Create(user).Error)
			plan := &SubscriptionPlan{Id: 701, Title: "Matrix Plan", PriceAmount: 9.99, DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true, TotalAmount: 1000}
			InvalidateSubscriptionPlanCache(plan.Id)
			require.NoError(t, db.Create(plan).Error)
			order := &TopUp{UserId: user.Id, Amount: 2, Money: 10, TradeNo: "new-wallet", PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay, EpayVersionId: a.Id, EpayMoney: "10.00", Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp()}
			require.NoError(t, order.Insert())
			sub := &SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, Money: 9.99, TradeNo: "new-sub", PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay, EpayVersionId: a.Id, EpayMoney: "9.99", Status: common.TopUpStatusPending}
			require.NoError(t, sub.Insert())
			_, err = GetEpayOrderVersion(order.TradeNo, "", false)
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			_, err = GetEpayOrderVersion(order.TradeNo, "b", false)
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			_, err = RechargeEpay(order.TradeNo, "alipay", "", EpayVerification{VersionId: b.Id, Method: "alipay", Money: "10.00"})
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			_, err = RechargeEpay(order.TradeNo, "alipay", "", EpayVerification{VersionId: a.Id, Method: "alipay", Money: "0.01"})
			require.Error(t, err)
			_, err = RechargeEpay(order.TradeNo, "wxpay", "", EpayVerification{VersionId: a.Id, Method: "wxpay", Money: "10.00"})
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			require.ErrorIs(t, CompleteSubscriptionOrder(sub.TradeNo, "", PaymentProviderEpay, "alipay", EpayVerification{VersionId: b.Id, Method: "alipay", Money: "9.99"}), ErrPaymentMethodMismatch)
			assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, user.Id))
			assert.Equal(t, common.TopUpStatusPending, GetTopUpByTradeNo(order.TradeNo).Status)

			t.Run("same gateway type can select distinct endpoints", func(t *testing.T) {
				original := config.PayMethods
				config.PayMethods = []map[string]string{
					{"name": "Alipay A", "type": "alipay", "epay_endpoint_id": "a"},
					{"name": "Alipay B", "type": "alipay", "epay_endpoint_id": "b"},
				}
				require.NoError(t, SaveEpayConfig(config))
				defer func() { config.PayMethods = original; require.NoError(t, SaveEpayConfig(config)) }()
				_, err := ResolveEpayPaymentMethod("alipay")
				require.Error(t, err, "ambiguous legacy selection must not choose the first service")
				for _, method := range config.PayMethods {
					version, err := ResolveEpayPaymentMethod(EpayPaymentMethodKey(method))
					require.NoError(t, err)
					assert.Equal(t, method["epay_endpoint_id"], version.EndpointId)
				}
				bad := append([]map[string]string{}, config.PayMethods...)
				bad = append(bad, map[string]string{"name": "Duplicate", "type": "alipay", "epay_endpoint_id": "a"})
				encoded, err := common.Marshal(bad)
				require.NoError(t, err)
				require.Error(t, UpdateOption("PayMethods", string(encoded)))
				for _, kind := range []string{"", " ", " alipay", "bad\ttype"} {
					encoded, err = common.Marshal([]map[string]string{{"name": "Alipay", "type": kind, "epay_endpoint_id": "a"}})
					require.NoError(t, err)
					require.Error(t, UpdateOption("PayMethods", string(encoded)))
				}
				encoded, err = common.Marshal([]map[string]string{{"name": " ", "type": "alipay", "epay_endpoint_id": "a"}})
				require.NoError(t, err)
				require.Error(t, UpdateOption("PayMethods", string(encoded)))
			})
			// Rotation and disabling affect only subsequent purchases.
			newKey := "a-rotated"
			config.Endpoints[0].Key = &newKey
			config.Endpoints[0].Address = "https://a-new.example.com"
			require.NoError(t, SaveEpayConfig(config))
			rotated, err := ResolveEpayPaymentMethod("alipay")
			require.NoError(t, err)
			assert.NotEqual(t, a.Id, rotated.Id)
			preserved, err := GetEpayOrderVersion(order.TradeNo, "a", false)
			require.NoError(t, err)
			assert.Equal(t, aKey, preserved.SecretKey)
			config.Endpoints[0].Enabled = false
			config.Endpoints[0].Key = nil
			require.NoError(t, SaveEpayConfig(config))
			_, err = ResolveEpayPaymentMethod("alipay")
			require.Error(t, err)
			_, err = GetEpayOrderVersion(order.TradeNo, "a", false)
			require.NoError(t, err)
			config.Endpoints[1].Key = &aKey
			require.Error(t, SaveEpayConfig(config), "archived keys also remain isolated")
			assert.Error(t, UpdateOption("EpayKey", "bypass"))
			for _, alias := range []string{"paymethods", "PayMethods ", "epayendpointsmigrated"} {
				assert.Error(t, UpdateOption(alias, "bypass"))
				assert.Error(t, UpdateOptionsBulk(map[string]string{alias: "bypass"}))
			}
			if dialect == "mysql" {
				assert.Error(t, UpdateOption("PáyMethods", "bypass"))
				assert.Error(t, UpdateOptionsBulk(map[string]string{"PáyMethods": "bypass"}))
			}
			assert.Error(t, UpdateOption("PayMethods", `[{"name":"Alipay","type":"alipay","epay_endpoint_id":"missing"}]`))

			// Parallel callbacks across separate transactions credit exactly once.
			verification := EpayVerification{VersionId: a.Id, Method: "alipay", Money: "10.00"}
			var wg sync.WaitGroup
			errs := make(chan error, 2)
			for range 2 {
				wg.Go(func() { _, err := RechargeEpay(order.TradeNo, "alipay", "", verification); errs <- err })
			}
			wg.Wait()
			close(errs)
			for err := range errs {
				require.NoError(t, err)
			}
			assert.Equal(t, 1_000_000, getUserQuotaForPaymentGuardTest(t, user.Id))
			_, err = RechargeEpay(order.TradeNo, "alipay", "", EpayVerification{VersionId: b.Id, Method: "alipay", Money: "10.00"})
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)

			// Admin completion and a concurrent verified callback issue one plan.
			var completions sync.WaitGroup
			completionErrors := make(chan error, 2)
			completions.Go(func() { completionErrors <- ManualCompleteTopUp(sub.TradeNo, "") })
			completions.Go(func() {
				completionErrors <- CompleteSubscriptionOrder(sub.TradeNo, "", PaymentProviderEpay, "alipay", EpayVerification{VersionId: a.Id, Method: "alipay", Money: "9.99"})
			})
			completions.Wait()
			close(completionErrors)
			for err := range completionErrors {
				require.NoError(t, err)
			}
			require.NoError(t, ManualCompleteTopUp(sub.TradeNo, ""))
			require.NoError(t, ManualCompleteTopUp(sub.TradeNo, ""))
			assert.Equal(t, 1_000_000, getUserQuotaForPaymentGuardTest(t, user.Id))
			assert.Equal(t, int64(1), countUserSubscriptionsForPaymentGuardTest(t, user.Id))
			require.NoError(t, CompleteSubscriptionOrder(sub.TradeNo, "", PaymentProviderEpay, "alipay", EpayVerification{VersionId: a.Id, Method: "alipay", Money: "9.99"}))
			assert.Equal(t, int64(1), countUserSubscriptionsForPaymentGuardTest(t, user.Id))

			// Both sources share counting, ranking, pagination and owner/time scope.
			page := &common.PageInfo{Page: 1, PageSize: 1}
			records, total, err := SearchAllTopUps("Target Nickname", page)
			require.NoError(t, err)
			assert.Equal(t, int64(4), total)
			require.Len(t, records, 1)
			records, total, err = SearchAllTopUps(sub.TradeNo, page)
			require.NoError(t, err)
			assert.Equal(t, int64(1), total)
			require.Len(t, records, 1)
			assert.Equal(t, "subscription", records[0].OrderType)
			assert.Equal(t, plan.Title, records[0].PlanTitle)
			records, total, err = SearchUserTopUps(999, "new", page)
			require.NoError(t, err)
			assert.Zero(t, total)
			assert.Empty(t, records)
			require.NoError(t, db.Model(&SubscriptionOrder{}).Where("trade_no = ?", "legacy-subscription").Update("create_time", topUpQueryCutoff()-1).Error)
			_, total, err = GetUserTopUps(user.Id, &common.PageInfo{Page: 1, PageSize: 20})
			require.NoError(t, err)
			assert.Equal(t, int64(3), total)
			_, total, err = GetAllTopUps(&common.PageInfo{Page: 1, PageSize: 20})
			require.NoError(t, err)
			assert.Equal(t, int64(4), total)
			results, _, err := SearchUsers(" Target Nickname ", "default", nil, nil, 0, 20)
			require.NoError(t, err)
			require.Len(t, results, 1)
			assert.Empty(t, results[0].Password)

			assertEpaySearchAndHistoryContracts(t, db)
			assertAdminOrderContracts(t, db)

			// Fresh installation is also stable across consecutive starts.
			resetEpayMatrixDatabase(t, db)
			for range 2 {
				require.NoError(t, migrateDB())
			}
			fresh, err := GetEpayConfig()
			require.NoError(t, err)
			assert.Empty(t, fresh.Endpoints)
		})
	}
}

func assertEpaySearchAndHistoryContracts(t *testing.T, db *gorm.DB) {
	t.Helper()
	users := []*User{
		{Id: 10, Username: "matrix_id", DisplayName: "X", Email: "matrix_id@example.com"},
		{Id: 11, Username: "10", DisplayName: "X", Email: "matrix_name@example.com"},
		{Id: 12, Username: "matrix_nick", DisplayName: "10", Email: "matrix_nick@example.com"},
		{Id: 13, Username: "matrix_email", DisplayName: "X", Email: "10"},
		{Id: 14, Username: "matrix_em_contains", DisplayName: "X", Email: "pre10suffix"},
		{Id: 15, Username: "pre10suffix", DisplayName: "X", Email: "matrix_contains@example.com"},
	}
	for _, user := range users {
		user.Group, user.Role, user.Status = "ranking", common.RoleCommonUser, common.UserStatusEnabled
		user.AffCode, user.Password = user.Username, "filtered-password"
		require.NoError(t, db.Create(user).Error)
	}
	results, total, err := SearchUsers(" 10 ", "ranking", nil, nil, 0, 2, NewUserSortOptions("id", "asc"))
	require.NoError(t, err)
	assert.Equal(t, int64(6), total)
	assert.Equal(t, []int{10, 11}, collectUserIDs(results))
	results, _, err = SearchUsers("10", "ranking", nil, nil, 2, 10, NewUserSortOptions("id", "asc"))
	require.NoError(t, err)
	assert.Equal(t, []int{12, 13, 15, 14}, collectUserIDs(results))
	require.NoError(t, db.Model(&User{}).Where("id = ?", 15).Update("role", common.RoleAdminUser).Error)
	role, status := common.RoleCommonUser, common.UserStatusEnabled
	results, total, err = SearchUsers("10", "ranking", &role, &status, 0, 20, NewUserSortOptions("id", "asc"))
	require.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Equal(t, []int{10, 11, 12, 13, 14}, collectUserIDs(results))
	for _, user := range results {
		assert.Empty(t, user.Password)
		assert.Nil(t, user.AccessToken)
	}
	literal := "literal%_!\\"
	require.NoError(t, db.Model(&User{}).Where("id = ?", 14).Update("display_name", literal).Error)
	results, total, err = SearchUsers(literal, "", nil, nil, 0, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, []int{14}, collectUserIDs(results))

	// All retained subscription states share one exact-first, stable DB page.
	for index, status := range []string{common.TopUpStatusPending, common.TopUpStatusFailed, common.TopUpStatusExpired} {
		trade := []string{"history%_!\\", "prefix-history%_!\\-suffix", "history-expired"}[index]
		require.NoError(t, db.Create(&SubscriptionOrder{UserId: 10, PlanId: 701, TradeNo: trade, Money: 9.99, Status: status, CreateTime: topUpQueryCutoff() + 60 + int64(index)}).Error)
	}
	page := &common.PageInfo{Page: 1, PageSize: 1}
	records, total, err := SearchUserTopUps(10, "history%_!\\", page)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, records, 1)
	assert.Equal(t, "history%_!\\", records[0].TradeNo)
	page.Page = 2
	records, total, err = SearchUserTopUps(10, "history%_!\\", page)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, records, 1)
	assert.Equal(t, common.TopUpStatusFailed, records[0].Status)
	for _, keyword := range []string{"10", "matrix_id", "matrix_id@example.com"} {
		_, total, err := SearchAllTopUps(keyword, &common.PageInfo{Page: 1, PageSize: 20})
		require.NoError(t, err)
		assert.Equal(t, int64(3), total)
	}
	_, total, err = SearchUserTopUps(11, "history", &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	assert.Zero(t, total)
}

// Each DSN names an isolated test database; include the entire startup migration
// so fresh installations and old-order upgrades exercise the production path.
func resetEpayMatrixDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	tables, err := db.Migrator().GetTables()
	require.NoError(t, err)
	for _, table := range tables {
		if strings.HasPrefix(table, "sqlite_") {
			continue
		}
		require.NoError(t, db.Migrator().DropTable(table))
	}
}

func assertAdminOrderContracts(t *testing.T, db *gorm.DB) {
	t.Helper()
	owner := User{Username: "orders_owner", DisplayName: "orders%_!\\", Email: "orders@example.com", AffCode: "orders_owner", Password: "private-password"}
	require.NoError(t, db.Create(&owner).Error)
	plan := SubscriptionPlan{Title: "Orders monthly plan"}
	require.NoError(t, db.Create(&plan).Error)
	versionA := EpayEndpointVersion{EndpointId: "orders-a", Address: "https://private-a.invalid", MerchantId: "private-merchant", SecretKey: "private-key-a"}
	versionB := EpayEndpointVersion{EndpointId: "orders-b", SecretKey: "private-key-b"}
	require.NoError(t, db.Create(&versionA).Error)
	require.NoError(t, db.Create(&versionB).Error)
	require.NoError(t, db.Create(&EpayEndpoint{Id: "orders-a", Name: "Orders service A", Enabled: false, VersionId: versionB.Id}).Error)
	require.NoError(t, db.Create(&EpayEndpoint{Id: "orders-b", Name: "Orders service B", Enabled: true, VersionId: versionB.Id}).Error)
	start, end := int64(100), int64(200)
	for _, order := range []TopUp{
		{UserId: owner.Id, TradeNo: "orders%_!\\", Status: common.TopUpStatusPending, PaymentMethod: "retired-custom", PaymentProvider: PaymentProviderEpay, EpayVersionId: versionA.Id, CreateTime: start, Money: 12.34, Amount: 2},
		{UserId: owner.Id, TradeNo: "orders-outside", Status: common.TopUpStatusPending, PaymentMethod: "retired-custom", CreateTime: end + 1},
		{UserId: owner.Id, TradeNo: "orders-mirror", Status: common.TopUpStatusSuccess, PaymentMethod: "mirror-only-method", CreateTime: end + 2},
	} {
		require.NoError(t, db.Create(&order).Error)
	}
	for _, order := range []SubscriptionOrder{
		{UserId: owner.Id, PlanId: plan.Id, TradeNo: "prefix-orders%_!\\-suffix", Status: common.TopUpStatusPending, PaymentMethod: "retired-custom", PaymentProvider: PaymentProviderEpay, EpayVersionId: versionB.Id, CreateTime: end, Money: 6.78, ProviderPayload: "private-callback-signature"},
		{UserId: owner.Id, PlanId: plan.Id, TradeNo: "orders-mirror", Status: common.TopUpStatusFailed, PaymentMethod: PaymentMethodStripe, CreateTime: end},
	} {
		require.NoError(t, db.Create(&order).Error)
	}

	t.Run("combined filters apply before exact-first pagination with inclusive dates", func(t *testing.T) {
		filter := BillingHistoryFilter{Status: common.TopUpStatusPending, PaymentMethod: "retired-custom", StartTimestamp: &start, EndTimestamp: &end}
		for index, trade := range []string{"orders%_!\\", "prefix-orders%_!\\-suffix"} {
			rows, total, err := GetAdminBillingHistory(" orders%_!\\ ", filter, &common.PageInfo{Page: index + 1, PageSize: 1})
			require.NoError(t, err)
			assert.Equal(t, int64(2), total)
			require.Len(t, rows, 1)
			assert.Equal(t, trade, rows[0].TradeNo)
			assert.Equal(t, owner.Username, rows[0].Username)
		}
		filter.OrderType = "subscription"
		rows, total, err := GetAdminBillingHistory(owner.Email, filter, &common.PageInfo{Page: 1, PageSize: 20})
		require.NoError(t, err)
		assert.Equal(t, int64(1), total)
		require.Len(t, rows, 1)
		assert.Equal(t, plan.Title, rows[0].PlanTitle)
		filter.Status = common.TopUpStatusSuccess
		_, total, err = GetAdminBillingHistory("orders", filter, &common.PageInfo{Page: 1, PageSize: 20})
		require.NoError(t, err)
		assert.Zero(t, total)
	})
	t.Run("historical methods exclude subscription mirrors and retain retired methods", func(t *testing.T) {
		methods, err := GetBillingPaymentMethods()
		require.NoError(t, err)
		assert.Contains(t, methods, "retired-custom")
		assert.Contains(t, methods, PaymentMethodStripe)
		assert.NotContains(t, methods, "mirror-only-method")
		_, total, err := GetAdminBillingHistory(owner.Email, BillingHistoryFilter{}, &common.PageInfo{Page: 1, PageSize: 20})
		require.NoError(t, err)
		assert.Equal(t, int64(4), total)
	})
	t.Run("details resolve the saved endpoint version and expose only safe fields", func(t *testing.T) {
		for _, tc := range []struct{ kind, trade, endpoint string }{
			{"topup", "orders%_!\\", "orders-a"},
			{"subscription", "prefix-orders%_!\\-suffix", "orders-b"},
		} {
			detail, err := GetBillingOrderDetail(tc.kind, tc.trade)
			require.NoError(t, err)
			assert.Equal(t, tc.endpoint, detail.PaymentServiceId)
			assert.NotEmpty(t, detail.PaymentServiceName)
			assert.Equal(t, owner.DisplayName, detail.DisplayName)
			assert.Equal(t, owner.Email, detail.Email)
			encoded, err := common.Marshal(detail)
			require.NoError(t, err)
			var fields map[string]any
			require.NoError(t, common.Unmarshal(encoded, &fields))
			for key := range fields {
				assert.Contains(t, []string{"id", "user_id", "username", "amount", "money", "trade_no", "payment_method", "payment_provider", "create_time", "complete_time", "status", "order_type", "plan_id", "plan_title", "display_name", "email", "payment_service_id", "payment_service_name"}, key)
			}
			assert.NotContains(t, string(encoded), "private-")
		}
		_, err := GetBillingOrderDetail("topup", "orders-mirror")
		assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
		detail, err := GetBillingOrderDetail("subscription", "orders-mirror")
		require.NoError(t, err)
		assert.Equal(t, common.TopUpStatusFailed, detail.Status)
		assert.Empty(t, detail.PaymentServiceId)
	})
	t.Run("deleted users and plans leave original associations queryable", func(t *testing.T) {
		require.NoError(t, db.Unscoped().Delete(&owner).Error)
		require.NoError(t, db.Unscoped().Delete(&plan).Error)
		detail, err := GetBillingOrderDetail("subscription", "orders-mirror")
		require.NoError(t, err)
		assert.Equal(t, owner.Id, detail.UserId)
		assert.Equal(t, plan.Id, detail.PlanId)
		assert.Empty(t, detail.Username)
		assert.Empty(t, detail.PlanTitle)
		rows, total, err := GetAdminBillingHistory("orders-mirror", BillingHistoryFilter{}, &common.PageInfo{Page: 1, PageSize: 20})
		require.NoError(t, err)
		assert.Equal(t, int64(1), total)
		require.Len(t, rows, 1)
		assert.Equal(t, "subscription", rows[0].OrderType)
	})
}
