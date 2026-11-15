package model

import (
	"os"
	"testing"

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

// legacyGiftRedemption is the redemptions table as released before codes
// could be marked as gifts.
type legacyGiftRedemption struct {
	Id             int
	Key            string `gorm:"type:char(32);uniqueIndex"`
	RedemptionType string `gorm:"type:varchar(32);not null;default:'balance'"`
	Status         int
	Name           string
	Quota          int
	UsedUserId     int
	RedeemedTime   int64
	DeletedAt      gorm.DeletedAt `gorm:"index"`
}

func (legacyGiftRedemption) TableName() string { return "redemptions" }

// TestGiftQuotaSummaryDatabaseMatrix checks that the gift total counts every
// wallet gift exactly once, on every supported database and after upgrading
// a redemptions table that predates the gift flag.
func TestGiftQuotaSummaryDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)

			tables := []any{&User{}, &GiftQuotaRecord{}, &TrialCreditGrant{}, &LotteryPrize{}, &LotteryEntry{}, &Checkin{}, &Redemption{}}
			oldDB, oldType, oldOptions := DB, common.MainDatabaseType(), common.OptionMap
			oldSignup, oldInvitee := common.QuotaForNewUser, common.QuotaForInvitee
			oldPayment := *operation_setting.GetPaymentSetting()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			common.OptionMap = map[string]string{}
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(tables...))
				DB = oldDB
				common.SetMainDatabaseType(oldType)
				common.OptionMap = oldOptions
				common.QuotaForNewUser, common.QuotaForInvitee = oldSignup, oldInvitee
				*operation_setting.GetPaymentSetting() = oldPayment
				assert.NoError(t, sqlDB.Close())
			})

			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)

			// Upgrade path: a used code from before the gift flag existed must
			// read back as a non-gift code.
			require.NoError(t, db.Migrator().DropTable(tables...))
			require.NoError(t, db.AutoMigrate(&legacyGiftRedemption{}))
			for range 2 {
				require.NoError(t, db.AutoMigrate(tables...))
			}

			common.QuotaForNewUser, common.QuotaForInvitee = 100, 150
			operation_setting.GetPaymentSetting().ComplianceConfirmed = true
			operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
			inviter := User{Username: "gift-inviter", AffCode: "gift-inviter", Group: "default"}
			require.NoError(t, db.Create(&inviter).Error)
			owner := User{Username: "gift-owner", AffCode: "gift-owner", Group: "default", InviterId: inviter.Id}
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				return owner.createWithRegistrationRewards(tx, inviter.Id)
			}))
			require.Equal(t, 250, owner.Quota, "registration rewards go to the wallet")
			require.NoError(t, db.Model(&User{}).Where("id = ?", owner.Id).
				Updates(map[string]any{"aff_history": 900, "aff_quota": 200}).Error)

			require.NoError(t, db.Create(&legacyGiftRedemption{Key: "legacy-used", RedemptionType: RedemptionTypeBalance, Status: common.RedemptionCodeStatusUsed, Name: "legacy", Quota: 8000, UsedUserId: owner.Id, RedeemedTime: 1}).Error)
			require.NoError(t, db.Create(&TrialCreditGrant{UserId: owner.Id, GrantKey: "affiliate:1", Quota: 100, Remaining: 100, Source: "affiliate"}).Error)
			require.NoError(t, db.Create(&GiftQuotaRecord{UserId: owner.Id, Source: GiftSourceTopUp, Quota: 40, RefKey: "topup:order-1"}).Error)

			quotaPrize := LotteryPrize{ActivityId: 1, Name: "3 credits", Type: LotteryPrizeQuota, Quota: 300}
			planPrize := LotteryPrize{ActivityId: 1, Name: "Day pass", Type: LotteryPrizeSubscription, PlanId: 1}
			require.NoError(t, db.Create(&quotaPrize).Error)
			require.NoError(t, db.Create(&planPrize).Error)
			require.NoError(t, db.Create(&[]LotteryEntry{
				{ActivityId: 1, UserId: owner.Id, PrizeId: quotaPrize.Id, PrizeType: LotteryPrizeQuota, DeliveryStatus: LotteryDeliveryDelivered},
				{ActivityId: 1, UserId: owner.Id, PrizeId: quotaPrize.Id, PrizeType: LotteryPrizeQuota, DeliveryStatus: LotteryDeliveryFailed},
				{ActivityId: 1, UserId: owner.Id, PrizeId: planPrize.Id, PrizeType: LotteryPrizeSubscription, DeliveryStatus: LotteryDeliveryDelivered},
				{ActivityId: 1, UserId: inviter.Id, PrizeId: quotaPrize.Id, PrizeType: LotteryPrizeQuota, DeliveryStatus: LotteryDeliveryDelivered},
			}).Error)
			require.NoError(t, db.Create(&[]Checkin{
				{UserId: owner.Id, CheckinDate: "2026-11-01", QuotaAwarded: 20},
				{UserId: owner.Id, CheckinDate: "2026-11-02", QuotaAwarded: 30},
				{UserId: inviter.Id, CheckinDate: "2026-11-01", QuotaAwarded: 40},
			}).Error)
			deletedGift := Redemption{Key: "gift-deleted", RedemptionType: RedemptionTypeBalance, Status: common.RedemptionCodeStatusUsed, Quota: 25, Gift: true, UsedUserId: owner.Id}
			require.NoError(t, db.Create(&[]Redemption{
				{Key: "gift-used", RedemptionType: RedemptionTypeBalance, Status: common.RedemptionCodeStatusUsed, Quota: 400, Gift: true, UsedUserId: owner.Id},
				{Key: "sold-used", RedemptionType: RedemptionTypeBalance, Status: common.RedemptionCodeStatusUsed, Quota: 1000, UsedUserId: owner.Id},
				{Key: "gift-plan", RedemptionType: RedemptionTypeSubscription, Status: common.RedemptionCodeStatusUsed, Quota: 999, Gift: true, UsedUserId: owner.Id},
				{Key: "gift-unused", RedemptionType: RedemptionTypeBalance, Status: common.RedemptionCodeStatusEnabled, Quota: 700, Gift: true},
				deletedGift,
			}).Error)
			require.NoError(t, db.Where(map[string]any{"key": "gift-deleted"}).Delete(&Redemption{}).Error)

			var legacy Redemption
			require.NoError(t, db.Where(map[string]any{"key": "legacy-used"}).First(&legacy).Error)
			assert.False(t, legacy.Gift)

			_, err = AdjustUserQuota(owner.Id, common.RoleRootUser, "add", 70, true)
			require.NoError(t, err)
			_, err = AdjustUserQuota(owner.Id, common.RoleRootUser, "add", 5, false)
			require.NoError(t, err)
			_, err = AdjustUserQuota(owner.Id, common.RoleRootUser, "subtract", 10, true)
			require.NoError(t, err)

			summary, err := GetUserGiftQuotaSummary(owner.Id)
			require.NoError(t, err)
			assert.Equal(t, []GiftQuotaItem{
				{Source: GiftSourceRegistration, Quota: 250},
				{Source: GiftSourceTopUp, Quota: 40},
				{Source: GiftSourceAffiliate, Quota: 600},
				{Source: GiftSourceLottery, Quota: 300},
				{Source: GiftSourceCheckin, Quota: 50},
				{Source: GiftSourceRedemption, Quota: 425},
				{Source: GiftSourceAdmin, Quota: 70},
			}, summary.Items)
			assert.EqualValues(t, 1735, summary.Total)

			newcomer := User{Username: "gift-none", AffCode: "gift-none", Group: "default"}
			require.NoError(t, db.Create(&newcomer).Error)
			summary, err = GetUserGiftQuotaSummary(newcomer.Id)
			require.NoError(t, err)
			assert.NotNil(t, summary.Items, "an empty summary still serializes as a list")
			assert.Empty(t, summary.Items)
			assert.Zero(t, summary.Total)

			_, err = GetUserGiftQuotaSummary(newcomer.Id + 1000)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
		})
	}
}
