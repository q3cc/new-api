package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type promotionEarnings struct {
	Rank          int    `json:"rank"`
	Name          string `json:"name"`
	IsMe          bool   `json:"is_me"`
	TotalQuota    int64  `json:"total_quota"`
	MonthQuota    int64  `json:"month_quota"`
	QuarterQuota  int64  `json:"quarter_quota"`
	PayingInvites int64  `json:"paying_invites"`
}

type promotionInvitee struct {
	InviteeId      int    `json:"invitee_id"`
	Name           string `json:"name"`
	Cancelled      bool   `json:"cancelled"`
	CancelledAt    int64  `json:"cancelled_at"`
	CancelReason   string `json:"cancel_reason"`
	ConfirmedQuota int64  `json:"confirmed_quota"`
	PendingQuota   int64  `json:"pending_quota"`
}

// TestPromotionCenter covers what any user sees in the promotion center: the
// earnings leaderboard and their own invitees and rebates, with every
// username masked.
func TestPromotionCenter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("database DSN not configured")
			}
			db, _ := newAuditTestDatabase(t, dialect.kind, dsn)
			setupEpayCallbackDatabase(t, db, common.DatabaseType(dialect.kind))
			require.NoError(t, db.AutoMigrate(&model.AffiliateRebate{}, &model.AffiliateInviteLog{}, &model.UserMessage{}))
			previous := *operation_setting.GetAffiliateRebateSetting()
			*operation_setting.GetAffiliateRebateSetting() = operation_setting.AffiliateRebateSetting{Enabled: true, RatePercent: 10, ConfirmDays: 7}
			t.Cleanup(func() { *operation_setting.GetAffiliateRebateSetting() = previous })
			affiliateLeaderboardCache.Lock()
			affiliateLeaderboardCache.rows = nil
			affiliateLeaderboardCache.Unlock()

			users := []model.User{
				{Id: 910, Username: "alice_inviter", AffCode: "p910", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
				{Id: 911, Username: "bob", AffCode: "p911", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
				{Id: 912, Username: "root_admin", AffCode: "p912", Status: common.UserStatusEnabled, Role: common.RoleAdminUser},
				{Id: 920, Username: "carol", AffCode: "p920", Status: common.UserStatusEnabled, InviterId: 910},
				{Id: 921, Username: "dave_x", AffCode: "p921", Status: common.UserStatusEnabled, InviterId: 910},
				{Id: 922, Username: "e", AffCode: "p922", Status: common.UserStatusEnabled, InviterId: 911},
				{Id: 923, Username: "fiona", AffCode: "p923", Status: common.UserStatusEnabled, InviterId: 912},
				{Id: 924, Username: "张三丰", AffCode: "p924", Status: common.UserStatusEnabled, InviterId: 911},
			}
			for i := range users {
				require.NoError(t, db.Create(&users[i]).Error)
			}
			now := time.Now().Unix()
			lastYear := now - 400*24*3600
			rebates := []model.AffiliateRebate{
				{InviterId: 910, InviteeId: 920, TradeNo: "p-1", Quota: 300, Status: model.AffiliateRebateConfirmed, ConfirmedAt: now},
				{InviterId: 910, InviteeId: 921, TradeNo: "p-2", Quota: 200, Status: model.AffiliateRebateConfirmed, ConfirmedAt: lastYear},
				{InviterId: 910, InviteeId: 920, TradeNo: "p-3", Quota: 50, Status: model.AffiliateRebatePending},
				{InviterId: 910, InviteeId: 921, TradeNo: "p-4", Quota: 70, Status: model.AffiliateRebatePending},
				{InviterId: 911, InviteeId: 922, TradeNo: "p-5", Quota: 400, Status: model.AffiliateRebateConfirmed, ConfirmedAt: now},
				{InviterId: 912, InviteeId: 923, TradeNo: "p-6", Quota: 9000, Status: model.AffiliateRebateConfirmed, ConfirmedAt: now},
			}
			for i := range rebates {
				rebates[i].Source = model.AffiliateRebateSourceTopUp
				require.NoError(t, db.Create(&rebates[i]).Error)
			}
			cancelled, err := model.CancelAffiliateInvite(921, 910, model.AffiliateReasonAdminCancel, nil, 1, "")
			require.NoError(t, err)
			require.True(t, cancelled)

			router := gin.New()
			router.Use(func(c *gin.Context) {
				id, _ := strconv.Atoi(c.GetHeader("X-User"))
				c.Set("id", id)
				c.Next()
			})
			router.GET("/leaderboard", GetAffiliateLeaderboard)
			router.GET("/invitees", GetSelfAffiliateInvitees)
			router.GET("/rebates", GetSelfAffiliateRebates)
			get := func(path string, userId int, out any) string {
				response := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodGet, path, nil)
				request.Header.Set("X-User", strconv.Itoa(userId))
				router.ServeHTTP(response, request)
				var envelope struct {
					Success bool `json:"success"`
					Data    any  `json:"data"`
				}
				envelope.Data = out
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope))
				require.True(t, envelope.Success, response.Body.String())
				return response.Body.String()
			}

			t.Run("leaderboard ranks credited rebates this quarter and masks names", func(t *testing.T) {
				var board struct {
					Rows []promotionEarnings `json:"rows"`
					Me   promotionEarnings   `json:"me"`
				}
				body := get("/leaderboard", 910, &board)
				assert.Equal(t, []promotionEarnings{
					{Rank: 1, Name: "b*b", TotalQuota: 400, MonthQuota: 400, QuarterQuota: 400, PayingInvites: 1},
					{Rank: 2, Name: "a***********r", IsMe: true, TotalQuota: 500, MonthQuota: 300, QuarterQuota: 300, PayingInvites: 2},
				}, board.Rows, "the administrator is not ranked and pending rebates do not count")
				assert.Equal(t, promotionEarnings{Rank: 2, TotalQuota: 500, MonthQuota: 300, QuarterQuota: 300, PayingInvites: 2}, board.Me)
				assert.NotContains(t, body, "alice_inviter")
				assert.NotContains(t, body, "inviter_id")
			})

			t.Run("viewer without earnings is unranked with zero figures", func(t *testing.T) {
				var board struct {
					Rows []promotionEarnings `json:"rows"`
					Me   promotionEarnings   `json:"me"`
				}
				get("/leaderboard", 920, &board)
				assert.Len(t, board.Rows, 2)
				assert.Equal(t, promotionEarnings{}, board.Me)
			})

			t.Run("invitees include cancelled invitations with masked names", func(t *testing.T) {
				var page struct {
					Total int                `json:"total"`
					Items []promotionInvitee `json:"items"`
				}
				body := get("/invitees", 910, &page)
				require.Equal(t, 2, page.Total)
				require.Len(t, page.Items, 2)
				cancelledInvitee := page.Items[0]
				assert.Equal(t, 921, cancelledInvitee.InviteeId)
				assert.Equal(t, "d****x", cancelledInvitee.Name)
				assert.True(t, cancelledInvitee.Cancelled)
				assert.Positive(t, cancelledInvitee.CancelledAt)
				assert.Equal(t, model.AffiliateReasonAdminCancel, cancelledInvitee.CancelReason)
				assert.EqualValues(t, 200, cancelledInvitee.ConfirmedQuota, "credited rebates stay after a cancellation")
				assert.Zero(t, cancelledInvitee.PendingQuota, "the cancellation rejected the pending rebate")
				assert.Equal(t, promotionInvitee{InviteeId: 920, Name: "c***l", ConfirmedQuota: 300, PendingQuota: 50}, page.Items[1])
				assert.NotContains(t, body, "carol")
				assert.NotContains(t, body, "dave_x")
			})

			t.Run("invitees list only the caller's own", func(t *testing.T) {
				var page struct {
					Total int                `json:"total"`
					Items []promotionInvitee `json:"items"`
				}
				get("/invitees", 911, &page)
				assert.Equal(t, 2, page.Total)
				assert.Equal(t, []promotionInvitee{
					{InviteeId: 924, Name: "张*丰"},
					{InviteeId: 922, Name: "*", ConfirmedQuota: 400},
				}, page.Items)
			})

			t.Run("rebate orders show each status with the masked invitee", func(t *testing.T) {
				var rebates struct {
					Page struct {
						Items []struct {
							InviteeName string `json:"invitee_name"`
							Status      string `json:"status"`
							Quota       int    `json:"quota"`
						} `json:"items"`
					} `json:"page"`
				}
				body := get("/rebates", 910, &rebates)
				type row struct {
					name, status string
					quota        int
				}
				got := make([]row, 0, len(rebates.Page.Items))
				for _, item := range rebates.Page.Items {
					got = append(got, row{item.InviteeName, item.Status, item.Quota})
				}
				assert.Equal(t, []row{
					{"d****x", model.AffiliateRebateRejected, 70},
					{"c***l", model.AffiliateRebatePending, 50},
					{"d****x", model.AffiliateRebateConfirmed, 200},
					{"c***l", model.AffiliateRebateConfirmed, 300},
				}, got)
				assert.NotContains(t, body, "trade_no")
				assert.NotContains(t, body, "carol")
			})
		})
	}
}
