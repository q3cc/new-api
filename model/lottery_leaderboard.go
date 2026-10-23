package model

import (
	"errors"
	"sync"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	LotteryRankInvites     = "invites"
	LotteryRankConsumption = "consumption"
	LotteryRankRecharge    = "recharge"

	// maxLeaderboardRanks caps the ranks all prizes of a leaderboard cover.
	maxLeaderboardRanks = 500
	// leaderboardLockLimit is how many ranks are locked when a leaderboard
	// ends, leaving room for ranks to move up after disqualifications.
	leaderboardLockLimit   = 1000
	maxLeaderboardMinValue = 1e12
	// Public leaderboards list at least this many ranks, and at most the cap.
	leaderboardPublicMin = 10
	leaderboardPublicMax = 50
	// A running leaderboard is recomputed at most this often.
	leaderboardCacheSeconds = 60
)

var lotteryRankMetrics = []string{LotteryRankInvites, LotteryRankConsumption, LotteryRankRecharge}

// LeaderboardRow is one ranked user. ReachedAt is when the user last added to
// their score; equal scores rank whoever reached them first higher.
type LeaderboardRow struct {
	UserId int `json:"user_id"`
	// DisplayName is the user's public nickname, set on the public rows.
	DisplayName string  `json:"display_name" gorm:"-"`
	Rank        int     `json:"rank"`
	Score       float64 `json:"score"`
	ReachedAt   int64   `json:"-"`
}

// leaderboardWindow is the period a leaderboard counts. Without a start time
// it counts from when the activity was created.
func (a *LotteryActivity) leaderboardWindow() (int64, int64) {
	start := a.StartTime
	if start == 0 {
		start = a.CreatedAt
	}
	return start, a.EndTime
}

// leaderboardExcludedUserIds lists the accounts that are never ranked:
// administrators and disabled or deleted accounts.
func leaderboardExcludedUserIds() ([]int, error) {
	var ids []int
	err := DB.Unscoped().Model(&User{}).
		Where("role >= ? OR status <> ? OR deleted_at IS NOT NULL", common.RoleAdminUser, common.UserStatusEnabled).
		Pluck("id", &ids).Error
	return ids, err
}

// leaderboardScores builds the score query of a leaderboard. userColumn is the
// column naming the ranked user.
func leaderboardScores(activity *LotteryActivity) (query *gorm.DB, userColumn string, err error) {
	from, to := activity.leaderboardWindow()
	switch activity.RankMetric {
	case LotteryRankInvites:
		// Same rule as the invitation requirement: current invitations of
		// accounts that still exist.
		return DB.Model(&User{}).
			Select("inviter_id AS user_id, COUNT(*) AS score, MAX(created_at) AS reached_at").
			Where("inviter_id <> 0 AND created_at >= ? AND created_at <= ?", from, to).
			Group("inviter_id"), "inviter_id", nil
	case LotteryRankRecharge:
		return DB.Model(&TopUp{}).
			Select("user_id, SUM(money) AS score, MAX(complete_time) AS reached_at").
			Where("status = ? AND complete_time >= ? AND complete_time <= ?", common.TopUpStatusSuccess, from, to).
			Group("user_id"), "user_id", nil
	case LotteryRankConsumption:
		return LOG_DB.Model(&Log{}).
			Select("user_id, SUM(quota) AS score, MAX(created_at) AS reached_at").
			Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, from, to).
			Group("user_id"), "user_id", nil
	}
	return nil, "", common.NewMessage("Invalid ranking metric")
}

// leaderboardScoreExpr is the aggregate a metric scores with, for HAVING:
// PostgreSQL does not accept output aliases there.
func leaderboardScoreExpr(metric string) string {
	switch metric {
	case LotteryRankInvites:
		return "COUNT(*)"
	case LotteryRankRecharge:
		return "SUM(money)"
	}
	return "SUM(quota)"
}

// LeaderboardRanking computes the current ranking of a leaderboard: users at
// or above its threshold with a positive score, best first, at most limit.
func LeaderboardRanking(activity *LotteryActivity, limit int) ([]LeaderboardRow, error) {
	query, userColumn, err := leaderboardScores(activity)
	if err != nil {
		return nil, err
	}
	excluded, err := leaderboardExcludedUserIds()
	if err != nil {
		return nil, err
	}
	if len(excluded) > 0 {
		query = query.Where(userColumn+" NOT IN ?", excluded)
	}
	score := leaderboardScoreExpr(activity.RankMetric)
	rows := []LeaderboardRow{}
	err = query.Having(score+" > 0 AND "+score+" >= ?", activity.RankMinValue).
		Order("score DESC, reached_at ASC, user_id ASC").
		Limit(limit).Scan(&rows).Error
	for i := range rows {
		rows[i].Rank = i + 1
	}
	return rows, err
}

// leaderboardUserScore is one user's current score, whether ranked or not.
func leaderboardUserScore(activity *LotteryActivity, userId int) (float64, error) {
	query, userColumn, err := leaderboardScores(activity)
	if err != nil {
		return 0, err
	}
	var row LeaderboardRow
	err = query.Where(userColumn+" = ?", userId).Scan(&row).Error
	return row.Score, err
}

type cachedLeaderboard struct {
	updatedAt  int64
	computedAt int64
	rows       []LeaderboardRow
}

var leaderboardCache sync.Map

// cachedLeaderboardRanking is the ranking of a running leaderboard, computed
// at most once a minute so page views do not rescan the logs.
func cachedLeaderboardRanking(activity *LotteryActivity) ([]LeaderboardRow, error) {
	now := common.GetTimestamp()
	if value, ok := leaderboardCache.Load(activity.Id); ok {
		cached := value.(cachedLeaderboard)
		if cached.updatedAt == activity.UpdatedAt && now-cached.computedAt < leaderboardCacheSeconds {
			return cached.rows, nil
		}
	}
	rows, err := LeaderboardRanking(activity, leaderboardLockLimit)
	if err != nil {
		return nil, err
	}
	leaderboardCache.Store(activity.Id, cachedLeaderboard{updatedAt: activity.UpdatedAt, computedAt: now, rows: rows})
	return rows, nil
}

// LotteryLeaderboard is a leaderboard as a user sees it.
type LotteryLeaderboard struct {
	Rows []LeaderboardRow `json:"rows"`
	// Ranked is how many users are on the board.
	Ranked int `json:"ranked"`
	// Final is true once the ranks are locked.
	Final bool          `json:"final"`
	Me    LeaderboardMe `json:"me"`
}

// LeaderboardMe is the viewer's standing; Rank is 0 when not ranked.
type LeaderboardMe struct {
	Rank     int     `json:"rank"`
	Score    float64 `json:"score"`
	Excluded bool    `json:"excluded"`
}

// leaderboardPrizeRanks is how many ranks the prizes cover.
func leaderboardPrizeRanks(prizes []LotteryPrize) int {
	total := 0
	for _, prize := range prizes {
		total += prize.Quantity
	}
	return total
}

// GetLotteryLeaderboard returns the public ranks of a leaderboard and the
// viewer's standing: the live ranking while it runs, the locked ranks after.
func GetLotteryLeaderboard(activity *LotteryActivity, userId int) (*LotteryLeaderboard, error) {
	board := &LotteryLeaderboard{Rows: []LeaderboardRow{}}
	publicCount := min(max(leaderboardPrizeRanks(activity.Prizes), leaderboardPublicMin), leaderboardPublicMax)
	var all []LeaderboardRow
	if activity.Status == LotteryStatusActive || activity.Status == LotteryStatusDraft {
		rows, err := cachedLeaderboardRanking(activity)
		if err != nil {
			return nil, err
		}
		all = rows
	} else {
		board.Final = true
		var entries []LotteryEntry
		if err := DB.Where("activity_id = ? AND disqualified = ?", activity.Id, false).
			Order("ranking asc, id asc").Find(&entries).Error; err != nil {
			return nil, err
		}
		all = make([]LeaderboardRow, len(entries))
		// Ranks close up over disqualified entries.
		for i, entry := range entries {
			all[i] = LeaderboardRow{UserId: entry.UserId, Rank: i + 1, Score: entry.Score}
		}
	}
	board.Ranked = len(all)
	// Copied: the running ranking is shared through the cache.
	board.Rows = append([]LeaderboardRow{}, all[:min(publicCount, len(all))]...)
	if err := attachLeaderboardNames(board.Rows); err != nil {
		return nil, err
	}
	for _, row := range all {
		if row.UserId == userId {
			board.Me.Rank, board.Me.Score = row.Rank, row.Score
			break
		}
	}
	if board.Me.Rank > 0 {
		return board, nil
	}
	var user User
	if err := DB.Select("id", "role", "status").First(&user, userId).Error; err != nil {
		return nil, err
	}
	board.Me.Excluded = user.Role >= common.RoleAdminUser || user.Status != common.UserStatusEnabled
	if !board.Final {
		score, err := leaderboardUserScore(activity, userId)
		if err != nil {
			return nil, err
		}
		board.Me.Score = score
	}
	return board, nil
}

// attachLeaderboardNames sets the nickname of each public row.
func attachLeaderboardNames(rows []LeaderboardRow) error {
	if len(rows) == 0 {
		return nil
	}
	ids := make([]int, len(rows))
	for i, row := range rows {
		ids[i] = row.UserId
	}
	var users []User
	if err := DB.Unscoped().Select("id", "display_name").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return err
	}
	names := make(map[int]string, len(users))
	for _, user := range users {
		names[user.Id] = user.DisplayName
	}
	for i := range rows {
		rows[i].DisplayName = names[rows[i].UserId]
	}
	return nil
}

// LockLeaderboard ends a leaderboard whose time is up: its final ranking is
// stored as entries and it waits for an administrator to award the prizes.
func LockLeaderboard(activityId int) error {
	var activity LotteryActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		return err
	}
	if activity.Status != LotteryStatusActive || activity.Mode != LotteryModeLeaderboard {
		return nil
	}
	// Ranked before the transaction: on SQLite, reading on another connection
	// while this one holds the write lock would wait on itself.
	rows, err := LeaderboardRanking(&activity, leaderboardLockLimit)
	if err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		now := common.GetTimestamp()
		result := tx.Model(&LotteryActivity{}).
			Where("id = ? AND status = ? AND mode = ?", activityId, LotteryStatusActive, LotteryModeLeaderboard).
			Updates(map[string]any{"status": LotteryStatusRanked, "entry_count": len(rows), "updated_at": now})
		if result.Error != nil || result.RowsAffected != 1 {
			return result.Error
		}
		if len(rows) == 0 {
			return nil
		}
		entries := make([]LotteryEntry, len(rows))
		for i, row := range rows {
			entries[i] = LotteryEntry{
				ActivityId:     activityId,
				UserId:         row.UserId,
				Rank:           row.Rank,
				Score:          row.Score,
				DeliveryStatus: LotteryDeliveryNone,
				CreatedAt:      now,
			}
		}
		return tx.CreateInBatches(&entries, 100).Error
	})
}

// leaderboardPrizeFor returns the prize won at a position (0-based) among the
// qualified entries: prizes take consecutive ranks in their order.
func leaderboardPrizeFor(prizes []LotteryPrize, position int) *LotteryPrize {
	for i := range prizes {
		if position < prizes[i].Quantity {
			return &prizes[i]
		}
		position -= prizes[i].Quantity
	}
	return nil
}

// lockLeaderboardForReview locks a leaderboard that waits for its awards.
func lockLeaderboardForReview(tx *gorm.DB, activityId int) error {
	var activity LotteryActivity
	if err := lockForUpdate(tx).Select("id", "mode", "status").First(&activity, activityId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return common.NewMessage("Activity not found")
		}
		return err
	}
	if activity.Mode != LotteryModeLeaderboard || activity.Status != LotteryStatusRanked {
		return common.NewMessage("Only leaderboards waiting for awards can be changed")
	}
	return nil
}

// SetLeaderboardEntryDisqualified excludes a locked entry from the prizes, or
// lets it back in, before the prizes are awarded.
func SetLeaderboardEntryDisqualified(entryId int, disqualified bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var entry LotteryEntry
		if err := tx.Select("id", "activity_id").First(&entry, entryId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Entry not found")
			}
			return err
		}
		if err := lockLeaderboardForReview(tx, entry.ActivityId); err != nil {
			return err
		}
		return tx.Model(&LotteryEntry{}).Where("id = ?", entryId).Update("disqualified", disqualified).Error
	})
}

// PredictLeaderboardPrizes returns the prize each qualified entry of a
// locked leaderboard would receive, by entry ID.
func PredictLeaderboardPrizes(activityId int) (map[int]LotteryPrize, error) {
	var prizes []LotteryPrize
	if err := DB.Where("activity_id = ?", activityId).Order("sort_order asc, id asc").Find(&prizes).Error; err != nil {
		return nil, err
	}
	var entries []LotteryEntry
	if err := DB.Select("id").Where("activity_id = ? AND disqualified = ?", activityId, false).
		Order("ranking asc, id asc").Limit(leaderboardPrizeRanks(prizes)).Find(&entries).Error; err != nil {
		return nil, err
	}
	predicted := make(map[int]LotteryPrize, len(entries))
	for i, entry := range entries {
		if prize := leaderboardPrizeFor(prizes, i); prize != nil {
			predicted[entry.Id] = *prize
		}
	}
	return predicted, nil
}

// AwardLeaderboard hands the prizes of a locked leaderboard to its qualified
// entries in rank order and delivers balance and subscription prizes.
func AwardLeaderboard(activityId int) error {
	var deliver []int
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockLeaderboardForReview(tx, activityId); err != nil {
			return err
		}
		now := common.GetTimestamp()
		result := tx.Model(&LotteryActivity{}).
			Where("id = ? AND status = ?", activityId, LotteryStatusRanked).
			Updates(map[string]any{"status": LotteryStatusDrawn, "drawn_at": now, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return common.NewMessage("Only leaderboards waiting for awards can be changed")
		}
		var prizes []LotteryPrize
		if err := tx.Where("activity_id = ?", activityId).Order("sort_order asc, id asc").Find(&prizes).Error; err != nil {
			return err
		}
		var entries []LotteryEntry
		if err := tx.Where("activity_id = ? AND disqualified = ?", activityId, false).
			Order("ranking asc, id asc").Limit(leaderboardPrizeRanks(prizes)).Find(&entries).Error; err != nil {
			return err
		}
		awarded := make(map[int]int, len(prizes))
		for i, entry := range entries {
			prize := leaderboardPrizeFor(prizes, i)
			if prize == nil {
				break
			}
			if err := tx.Model(&LotteryEntry{}).Where("id = ?", entry.Id).Updates(map[string]any{
				"prize_id":        prize.Id,
				"prize_name":      prize.Name,
				"prize_type":      prize.Type,
				"delivery_status": LotteryDeliveryPending,
			}).Error; err != nil {
				return err
			}
			awarded[prize.Id]++
			if prize.Type != LotteryPrizeManual {
				deliver = append(deliver, entry.Id)
			}
		}
		for prizeId, count := range awarded {
			if err := tx.Model(&LotteryPrize{}).Where("id = ?", prizeId).Update("awarded", count).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, entryId := range deliver {
		if err := DeliverLotteryEntry(entryId); err != nil {
			common.SysError(common.LogText("lottery prize delivery of entry %d failed: %v", entryId, err))
		}
	}
	return nil
}
