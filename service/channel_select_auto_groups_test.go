package service

import (
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupChannelSelectAutoGroupsTest(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := model.DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalRetryTimes := common.RetryTimes
	originalAutoGroups := setting.AutoGroups2JsonString()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalGroupRatios := ratio_setting.GroupRatio2JSONString()
	originalMaxTokenAutoGroups := setting.GetMaxTokenAutoGroups()

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	model.DB = db
	common.MemoryCacheEnabled = true
	common.RetryTimes = 0

	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`[]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":2}`))
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("2"))

	t.Cleanup(func() {
		model.DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.RetryTimes = originalRetryTimes
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalGroupRatios))
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(fmt.Sprintf("%d", originalMaxTokenAutoGroups)))

		if originalMemoryCacheEnabled && originalDB != nil &&
			originalDB.Migrator().HasTable(&model.Channel{}) && originalDB.Migrator().HasTable(&model.Ability{}) {
			model.InitChannelCache()
		}
		sqlDB, err := db.DB()
		if err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})

	return db
}

func createChannelSelectAutoGroupsChannel(t *testing.T, db *gorm.DB, id int, group, modelName string) {
	t.Helper()
	priority := int64(0)
	weight := uint(100)
	require.NoError(t, db.Create(&model.Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      fmt.Sprintf("key-%d", id),
		Status:   common.ChannelStatusEnabled,
		Name:     fmt.Sprintf("channel-%d", id),
		Weight:   &weight,
		Models:   modelName,
		Group:    group,
		Priority: &priority,
	}).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     group,
		Model:     modelName,
		ChannelId: id,
		Enabled:   true,
		Priority:  &priority,
		Weight:    weight,
	}).Error)
}

func TestCacheGetRandomSatisfiedChannelUsesTokenAutoGroupsWhenGlobalAutoIsEmpty(t *testing.T) {
	db := setupChannelSelectAutoGroupsTest(t)
	const modelName = "auto-groups-runtime-model"
	createChannelSelectAutoGroupsChannel(t, db, 2101, "vip", modelName)
	createChannelSelectAutoGroupsChannel(t, db, 2102, "default", modelName)
	model.InitChannelCache()

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip", "default"})
	common.SetContextKey(ctx, constant.ContextKeyTokenCrossGroupRetry, true)

	retry := 0
	param := &RetryParam{
		Ctx:         ctx,
		TokenGroup:  "auto",
		ModelName:   modelName,
		RequestPath: "/v1/chat/completions",
		Retry:       &retry,
	}

	first, selectedGroup, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 2101, first.Id)
	assert.Equal(t, "vip", selectedGroup)
	assert.Equal(t, "vip", common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
	assert.Empty(t, setting.GetAutoGroups(), "the selection must not depend on the global Auto list")

	param.IncreaseRetry()
	second, selectedGroup, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, 2102, second.Id)
	assert.Equal(t, "default", selectedGroup)
	assert.Equal(t, "default", common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
}

func TestTrialBindingPreservesOrdinaryGroupAccess(t *testing.T) {
	db := setupChannelSelectAutoGroupsTest(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TrialCreditGrant{}, &model.UserSubscription{}))
	common.OptionMapRWMutex.Lock()
	oldMap := common.OptionMap
	common.OptionMap = map[string]string{model.TrialConfigKey: `{"enabled":true,"types":[{"id":1,"name":"DSS credit","group":"DSS","enabled":true}]}`}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() { common.OptionMapRWMutex.Lock(); common.OptionMap = oldMap; common.OptionMapRWMutex.Unlock() })
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","DSS":"Original DSS description"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"DSS":1}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["DSS","default"]`))
	assert.Equal(t, "Original DSS description", GetUserUsableGroups("default")["DSS"])
	assert.Contains(t, GetUserUsableGroups("DSS"), "DSS", "a user's own group must remain usable")
	assert.Equal(t, []string{"DSS", "default"}, GetUserAutoGroup("default"))
	const modelName = "dss-model"
	createChannelSelectAutoGroupsChannel(t, db, 2110, "DSS", modelName)
	model.InitChannelCache()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"DSS", "default"})
	retry := 0
	channel, group, err := CacheGetRandomSatisfiedChannel(&RetryParam{Ctx: ctx, TokenGroup: "auto", ModelName: modelName, RequestPath: "/v1/chat/completions", Retry: &retry})
	assert.NoError(t, err)
	assert.NotNil(t, channel, "binding credit must not remove the existing DSS channel from Auto")
	assert.Equal(t, "DSS", group)
	user := model.User{Username: "ordinary-dss", AffCode: "ordinary-dss", Group: "default", Quota: 500}
	require.NoError(t, db.Create(&user).Error)
	info := &relaycommon.RelayInfo{UserId: user.Id, UserGroup: "default", UsingGroup: "DSS", RequestId: "ordinary-dss", IsPlayground: true, TokenUnlimited: true}
	available, err := RequestAvailableQuota(info)
	assert.NoError(t, err)
	assert.Equal(t, 500, available, "a user without this credit retains ordinary wallet billing")
	session, apiErr := NewBillingSession(ctx, info, 100)
	assert.Nil(t, apiErr)
	if session != nil {
		assert.Equal(t, "wallet", info.BillingSource)
		require.NoError(t, session.Settle(100))
	}
}

func TestTrialGroupFundingCompatibility(t *testing.T) {
	for _, engine := range []struct{ name, dsn string }{
		{"sqlite", ":memory:"}, {"mysql", os.Getenv("TRIAL_MYSQL_DSN")}, {"postgres", os.Getenv("TRIAL_POSTGRES_DSN")},
	} {
		t.Run(engine.name, func(t *testing.T) {
			if engine.dsn == "" {
				t.Skip("database DSN not configured")
			}
			var dialector gorm.Dialector
			switch engine.name {
			case "mysql":
				dialector = mysql.Open(engine.dsn)
			case "postgres":
				dialector = postgres.Open(engine.dsn)
			default:
				dialector = sqlite.Open(engine.dsn)
			}
			db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			var version string
			versionSQL := "SELECT VERSION()"
			if engine.name == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			oldDB, oldLogDB := model.DB, model.LOG_DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			oldMaster, oldMemory := common.IsMasterNode, common.MemoryCacheEnabled
			oldGroups, oldAuto, oldRatio := setting.UserUsableGroups2JSONString(), setting.AutoGroups2JsonString(), ratio_setting.GroupRatio2JSONString()
			common.OptionMapRWMutex.Lock()
			oldMap := common.OptionMap
			common.OptionMap = map[string]string{}
			common.OptionMapRWMutex.Unlock()
			t.Setenv("LOG_SQL_DSN", "")
			common.IsMasterNode = false
			common.SetDatabaseTypes(common.DatabaseType(engine.name), common.DatabaseType(engine.name))
			model.DB = db
			require.NoError(t, model.InitLogDB())
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if engine.name == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() {
				model.DB = oldDB
				common.SetDatabaseTypes(oldMain, oldLog)
				require.NoError(t, model.InitLogDB())
				model.LOG_DB = oldLogDB
				common.IsMasterNode, common.MemoryCacheEnabled = oldMaster, oldMemory
				common.OptionMapRWMutex.Lock()
				common.OptionMap = oldMap
				common.OptionMapRWMutex.Unlock()
				require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldGroups))
				require.NoError(t, setting.UpdateAutoGroupsByJsonString(oldAuto))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatio))
				if oldMemory {
					model.InitChannelCache()
				}
				require.NoError(t, sqlDB.Close())
			})
			// TRIAL_*_DSN must name dedicated throwaway test databases.
			require.NoError(t, db.Migrator().DropTable(&model.TrialCreditAllocation{}, &model.TrialCreditReservation{}, &model.TrialCreditGrant{}, &model.SubscriptionPreConsumeRecord{}, &model.UserSubscription{}, &model.SubscriptionPlan{}, &model.Ability{}, &model.Channel{}, &model.User{}, &model.Option{}))
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.Channel{}, &model.Ability{}, &model.UserSubscription{}, &model.SubscriptionPlan{}, &model.SubscriptionPreConsumeRecord{}))
			require.NoError(t, model.MigrateTrialCredit())
			require.NoError(t, model.MigrateTrialCredit())
			require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","DSS":"Original DSS"}`))
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"DSS":1,"vip":1}`))
			require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["DSS","default","vip"]`))
			cfg := model.TrialCreditConfig{Enabled: true, Types: []model.TrialCreditType{{Name: "DSS credit", Group: "DSS", Enabled: true}, {Name: "VIP credit", Group: "vip", Enabled: true}}}
			require.NoError(t, model.UpdateTrialCreditConfig(cfg))
			cfg = model.GetTrialCreditConfig()
			createChannelSelectAutoGroupsChannel(t, db, 2210, "DSS", "dss-existing-model")
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"DSS", "default"})
			for _, cache := range []bool{false, true} {
				common.MemoryCacheEnabled = cache
				if cache {
					model.InitChannelCache()
				}
				for _, tokenGroup := range []string{"DSS", "auto"} {
					retry := 0
					channel, group, err := CacheGetRandomSatisfiedChannel(&RetryParam{Ctx: ctx, TokenGroup: tokenGroup, ModelName: "dss-existing-model", RequestPath: "/v1/chat/completions", Retry: &retry})
					require.NoError(t, err)
					require.NotNil(t, channel)
					assert.Equal(t, 2210, channel.Id)
					assert.Equal(t, "DSS", group)
				}
			}
			assert.Equal(t, []string{"DSS", "default"}, GetUserAutoGroup("default"))
			for _, state := range []string{"own-group", "absent", "active", "expired", "exhausted", "disabled", "issuance-disabled", "other-group", "other-user", "subscription"} {
				t.Run(state, func(t *testing.T) {
					user := model.User{Username: "dss-" + state, AffCode: "dss-" + state, Group: "default", Quota: 1000}
					if state == "own-group" {
						user.Group = "DSS"
						original := setting.UserUsableGroups2JSONString()
						require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
						t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(original)) })
					}
					require.NoError(t, db.Create(&user).Error)
					if state != "own-group" && state != "absent" && state != "subscription" {
						owner, kind, expires := user.Id, 1, int64(0)
						if state == "other-group" {
							kind = 2
						}
						if state == "expired" {
							expires = time.Now().Unix() + 100
						}
						if state == "other-user" {
							another := model.User{Username: "other-owner", AffCode: "other-owner", Group: "default"}
							require.NoError(t, db.Create(&another).Error)
							owner = another.Id
						}
						require.NoError(t, model.GrantTrialCredit(owner, 200, expires, "grant-"+state, "admin", 1, kind))
						if state == "expired" {
							require.NoError(t, db.Model(&model.TrialCreditGrant{}).Where("user_id = ?", owner).Update("expires_at", time.Now().Unix()-1).Error)
						}
						if state == "exhausted" {
							require.NoError(t, db.Model(&model.TrialCreditGrant{}).Where("user_id = ?", owner).Update("remaining", 0).Error)
						}
					}
					if state == "disabled" {
						cfg.Enabled = false
						// The management API forbids disabling outstanding grants. Simulate a
						// persisted disabled policy to check the defensive request behavior.
						raw, err := common.Marshal(cfg)
						require.NoError(t, err)
						require.NoError(t, db.Model(&model.Option{}).Where(map[string]any{"key": model.TrialConfigKey}).Update("value", string(raw)).Error)
					}
					if state == "issuance-disabled" {
						cfg.Types[0].Enabled = false
						require.NoError(t, model.UpdateTrialCreditConfig(cfg))
					}
					info := &relaycommon.RelayInfo{UserId: user.Id, UserGroup: "default", UsingGroup: "DSS", RequestId: "dss-" + state, IsPlayground: true, TokenUnlimited: true}
					if state == "own-group" {
						info.UserGroup = ""
					}
					info.UserSetting.BillingPreference = "wallet_only"
					if state == "subscription" {
						plan := model.SubscriptionPlan{Title: "DSS subscription", Enabled: true, TotalAmount: 1000}
						require.NoError(t, db.Create(&plan).Error)
						sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, AmountTotal: 1000, Status: "active", StartTime: time.Now().Unix(), EndTime: time.Now().Unix() + 3600}
						require.NoError(t, db.Create(&sub).Error)
						info.UserSetting.BillingPreference = "subscription_only"
					}
					wantSource, wantAvailable, wantWallet := "wallet", 1000, 900
					if state == "active" || state == "issuance-disabled" {
						wantSource, wantAvailable, wantWallet = BillingSourceTrial, 1200, 1000
					}
					if state == "subscription" {
						wantSource, wantWallet = BillingSourceSubscription, 1000
					}
					if state == "own-group" {
						assert.Contains(t, GetUserUsableGroups("DSS", user.Id), "DSS")
					} else {
						assert.Equal(t, "Original DSS", GetUserUsableGroups("default", user.Id)["DSS"])
					}
					available, err := RequestAvailableQuota(info)
					require.NoError(t, err)
					assert.Equal(t, wantAvailable, available)
					if wantSource != BillingSourceTrial {
						require.NoError(t, PreConsumeTrialIfNeeded(ctx, info, 100))
						assert.Nil(t, info.Billing)
					}
					if state == "active" {
						oversized := *info
						oversized.RequestId = "oversized-trial"
						_, apiErr := NewBillingSession(ctx, &oversized, 1201)
						require.NotNil(t, apiErr)
						assert.Equal(t, 403, apiErr.StatusCode, "insufficient combined balance must not admit the request")
						mixed := *info
						mixed.RequestId = "mixed-trial-wallet"
						combined, apiErr := NewBillingSession(ctx, &mixed, 250)
						require.Nil(t, apiErr)
						assert.Equal(t, BillingSourceTrial, mixed.BillingSource)
						wallet, err := model.GetUserQuota(user.Id, true)
						require.NoError(t, err)
						assert.Equal(t, 950, wallet)
						require.NoError(t, combined.Settle(0))
					}
					session, apiErr := NewBillingSession(ctx, info, 100)
					require.Nil(t, apiErr)
					assert.Equal(t, wantSource, info.BillingSource)
					require.NoError(t, session.Settle(100))
					require.NoError(t, session.Settle(100))
					wallet, err := model.GetUserQuota(user.Id, true)
					require.NoError(t, err)
					assert.Equal(t, wantWallet, wallet)
					if wantSource == BillingSourceTrial {
						balance, err := model.GetTrialCreditGroupBalance(user.Id, "DSS")
						require.NoError(t, err)
						assert.Equal(t, 100, balance)
					}
					if state == "subscription" {
						var sub model.UserSubscription
						require.NoError(t, db.Where("user_id = ?", user.Id).First(&sub).Error)
						assert.EqualValues(t, 100, sub.AmountUsed)
					}
					cfg.Enabled, cfg.Types[0].Enabled = true, true
					require.NoError(t, model.UpdateTrialCreditConfig(cfg))
				})
			}
			t.Run("invalid policy preserves ordinary permissions but rejects billing", func(t *testing.T) {
				require.NoError(t, db.Model(&model.Option{}).Where(map[string]any{"key": model.TrialConfigKey}).Update("value", "{invalid").Error)
				assert.Equal(t, "Original DSS", GetUserUsableGroups("default")["DSS"])
				assert.Equal(t, []string{"DSS", "default"}, GetUserAutoGroup("default"))
				assert.NotContains(t, GetUserUsableGroups("default", 1), "vip")
				_, err := trialFundingBalance(&relaycommon.RelayInfo{UserId: 1, UserGroup: "default", UsingGroup: "DSS"})
				require.Error(t, err)
				raw, err := common.Marshal(cfg)
				require.NoError(t, err)
				require.NoError(t, db.Model(&model.Option{}).Where(map[string]any{"key": model.TrialConfigKey}).Update("value", string(raw)).Error)
			})

			t.Run("trial-only access cannot fall back to wallet", func(t *testing.T) {
				for _, state := range []string{"absent", "expired", "exhausted", "disabled"} {
					user := model.User{Username: "vip-" + state, AffCode: "vip-" + state, Group: "default", Quota: 1000}
					require.NoError(t, db.Create(&user).Error)
					if state != "absent" {
						require.NoError(t, model.GrantTrialCredit(user.Id, 200, 0, "vip-"+state, "admin", 1, 2))
						assert.Contains(t, GetUserUsableGroups("default", user.Id), "vip")
						if state == "expired" {
							require.NoError(t, db.Model(&model.TrialCreditGrant{}).Where("user_id = ?", user.Id).Update("expires_at", time.Now().Unix()-1).Error)
						}
						if state == "exhausted" {
							require.NoError(t, db.Model(&model.TrialCreditGrant{}).Where("user_id = ?", user.Id).Update("remaining", 0).Error)
						}
						if state == "disabled" {
							cfg.Enabled = false
							raw, err := common.Marshal(cfg)
							require.NoError(t, err)
							require.NoError(t, db.Model(&model.Option{}).Where(map[string]any{"key": model.TrialConfigKey}).Update("value", string(raw)).Error)
						}
					}
					assert.NotContains(t, GetUserUsableGroups("default", user.Id), "vip")
					info := &relaycommon.RelayInfo{UserId: user.Id, UsingGroup: "vip", RequestId: "vip-" + state, IsPlayground: true, TokenUnlimited: true}
					_, err := RequestAvailableQuota(info)
					require.ErrorIs(t, err, model.ErrTrialInsufficient)
					require.ErrorIs(t, PreConsumeTrialIfNeeded(ctx, info, 100), model.ErrTrialInsufficient)
					_, apiErr := NewBillingSession(ctx, info, 100)
					require.NotNil(t, apiErr)
					assert.Equal(t, 403, apiErr.StatusCode)
					wallet, err := model.GetUserQuota(user.Id, true)
					require.NoError(t, err)
					assert.Equal(t, 1000, wallet)
					cfg.Enabled = true
					require.NoError(t, model.UpdateTrialCreditConfig(cfg))
				}
			})
		})
	}
}
