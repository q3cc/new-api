package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLotteryFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&LotteryActivity{}, &LotteryPrize{}, &LotteryEntry{}))
	clear := func() {
		for _, table := range []any{&LotteryActivity{}, &LotteryPrize{}, &LotteryEntry{}, &TopUp{}, &UserSubscription{}, &SubscriptionPlan{}, &User{}, &Log{}} {
			// A fresh session per table: a reused one keeps the first table.
			require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(table).Error)
		}
	}
	clear()
	t.Cleanup(clear)
}

func createLotteryUser(t *testing.T, name string) int {
	t.Helper()
	user := &User{Username: name, Password: "password", Status: common.UserStatusEnabled, AffCode: name}
	require.NoError(t, DB.Create(user).Error)
	return user.Id
}

func createLotteryPlan(t *testing.T, maxPurchase int) *SubscriptionPlan {
	t.Helper()
	plan := &SubscriptionPlan{Title: "Lottery Plan", PriceAmount: 9.9, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true, TotalAmount: 1000, MaxPurchasePerUser: maxPurchase}
	require.NoError(t, DB.Create(plan).Error)
	return plan
}

func createPaidOrder(t *testing.T, userId int, money float64, status string, completeTime int64) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{UserId: userId, Money: money, Status: status, CompleteTime: completeTime, TradeNo: fmt.Sprintf("lottery-%d-%d-%v", userId, completeTime, money)}).Error)
}

func userQuota(t *testing.T, userId int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	return user.Quota
}

func TestSumUserPaidMoneyCountsSuccessfulOrdersInWindow(t *testing.T) {
	setupLotteryFixture(t)
	userId := createLotteryUser(t, "lottery_spender")
	otherId := createLotteryUser(t, "lottery_other")
	createPaidOrder(t, userId, 10, common.TopUpStatusSuccess, 1000)
	// Subscription orders are recorded as top-ups with the order money.
	createPaidOrder(t, userId, 5, common.TopUpStatusSuccess, 2000)
	createPaidOrder(t, userId, 100, common.TopUpStatusPending, 1500)
	createPaidOrder(t, userId, 3, common.TopUpStatusSuccess, 9000)
	createPaidOrder(t, otherId, 7, common.TopUpStatusSuccess, 1500)

	tests := []struct {
		name     string
		from, to int64
		want     float64
	}{
		{name: "open window counts every paid order", want: 18},
		{name: "closed window counts orders completed inside it", from: 1000, to: 3000, want: 15},
		{name: "open end counts orders after the start", from: 1500, want: 8},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			paid, err := SumUserPaidMoney(DB, userId, tt.from, tt.to)
			require.NoError(t, err)
			assert.InDelta(t, tt.want, paid, 1e-9)
		})
	}
}

func TestLotteryActivityValidateRejectsInvalidRules(t *testing.T) {
	setupLotteryFixture(t)
	quotaPrize := func(probability, quantity int) LotteryPrize {
		return LotteryPrize{Name: "Credit", Type: LotteryPrizeQuota, Quota: 100, Probability: probability, Quantity: quantity}
	}
	tests := []struct {
		name     string
		activity LotteryActivity
	}{
		{name: "wheel probabilities above 100%", activity: LotteryActivity{Title: "W", Mode: LotteryModeWheel, Status: LotteryStatusActive, Prizes: []LotteryPrize{quotaPrize(6000, 0), quotaPrize(5000, 0)}}},
		{name: "scheduled draw without draw time", activity: LotteryActivity{Title: "S", Mode: LotteryModeScheduled, Status: LotteryStatusActive, Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
		{name: "participant draw without target", activity: LotteryActivity{Title: "P", Mode: LotteryModeParticipants, Status: LotteryStatusActive, Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
		{name: "drawn prize without winners", activity: LotteryActivity{Title: "P", Mode: LotteryModeParticipants, Status: LotteryStatusActive, TargetParticipants: 2, Prizes: []LotteryPrize{quotaPrize(0, 0)}}},
		{name: "subscription prize without plan", activity: LotteryActivity{Title: "W", Mode: LotteryModeWheel, Status: LotteryStatusActive, Prizes: []LotteryPrize{{Name: "Plan", Type: LotteryPrizeSubscription, Probability: 100}}}},
		{name: "no prizes", activity: LotteryActivity{Title: "W", Mode: LotteryModeWheel, Status: LotteryStatusActive}},
		{name: "draw time in the past", activity: LotteryActivity{Title: "S", Mode: LotteryModeScheduled, Status: LotteryStatusActive, DrawTime: 1, Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
		{name: "end time in the past", activity: LotteryActivity{Title: "P", Mode: LotteryModeParticipants, Status: LotteryStatusActive, TargetParticipants: 2, EndTime: 1, Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
		{name: "invitation window ending before it starts", activity: LotteryActivity{Title: "W", Mode: LotteryModeWheel, Status: LotteryStatusActive, MinInvites: 1, InviteStartTime: 5000, InviteEndTime: 1000, Prizes: []LotteryPrize{quotaPrize(0, 0)}}},
		{name: "negative minimum invitations", activity: LotteryActivity{Title: "W", Mode: LotteryModeWheel, Status: LotteryStatusActive, MinInvites: -1, Prizes: []LotteryPrize{quotaPrize(0, 0)}}},
		{name: "rules over 10000 characters", activity: LotteryActivity{Title: "W", Mode: LotteryModeWheel, Status: LotteryStatusActive, Rules: strings.Repeat("规", 10001), Prizes: []LotteryPrize{quotaPrize(0, 0)}}},
		{name: "leaderboard without end time", activity: LotteryActivity{Title: "L", Mode: LotteryModeLeaderboard, Status: LotteryStatusActive, RankMetric: LotteryRankRecharge, Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
		{name: "leaderboard with an unknown metric", activity: LotteryActivity{Title: "L", Mode: LotteryModeLeaderboard, Status: LotteryStatusActive, EndTime: 4102444800, RankMetric: "logins", Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
		{name: "leaderboard prizes beyond 500 ranks", activity: LotteryActivity{Title: "L", Mode: LotteryModeLeaderboard, Status: LotteryStatusActive, EndTime: 4102444800, RankMetric: LotteryRankRecharge, Prizes: []LotteryPrize{quotaPrize(0, 300), quotaPrize(0, 201)}}},
		{name: "leaderboard with a negative threshold", activity: LotteryActivity{Title: "L", Mode: LotteryModeLeaderboard, Status: LotteryStatusActive, EndTime: 4102444800, RankMetric: LotteryRankRecharge, RankMinValue: -1, Prizes: []LotteryPrize{quotaPrize(0, 1)}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Error(t, tt.activity.Validate())
		})
	}
}

func TestListLotteryActivitiesShowsUsersRunningAndRecentFinishedActivities(t *testing.T) {
	setupLotteryFixture(t)
	now := common.GetTimestamp()
	create := func(title string, activity LotteryActivity) {
		activity.Title = title
		require.NoError(t, DB.Omit("Prizes").Create(&activity).Error)
	}
	create("draft", LotteryActivity{Mode: LotteryModeWheel, Status: LotteryStatusDraft})
	create("running wheel", LotteryActivity{Mode: LotteryModeWheel, Status: LotteryStatusActive, EndTime: now + 3600})
	create("closed draw", LotteryActivity{Mode: LotteryModeScheduled, Status: LotteryStatusActive, EndTime: now - 60, DrawTime: now - 60})
	create("ended wheel", LotteryActivity{Mode: LotteryModeWheel, Status: LotteryStatusActive, EndTime: now - 60})
	create("cancelled unentered", LotteryActivity{Mode: LotteryModeWheel, Status: LotteryStatusCancelled})
	create("cancelled entered", LotteryActivity{Mode: LotteryModeParticipants, Status: LotteryStatusCancelled, EntryCount: 1})
	for i := range lotteryHistoryLimit {
		create(fmt.Sprintf("drawn %02d", i), LotteryActivity{Mode: LotteryModeParticipants, Status: LotteryStatusDrawn})
	}

	activities, err := ListLotteryActivities(true)
	require.NoError(t, err)
	titles := make([]string, len(activities))
	for i, activity := range activities {
		titles[i] = activity.Title
	}
	// Running activities come first; a draw waiting for its draw is running.
	assert.Equal(t, []string{"closed draw", "running wheel"}, titles[:2])
	assert.Len(t, titles, 2+lotteryHistoryLimit)
	assert.NotContains(t, titles, "draft")
	assert.NotContains(t, titles, "cancelled unentered")
	// The oldest finished activities fall outside the history limit.
	assert.NotContains(t, titles, "ended wheel")
	assert.NotContains(t, titles, "cancelled entered")

	all, err := ListLotteryActivities(false)
	require.NoError(t, err)
	assert.Len(t, all, 6+lotteryHistoryLimit)
}

func TestListLotteryActivitiesKeepsCancelledEntriesVisible(t *testing.T) {
	setupLotteryFixture(t)
	now := common.GetTimestamp()
	for _, activity := range []LotteryActivity{
		{Title: "ended wheel", Mode: LotteryModeWheel, Status: LotteryStatusActive, EndTime: now - 60},
		{Title: "cancelled entered", Mode: LotteryModeParticipants, Status: LotteryStatusCancelled, EntryCount: 1},
		{Title: "cancelled unentered", Mode: LotteryModeWheel, Status: LotteryStatusCancelled},
	} {
		require.NoError(t, DB.Omit("Prizes").Create(&activity).Error)
	}

	activities, err := ListLotteryActivities(true)
	require.NoError(t, err)
	titles := make([]string, len(activities))
	for i, activity := range activities {
		titles[i] = activity.Title
	}
	assert.Equal(t, []string{"cancelled entered", "ended wheel"}, titles)
}

func TestSpinLotteryWheelEnforcesSpinLimitsAndStock(t *testing.T) {
	setupLotteryFixture(t)
	userId := createLotteryUser(t, "lottery_spinner")
	activity := &LotteryActivity{
		Title: "Wheel", Mode: LotteryModeWheel, Status: LotteryStatusActive,
		WheelTotalLimit: 3, WheelDailyLimit: 2,
		Prizes: []LotteryPrize{{Name: "Credit", Type: LotteryPrizeQuota, Quota: 100, Probability: LotteryProbabilityScale, Quantity: 1}},
	}
	require.NoError(t, CreateLotteryActivity(activity))

	first, err := SpinLotteryWheel(activity.Id, userId)
	require.NoError(t, err)
	assert.Equal(t, activity.Prizes[0].Id, first.PrizeId)
	assert.Equal(t, LotteryDeliveryDelivered, first.DeliveryStatus)
	assert.Equal(t, 100, userQuota(t, userId))

	// The only prize is out of stock, so a certain hit wins nothing.
	second, err := SpinLotteryWheel(activity.Id, userId)
	require.NoError(t, err)
	assert.Zero(t, second.PrizeId)
	assert.Equal(t, 100, userQuota(t, userId))

	_, err = SpinLotteryWheel(activity.Id, userId)
	assert.ErrorContains(t, err, "spins for today")

	require.NoError(t, DB.Model(&LotteryEntry{}).Where("activity_id = ?", activity.Id).Update("spin_date", "2000-01-01").Error)
	_, err = SpinLotteryWheel(activity.Id, userId)
	require.NoError(t, err)
	_, err = SpinLotteryWheel(activity.Id, userId)
	assert.ErrorContains(t, err, "spins for this activity")

	var stored LotteryActivity
	require.NoError(t, DB.First(&stored, activity.Id).Error)
	assert.Equal(t, 3, stored.EntryCount)
}

func TestSpinLotteryWheelRequiresSpendingInWindow(t *testing.T) {
	setupLotteryFixture(t)
	userId := createLotteryUser(t, "lottery_buyer")
	activity := &LotteryActivity{
		Title: "Wheel", Mode: LotteryModeWheel, Status: LotteryStatusActive,
		MinSpend: 10, SpendStartTime: 1000, SpendEndTime: 5000,
		Prizes: []LotteryPrize{{Name: "Credit", Type: LotteryPrizeQuota, Quota: 100, Probability: 0}},
	}
	require.NoError(t, CreateLotteryActivity(activity))
	createPaidOrder(t, userId, 50, common.TopUpStatusSuccess, 6000)

	_, err := SpinLotteryWheel(activity.Id, userId)
	assert.ErrorContains(t, err, "spending requirement")

	createPaidOrder(t, userId, 10, common.TopUpStatusSuccess, 3000)
	entry, err := SpinLotteryWheel(activity.Id, userId)
	require.NoError(t, err)
	assert.Zero(t, entry.PrizeId, "a prize with probability 0 is never won")
}

func TestSpinLotteryWheelRequiresInvitationsInWindow(t *testing.T) {
	setupLotteryFixture(t)
	inviterId := createLotteryUser(t, "lottery_inviter")
	invite := func(name string, createdAt int64) *User {
		user := &User{Username: name, Password: "password", Status: common.UserStatusEnabled, AffCode: name, InviterId: inviterId, CreatedAt: createdAt}
		require.NoError(t, DB.Create(user).Error)
		return user
	}
	invite("in_window", 2000)
	invite("after_window", 9000)
	require.NoError(t, DB.Delete(invite("deleted_in_window", 3000)).Error)
	cancelled := invite("cancelled_in_window", 3000)
	require.NoError(t, DB.Model(cancelled).Update("inviter_id", 0).Error)
	activity := &LotteryActivity{
		Title: "Wheel", Mode: LotteryModeWheel, Status: LotteryStatusActive,
		MinSpend: 10, MinInvites: 2, InviteStartTime: 1000, InviteEndTime: 5000,
		Prizes: []LotteryPrize{{Name: "Credit", Type: LotteryPrizeQuota, Quota: 100, Probability: 0}},
	}
	require.NoError(t, CreateLotteryActivity(activity))

	state, err := GetLotteryUserState(DB, activity, inviterId)
	require.NoError(t, err)
	assert.EqualValues(t, 1, state.Invited, "only current, undeleted invitees registered in the window count")
	assert.False(t, state.Eligible)

	_, err = SpinLotteryWheel(activity.Id, inviterId)
	assert.ErrorContains(t, err, "spending requirement", "both requirements apply")

	createPaidOrder(t, inviterId, 10, common.TopUpStatusSuccess, 3000)
	_, err = SpinLotteryWheel(activity.Id, inviterId)
	assert.ErrorContains(t, err, "invitation requirement")

	invite("second_in_window", 5000)
	_, err = SpinLotteryWheel(activity.Id, inviterId)
	require.NoError(t, err)
}

func TestParticipantLotteryDrawsWhenTargetIsReached(t *testing.T) {
	setupLotteryFixture(t)
	plan := createLotteryPlan(t, 0)
	activity := &LotteryActivity{
		Title: "Crowd", Mode: LotteryModeParticipants, Status: LotteryStatusActive, TargetParticipants: 3,
		Prizes: []LotteryPrize{
			{Name: "Plan", Type: LotteryPrizeSubscription, PlanId: plan.Id, Quantity: 1},
			{Name: "Mug", Type: LotteryPrizeManual, Quantity: 5},
		},
	}
	require.NoError(t, CreateLotteryActivity(activity))
	users := []int{createLotteryUser(t, "crowd_a"), createLotteryUser(t, "crowd_b"), createLotteryUser(t, "crowd_c")}

	require.NoError(t, JoinLotteryActivity(activity.Id, users[0]))
	assert.ErrorContains(t, JoinLotteryActivity(activity.Id, users[0]), "already joined")
	require.NoError(t, JoinLotteryActivity(activity.Id, users[1]))
	require.NoError(t, JoinLotteryActivity(activity.Id, users[2]))

	drawn, err := GetLotteryActivity(activity.Id)
	require.NoError(t, err)
	assert.Equal(t, LotteryStatusDrawn, drawn.Status)
	assert.Equal(t, 1, drawn.Prizes[0].Awarded)
	assert.Equal(t, 2, drawn.Prizes[1].Awarded)

	var entries []LotteryEntry
	require.NoError(t, DB.Where("activity_id = ?", activity.Id).Find(&entries).Error)
	require.Len(t, entries, 3)
	byType := map[string][]LotteryEntry{}
	for _, entry := range entries {
		byType[entry.PrizeType] = append(byType[entry.PrizeType], entry)
	}
	require.Len(t, byType[LotteryPrizeSubscription], 1)
	require.Len(t, byType[LotteryPrizeManual], 2)
	subscriptionWinner := byType[LotteryPrizeSubscription][0]
	assert.Equal(t, LotteryDeliveryDelivered, subscriptionWinner.DeliveryStatus)
	var subs []UserSubscription
	require.NoError(t, DB.Where("user_id = ?", subscriptionWinner.UserId).Find(&subs).Error)
	require.Len(t, subs, 1)
	assert.Equal(t, "lottery", subs[0].Source)

	winners, winnerCount, err := ListLotteryWinners(activity.Id, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 3, winnerCount)
	require.Len(t, winners, 2, "the list is capped while the count covers every win")
	for _, winner := range winners {
		assert.Contains(t, users, winner.UserId)
		assert.NotZero(t, winner.PrizeId)
	}

	manual := byType[LotteryPrizeManual][0]
	assert.Equal(t, LotteryDeliveryPending, manual.DeliveryStatus)
	// Manual prizes are never delivered automatically and stay pending.
	assert.ErrorContains(t, DeliverLotteryEntry(manual.Id), "no prize to deliver automatically")
	require.NoError(t, DB.First(&manual, manual.Id).Error)
	assert.Equal(t, LotteryDeliveryPending, manual.DeliveryStatus)
	require.NoError(t, MarkLotteryEntryDelivered(manual.Id, "shipped"))
	assert.Error(t, MarkLotteryEntryDelivered(manual.Id, "again"))

	// Drawing again changes nothing, and the activity takes no more entries.
	require.NoError(t, DrawLotteryActivity(activity.Id))
	require.NoError(t, DB.Where("user_id = ?", subscriptionWinner.UserId).Find(&subs).Error)
	assert.Len(t, subs, 1)
	assert.ErrorContains(t, JoinLotteryActivity(activity.Id, createLotteryUser(t, "crowd_late")), "not open")
}

func TestJoinLotteryActivityRefusesFullActivityBeforeItIsDrawn(t *testing.T) {
	setupLotteryFixture(t)
	activity := &LotteryActivity{
		Title: "Crowd", Mode: LotteryModeParticipants, Status: LotteryStatusActive, TargetParticipants: 2,
		Prizes: []LotteryPrize{{Name: "Mug", Type: LotteryPrizeManual, Quantity: 1}},
	}
	require.NoError(t, CreateLotteryActivity(activity))
	require.NoError(t, JoinLotteryActivity(activity.Id, createLotteryUser(t, "full_a")))
	// The last entry has committed but the draw has not run yet.
	require.NoError(t, DB.Model(&LotteryActivity{}).Where("id = ?", activity.Id).Update("entry_count", 2).Error)

	err := JoinLotteryActivity(activity.Id, createLotteryUser(t, "full_late"))
	assert.ErrorContains(t, err, "full")

	var stored LotteryActivity
	require.NoError(t, DB.First(&stored, activity.Id).Error)
	assert.Equal(t, 2, stored.EntryCount)
	assert.Equal(t, LotteryStatusActive, stored.Status)
	var entries int64
	require.NoError(t, DB.Model(&LotteryEntry{}).Where("activity_id = ?", activity.Id).Count(&entries).Error)
	assert.EqualValues(t, 1, entries)
}

func TestRunDueLotteryDrawsDrawsScheduledActivityWithFewerEntrantsThanPrizes(t *testing.T) {
	setupLotteryFixture(t)
	now := common.GetTimestamp()
	activity := &LotteryActivity{
		Title: "Timed", Mode: LotteryModeScheduled, Status: LotteryStatusActive, DrawTime: now + 3600,
		Prizes: []LotteryPrize{{Name: "Credit", Type: LotteryPrizeQuota, Quota: 300, Quantity: 2}},
	}
	require.NoError(t, CreateLotteryActivity(activity))
	userId := createLotteryUser(t, "timed_user")
	require.NoError(t, JoinLotteryActivity(activity.Id, userId))
	// A participant-count draw short of its target must survive the same sweep.
	waiting := &LotteryActivity{
		Title: "Waiting", Mode: LotteryModeParticipants, Status: LotteryStatusActive, TargetParticipants: 5,
		Prizes: []LotteryPrize{{Name: "Mug", Type: LotteryPrizeManual, Quantity: 1}},
	}
	require.NoError(t, CreateLotteryActivity(waiting))
	require.NoError(t, JoinLotteryActivity(waiting.Id, createLotteryUser(t, "waiting_user")))

	require.NoError(t, RunDueLotteryDraws())
	pending, err := GetLotteryActivity(activity.Id)
	require.NoError(t, err)
	assert.Equal(t, LotteryStatusActive, pending.Status, "not drawn before the draw time")

	require.NoError(t, DB.Model(&LotteryActivity{}).Where("id = ?", activity.Id).Update("draw_time", now-1).Error)
	require.NoError(t, RunDueLotteryDraws())
	drawn, err := GetLotteryActivity(activity.Id)
	require.NoError(t, err)
	assert.Equal(t, LotteryStatusDrawn, drawn.Status)
	assert.Equal(t, 1, drawn.Prizes[0].Awarded)
	assert.Equal(t, 300, userQuota(t, userId))

	stillWaiting, err := GetLotteryActivity(waiting.Id)
	require.NoError(t, err)
	assert.Equal(t, LotteryStatusActive, stillWaiting.Status)
}

func TestDeliverLotteryEntryRecordsFailureForRetry(t *testing.T) {
	setupLotteryFixture(t)
	plan := createLotteryPlan(t, 1)
	userId := createLotteryUser(t, "limited_user")
	require.NoError(t, DB.Create(&UserSubscription{UserId: userId, PlanId: plan.Id, Status: "active", EndTime: common.GetTimestamp() + 3600}).Error)
	activity := &LotteryActivity{
		Title: "Wheel", Mode: LotteryModeWheel, Status: LotteryStatusActive,
		Prizes: []LotteryPrize{{Name: "Plan", Type: LotteryPrizeSubscription, PlanId: plan.Id, Probability: LotteryProbabilityScale}},
	}
	require.NoError(t, CreateLotteryActivity(activity))

	entry, err := SpinLotteryWheel(activity.Id, userId)
	require.NoError(t, err, "a failed delivery does not undo the win")
	assert.Equal(t, LotteryDeliveryFailed, entry.DeliveryStatus)
	assert.Equal(t, "Purchase limit for this plan has been reached", entry.DeliveryNote)

	require.NoError(t, DB.Where("user_id = ?", userId).Delete(&UserSubscription{}).Error)
	require.NoError(t, DeliverLotteryEntry(entry.Id))
	require.NoError(t, DB.First(entry, entry.Id).Error)
	assert.Equal(t, LotteryDeliveryDelivered, entry.DeliveryStatus)
	assert.ErrorContains(t, DeliverLotteryEntry(entry.Id), "already been delivered")
}

func TestLotteryActivityRulesLockAfterFirstEntry(t *testing.T) {
	setupLotteryFixture(t)
	activity := &LotteryActivity{
		Title: "Wheel", Mode: LotteryModeWheel, Status: LotteryStatusActive,
		Prizes: []LotteryPrize{{Name: "Credit", Type: LotteryPrizeQuota, Quota: 100, Probability: 100}},
	}
	require.NoError(t, CreateLotteryActivity(activity))
	_, err := SpinLotteryWheel(activity.Id, createLotteryUser(t, "first_spinner"))
	require.NoError(t, err)

	update := &LotteryActivity{
		Id: activity.Id, Title: "Renamed", Rules: "## Updated rules", Mode: LotteryModeParticipants, Status: LotteryStatusActive, TargetParticipants: 9,
		Prizes: []LotteryPrize{{Name: "Other", Type: LotteryPrizeManual, Quantity: 1}},
	}
	require.NoError(t, UpdateLotteryActivity(update))
	stored, err := GetLotteryActivity(activity.Id)
	require.NoError(t, err)
	assert.Equal(t, "Renamed", stored.Title)
	assert.Equal(t, "## Updated rules", stored.Rules, "the rules text can still be corrected")
	assert.Equal(t, LotteryModeWheel, stored.Mode)
	require.Len(t, stored.Prizes, 1)
	assert.Equal(t, "Credit", stored.Prizes[0].Name)

	assert.ErrorContains(t, DeleteLotteryActivity(activity.Id), "cannot be deleted")
	require.NoError(t, CancelLotteryActivity(activity.Id))
	_, err = SpinLotteryWheel(activity.Id, createLotteryUser(t, "late_spinner"))
	assert.ErrorContains(t, err, "not open")
}

func TestLeaderboardRankingByMetric(t *testing.T) {
	setupLotteryFixture(t)
	alice := createLotteryUser(t, "rank_alice")
	bob := createLotteryUser(t, "rank_bob")
	carol := createLotteryUser(t, "rank_carol")
	admin := &User{Username: "rank_admin", Password: "password", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AffCode: "rank_admin"}
	require.NoError(t, DB.Create(admin).Error)
	disabled := &User{Username: "rank_disabled", Password: "password", Status: common.UserStatusDisabled, AffCode: "rank_disabled"}
	require.NoError(t, DB.Create(disabled).Error)
	invite := func(inviterId int, name string, createdAt int64) *User {
		user := &User{Username: name, Password: "password", Status: common.UserStatusEnabled, AffCode: name, InviterId: inviterId, CreatedAt: createdAt}
		require.NoError(t, DB.Create(user).Error)
		return user
	}
	consume := func(userId int, logType int, quota int, createdAt int64) {
		require.NoError(t, DB.Create(&Log{UserId: userId, Type: logType, Quota: quota, CreatedAt: createdAt}).Error)
	}

	// Recharge: equal totals rank whoever reached them first higher.
	createPaidOrder(t, alice, 30, common.TopUpStatusSuccess, 2000)
	createPaidOrder(t, bob, 30, common.TopUpStatusSuccess, 1500)
	createPaidOrder(t, carol, 3, common.TopUpStatusSuccess, 2000)
	createPaidOrder(t, alice, 100, common.TopUpStatusSuccess, 6000)
	createPaidOrder(t, alice, 100, common.TopUpStatusPending, 2000)
	createPaidOrder(t, admin.Id, 500, common.TopUpStatusSuccess, 2000)
	createPaidOrder(t, disabled.Id, 500, common.TopUpStatusSuccess, 2000)
	// Invitations: deleted invitees and accounts outside the window do not count.
	invite(alice, "inv_a1", 2000)
	invite(alice, "inv_a2", 3000)
	require.NoError(t, DB.Delete(invite(alice, "inv_a3", 3500)).Error)
	invite(alice, "inv_a4", 9000)
	invite(bob, "inv_b1", 1500)
	invite(bob, "inv_b2", 2500)
	invite(carol, "inv_c1", 2000)
	for i := range 5 {
		invite(admin.Id, fmt.Sprintf("inv_admin_%d", i), 2000)
	}
	// Consumption: only consume logs inside the window count.
	consume(alice, LogTypeConsume, 500, 2000)
	consume(bob, LogTypeConsume, 300, 2500)
	consume(carol, LogTypeConsume, 50, 2000)
	consume(carol, LogTypeTopup, 100000, 2000)
	consume(bob, LogTypeConsume, 100000, 9000)

	tests := []struct {
		metric    string
		threshold float64
		want      []LeaderboardRow
		carol     float64
	}{
		{metric: LotteryRankRecharge, threshold: 5, want: []LeaderboardRow{{UserId: bob, Rank: 1, Score: 30}, {UserId: alice, Rank: 2, Score: 30}}, carol: 3},
		{metric: LotteryRankInvites, threshold: 2, want: []LeaderboardRow{{UserId: bob, Rank: 1, Score: 2}, {UserId: alice, Rank: 2, Score: 2}}, carol: 1},
		{metric: LotteryRankConsumption, threshold: 100, want: []LeaderboardRow{{UserId: alice, Rank: 1, Score: 500}, {UserId: bob, Rank: 2, Score: 300}}, carol: 50},
	}
	for _, tt := range tests {
		t.Run(tt.metric, func(t *testing.T) {
			activity := &LotteryActivity{Id: 900, Mode: LotteryModeLeaderboard, Status: LotteryStatusActive,
				StartTime: 1000, EndTime: 5000, RankMetric: tt.metric, RankMinValue: tt.threshold}
			rows, err := LeaderboardRanking(activity, 10)
			require.NoError(t, err)
			for i := range rows {
				rows[i].ReachedAt = 0
			}
			assert.Equal(t, tt.want, rows)

			leaderboardCache.Delete(activity.Id)
			board, err := GetLotteryLeaderboard(activity, carol)
			require.NoError(t, err)
			assert.Zero(t, board.Me.Rank, "below the threshold is not ranked")
			assert.InDelta(t, tt.carol, board.Me.Score, 1e-9, "an unranked user still sees their score")
			board, err = GetLotteryLeaderboard(activity, admin.Id)
			require.NoError(t, err)
			assert.True(t, board.Me.Excluded, "administrators are not ranked")
		})
	}
}

func TestLeaderboardLocksRanksAndAwardsQualifiedEntries(t *testing.T) {
	setupLotteryFixture(t)
	users := []int{createLotteryUser(t, "lb_1"), createLotteryUser(t, "lb_2"), createLotteryUser(t, "lb_3"), createLotteryUser(t, "lb_4")}
	require.NoError(t, DB.Model(&User{}).Where("id = ?", users[0]).Update("display_name", "Nick lb_1").Error)
	for i, userId := range users {
		createPaidOrder(t, userId, float64(40-10*i), common.TopUpStatusSuccess, 2000)
	}
	activity := &LotteryActivity{Title: "Recharge board", Mode: LotteryModeLeaderboard, Status: LotteryStatusActive,
		StartTime: 1000, EndTime: common.GetTimestamp() + 3600, RankMetric: LotteryRankRecharge,
		Prizes: []LotteryPrize{
			{Name: "First", Type: LotteryPrizeQuota, Quota: 100, Quantity: 1},
			{Name: "Runner-up", Type: LotteryPrizeQuota, Quota: 50, Quantity: 2},
		}}
	require.NoError(t, CreateLotteryActivity(activity))

	require.Error(t, SetLeaderboardEntryDisqualified(1, true), "nothing can be disqualified while running")
	assert.Error(t, JoinLotteryActivity(activity.Id, users[0]), "leaderboards take no entries")

	// The end time passes; the minute task locks the ranks once.
	require.NoError(t, DB.Model(&LotteryActivity{}).Where("id = ?", activity.Id).Update("end_time", common.GetTimestamp()-1).Error)
	require.NoError(t, RunDueLotteryDraws())
	require.NoError(t, LockLeaderboard(activity.Id))
	var entries []LotteryEntry
	require.NoError(t, DB.Where("activity_id = ?", activity.Id).Order("ranking").Find(&entries).Error)
	require.Len(t, entries, 4)
	for i, entry := range entries {
		assert.Equal(t, users[i], entry.UserId)
		assert.Equal(t, i+1, entry.Rank)
		assert.InDelta(t, float64(40-10*i), entry.Score, 1e-9)
	}
	stored, err := GetLotteryActivity(activity.Id)
	require.NoError(t, err)
	assert.Equal(t, LotteryStatusRanked, stored.Status)
	wins, err := ListUserLotteryWins(users[0], 10)
	require.NoError(t, err)
	assert.Empty(t, wins, "nothing is won before the awards")

	// Disqualifying second place moves fourth place into the prizes.
	secondPlace := entries[1]
	require.NoError(t, SetLeaderboardEntryDisqualified(secondPlace.Id, true))
	predicted, err := PredictLeaderboardPrizes(activity.Id)
	require.NoError(t, err)
	predictedNames := map[int]string{}
	for entryId, prize := range predicted {
		predictedNames[entryId] = prize.Name
	}
	assert.Equal(t, map[int]string{entries[0].Id: "First", entries[2].Id: "Runner-up", entries[3].Id: "Runner-up"}, predictedNames)
	board, err := GetLotteryLeaderboard(stored, users[3])
	require.NoError(t, err)
	assert.True(t, board.Final)
	assert.Equal(t, []int{users[0], users[2], users[3]}, []int{board.Rows[0].UserId, board.Rows[1].UserId, board.Rows[2].UserId})
	assert.Equal(t, "Nick lb_1", board.Rows[0].DisplayName, "public rows name users by nickname")
	assert.Equal(t, 3, board.Me.Rank, "ranks close up over disqualified entries")

	require.NoError(t, AwardLeaderboard(activity.Id))
	assert.Equal(t, 100, userQuota(t, users[0]))
	assert.Equal(t, 0, userQuota(t, users[1]))
	assert.Equal(t, 50, userQuota(t, users[2]))
	assert.Equal(t, 50, userQuota(t, users[3]))
	assert.Error(t, AwardLeaderboard(activity.Id), "prizes are awarded once")
	assert.Error(t, SetLeaderboardEntryDisqualified(secondPlace.Id, false), "qualifications are fixed after the awards")
	wins, err = ListUserLotteryWins(users[3], 10)
	require.NoError(t, err)
	require.Len(t, wins, 1)
	assert.Equal(t, LotteryDeliveryDelivered, wins[0].DeliveryStatus)
}
