package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

var testUserRiskSetting = operation_setting.UserRiskSetting{
	Enabled: true, WindowDays: 30, SharedIpScore: 10, SameSubnetScore: 2,
	MultiIpThreshold: 2, MultiIpScore: 1, MaxScore: 25,
}

type userRiskExpectation struct {
	score, shared, subnet, ips int
	sharedWith, subnetWith     []int
}

func TestComputeUserRiskScores(t *testing.T) {
	pairs := []model.UserIpPair{
		// 1 and 2 share an exact IPv4; 3 is only in the same /24.
		{UserId: 1, Ip: "203.0.113.10"}, {UserId: 2, Ip: "203.0.113.10"}, {UserId: 3, Ip: "203.0.113.77"},
		// 1 also shares an exact IP with 2 again (counted once) and an IPv6 /64 with 4.
		{UserId: 1, Ip: "198.51.100.1"}, {UserId: 2, Ip: "198.51.100.1"},
		{UserId: 1, Ip: "2001:db8:1:2::1"}, {UserId: 4, Ip: "2001:db8:1:2::99"},
		// 4-in-6 notation is the same IPv4 client as user 3 (and in the /24 of 1 and 2).
		{UserId: 4, Ip: "::ffff:203.0.113.77"},
		// Non-public addresses are ignored.
		{UserId: 5, Ip: "10.0.0.1"}, {UserId: 6, Ip: "10.0.0.1"}, {UserId: 5, Ip: "127.0.0.1"}, {UserId: 6, Ip: "fe80::1"},
		// Deleted user 7 neither scores nor makes 8 look shared; invalid IPs are skipped.
		{UserId: 7, Ip: "192.0.2.5"}, {UserId: 8, Ip: "192.0.2.5"}, {UserId: 8, Ip: "not-an-ip"},
	}
	// User 9 uses many distinct IPs and hits the score cap.
	for _, ip := range []string{"8.8.8.1", "8.8.9.1", "8.8.10.1", "8.8.11.1"} {
		pairs = append(pairs, model.UserIpPair{UserId: 9, Ip: ip})
	}
	for i := range 3 {
		pairs = append(pairs, model.UserIpPair{UserId: 10 + i, Ip: "8.8.8.1"})
	}

	scores := ComputeUserRiskScores(pairs, []int{1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12}, testUserRiskSetting, 1000)

	byUser := make(map[int]model.UserRiskScore, len(scores))
	for _, score := range scores {
		byUser[score.UserId] = score
	}
	assert.NotContains(t, byUser, 5, "private-only users get no row")
	assert.NotContains(t, byUser, 6)
	assert.NotContains(t, byUser, 7, "deleted users get no row")

	cases := map[int]userRiskExpectation{
		1: {score: 10 + 2*2 + 1, shared: 1, subnet: 2, ips: 3, sharedWith: []int{2}, subnetWith: []int{3, 4}},
		2: {score: 10 + 2*2, shared: 1, subnet: 2, ips: 2, sharedWith: []int{1}, subnetWith: []int{3, 4}},
		3: {score: 10 + 2*2, shared: 1, subnet: 2, ips: 1, sharedWith: []int{4}, subnetWith: []int{1, 2}},
		8: {score: 0, ips: 1},
		9: {score: 25, shared: 3, ips: 4, sharedWith: []int{10, 11, 12}},
	}
	for userId, want := range cases {
		got := byUser[userId]
		assert.Equalf(t, want.score, got.Score, "user %d score", userId)
		assert.Equalf(t, want.shared, got.SharedIpUsers, "user %d shared", userId)
		assert.Equalf(t, want.subnet, got.SameSubnetUsers, "user %d subnet", userId)
		assert.Equalf(t, want.ips, got.IpCount, "user %d ip count", userId)
		var details model.UserRiskDetails
		require.NoError(t, common.UnmarshalJsonStr(got.Details, &details))
		assert.ElementsMatchf(t, want.sharedWith, relationIds(details.SharedIp), "user %d shared with", userId)
		assert.ElementsMatchf(t, want.subnetWith, relationIds(details.SameSubnet), "user %d subnet with", userId)
	}

	var details model.UserRiskDetails
	require.NoError(t, common.UnmarshalJsonStr(byUser[1].Details, &details))
	require.Len(t, details.SharedIp, 1)
	assert.Equal(t, []string{"198.51.100.1", "203.0.113.10"}, details.SharedIp[0].Matches)
	assert.Equal(t, model.UserRiskRelation{UserId: 4, Matches: []string{"2001:db8:1:2::/64", "203.0.113.0/24"}}, details.SameSubnet[0],
		"accounts overlapping in more ranges come first")
}

func relationIds(relations []model.UserRiskRelation) []int {
	ids := []int{}
	for _, relation := range relations {
		ids = append(ids, relation.UserId)
	}
	return ids
}

func TestFindSharedIpInvites(t *testing.T) {
	pairs := []model.UserIpPair{
		// 1 invited 2; they share two public IPs (one in 4-in-6 notation).
		{UserId: 1, Ip: "203.0.113.10"}, {UserId: 2, Ip: "::ffff:203.0.113.10"},
		{UserId: 1, Ip: "198.51.100.1"}, {UserId: 2, Ip: "198.51.100.1"},
		// 3 invited 4; they only share private and loopback addresses.
		{UserId: 3, Ip: "10.0.0.1"}, {UserId: 4, Ip: "10.0.0.1"}, {UserId: 3, Ip: "127.0.0.1"}, {UserId: 4, Ip: "127.0.0.1"},
		// 5 invited 6; 6 shares an IP with 1, who is not their inviter.
		{UserId: 5, Ip: "192.0.2.5"}, {UserId: 6, Ip: "203.0.113.10"},
	}
	invites := []model.AffiliateInvitePair{
		{InviteeId: 2, InviterId: 1},
		{InviteeId: 4, InviterId: 3},
		{InviteeId: 6, InviterId: 5},
		{InviteeId: 8, InviterId: 7},
	}

	matches := FindSharedIpInvites(pairs, invites)

	assert.Equal(t, []SharedIpInvite{
		{AffiliateInvitePair: model.AffiliateInvitePair{InviteeId: 2, InviterId: 1}, Ips: []string{"198.51.100.1", "203.0.113.10"}},
	}, matches)
	assert.Empty(t, FindSharedIpInvites(pairs, nil))
}

func TestRunUserRiskScoreOnceReplacesPreviousRound(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousSetting := *operation_setting.GetUserRiskSetting()
	previousRebateSetting := *operation_setting.GetAffiliateRebateSetting()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.AuditLog{}, &model.UserRiskScore{}, &model.AffiliateRebate{}, &model.AffiliateInviteLog{}))
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		*operation_setting.GetUserRiskSetting() = previousSetting
		*operation_setting.GetAffiliateRebateSetting() = previousRebateSetting
		_ = sqlDB.Close()
	})
	*operation_setting.GetUserRiskSetting() = testUserRiskSetting
	operation_setting.GetAffiliateRebateSetting().CancelSharedIp = true

	// risk-a invited risk-b, and the two share an IP below.
	require.NoError(t, db.Create(&model.User{Username: "risk-a", Password: "password", AffCode: "risk-a", AffCount: 1}).Error)
	require.NoError(t, db.Create(&model.User{Username: "risk-b", Password: "password", AffCode: "risk-b", InviterId: 1}).Error)
	require.NoError(t, db.Create(&model.User{Username: "risk-c", Password: "password", AffCode: "risk-c"}).Error)
	now := common.GetTimestamp()
	require.NoError(t, db.Create(&model.AuditLog{EventId: "risk-1", UserId: 1, CreatedAt: now, Ip: "203.0.113.10"}).Error)
	require.NoError(t, db.Create([]*model.Log{
		{UserId: 2, Type: model.LogTypeConsume, CreatedAt: now, Ip: "203.0.113.10"},
		{UserId: 3, Type: model.LogTypeTopup, CreatedAt: now, Ip: "203.0.113.10"},
		{UserId: 3, Type: model.LogTypeConsume, CreatedAt: now - 40*24*3600, Ip: "203.0.113.10"},
	}).Error)

	runUserRiskScoreOnce()
	users := []*model.User{{Id: 1}, {Id: 2}, {Id: 3}}
	require.NoError(t, model.AttachUserRiskScores(users))
	assert.Equal(t, 10, users[0].RiskScore.Score)
	assert.Equal(t, 10, users[1].RiskScore.Score)
	assert.Equal(t, 0, users[2].RiskScore.Score, "top-up callers and stale logs do not count")
	var invitee model.User
	require.NoError(t, db.First(&invitee, 2).Error)
	assert.Zero(t, invitee.InviterId, "an invitation between accounts sharing an IP is cancelled")
	var inviteLogs []model.AffiliateInviteLog
	require.NoError(t, db.Find(&inviteLogs).Error)
	require.Len(t, inviteLogs, 1)
	assert.Equal(t, model.AffiliateInviteActionCancel, inviteLogs[0].Action)
	assert.Equal(t, "203.0.113.10", inviteLogs[0].SharedIps)

	require.NoError(t, db.Delete(&model.User{}, 2).Error)
	runUserRiskScoreOnce()
	require.NoError(t, model.AttachUserRiskScores(users))
	assert.Equal(t, 0, users[0].RiskScore.Score, "a deleted partner no longer counts after the next round")
	var rows int64
	require.NoError(t, db.Model(&model.UserRiskScore{}).Count(&rows).Error)
	assert.EqualValues(t, 1, rows, "the previous round is replaced, not accumulated")
}
