package model

import (
	"crypto/rand"
	"database/sql/driver"
	"errors"
	"fmt"
	"math"
	"math/big"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"gorm.io/gorm"
)

const (
	LotteryModeWheel        = "wheel"
	LotteryModeScheduled    = "scheduled"
	LotteryModeParticipants = "participants"
	LotteryModeLeaderboard  = "leaderboard"

	LotteryStatusDraft  = "draft"
	LotteryStatusActive = "active"
	LotteryStatusDrawn  = "drawn"
	// LotteryStatusRanked is a leaderboard whose final ranks are locked and
	// wait for an administrator to award the prizes.
	LotteryStatusRanked    = "ranked"
	LotteryStatusCancelled = "cancelled"

	LotteryPrizeManual       = "manual"
	LotteryPrizeQuota        = "quota"
	LotteryPrizeSubscription = "subscription"

	LotteryDeliveryNone      = "none"
	LotteryDeliveryPending   = "pending"
	LotteryDeliveryDelivered = "delivered"
	LotteryDeliveryFailed    = "failed"

	// Wheel probabilities are stored in basis points.
	LotteryProbabilityScale = 10000

	maxLotteryPrizes        = 20
	maxLotteryRulesLength   = 10000
	maxLotteryPrizeQuantity = 100000

	// Users see every running activity but only the latest finished ones.
	lotteryHistoryLimit = 20
	// lotteryUserWinsLimit caps the wins listed in a user's activity state.
	lotteryUserWinsLimit = 50

	maxLotteryWinnerFields       = 10
	maxLotteryWinnerLabelLength  = 64
	maxLotteryWinnerValueLength  = 255
	maxLotteryWinnerNoticeLength = 1000

	// An entry's win email: not owed, waiting to be sent, or handed to the
	// mailer. Entries drawn before win notices existed owe none.
	lotteryWinNoticeNone    = 0
	lotteryWinNoticePending = 1
	lotteryWinNoticeSent    = 2
)

// Personal messages a drawn activity sends its winners; English message keys
// the console translates with the message's params.
const (
	UserMessageLotteryWinTitle       = "You won a prize"
	UserMessageLotteryWinContent     = "You won {{prize}} in the activity {{activity}}."
	UserMessageLotteryWinInfoContent = "You won {{prize}} in the activity {{activity}}. Open Activities and fill in the information needed to receive it."
)

// LotteryWinnerField is one piece of information an activity asks the winners
// of its manually delivered prizes for, such as a shipping address. Balance
// and subscription prizes are delivered by the system and ask for nothing.
type LotteryWinnerField struct {
	Label    string `json:"label"`
	Required bool   `json:"required"`
}

// LotteryWinnerAnswer is what a winner filled in for one field, kept with the
// label it answered so later edits of the activity do not change its meaning.
type LotteryWinnerAnswer struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// LotteryJSONList is a list stored as JSON text; an empty list is stored as
// an empty string and read back as an empty list.
type LotteryJSONList[T any] []T

func (l LotteryJSONList[T]) Value() (driver.Value, error) {
	if len(l) == 0 {
		return "", nil
	}
	data, err := common.Marshal([]T(l))
	if err != nil {
		return nil, err
	}
	return string(data), nil
}

func (l *LotteryJSONList[T]) Scan(value any) error {
	var text string
	switch v := value.(type) {
	case nil:
	case string:
		text = v
	case []byte:
		text = string(v)
	default:
		return fmt.Errorf("unsupported lottery list value %T", value)
	}
	items := []T{}
	if text != "" {
		if err := common.UnmarshalJsonStr(text, &items); err != nil {
			return err
		}
	}
	*l = items
	return nil
}

// MarshalJSON writes an unset list as [] so clients never see null.
func (l LotteryJSONList[T]) MarshalJSON() ([]byte, error) {
	if l == nil {
		return []byte("[]"), nil
	}
	return common.Marshal([]T(l))
}

// LotteryActivity is one lottery. Wheel activities award on every spin;
// scheduled and participant-count activities collect entries and award them
// all at once when drawn.
type LotteryActivity struct {
	Id          int    `json:"id"`
	Title       string `json:"title" gorm:"type:varchar(128);not null"`
	Description string `json:"description" gorm:"type:text"`
	// Rules are the full activity rules in Markdown, shown on request.
	Rules  string `json:"rules" gorm:"type:text"`
	Mode   string `json:"mode" gorm:"type:varchar(16);not null"`
	Status string `json:"status" gorm:"type:varchar(16);not null;index"`

	// Entries are accepted in [StartTime, EndTime]; 0 leaves that side open.
	StartTime int64 `json:"start_time" gorm:"bigint;default:0"`
	EndTime   int64 `json:"end_time" gorm:"bigint;default:0"`
	// DrawTime is when a scheduled activity is drawn.
	DrawTime int64 `json:"draw_time" gorm:"bigint;default:0"`
	// TargetParticipants draws a participant-count activity once reached.
	TargetParticipants int `json:"target_participants" gorm:"type:int;default:0"`

	// MinSpend is the money a user must have paid within the spend window to
	// take part; 0 means no requirement. The window bounds are open when 0.
	MinSpend       float64 `json:"min_spend" gorm:"type:decimal(12,2);not null;default:0"`
	SpendStartTime int64   `json:"spend_start_time" gorm:"bigint;default:0"`
	SpendEndTime   int64   `json:"spend_end_time" gorm:"bigint;default:0"`

	// MinInvites is how many accounts a user must have invited that
	// registered within the invite window; 0 means no requirement.
	MinInvites      int   `json:"min_invites" gorm:"type:int;default:0"`
	InviteStartTime int64 `json:"invite_start_time" gorm:"bigint;default:0"`
	InviteEndTime   int64 `json:"invite_end_time" gorm:"bigint;default:0"`

	// RankMetric is what a leaderboard ranks users by, and RankMinValue the
	// score a user needs to be ranked at all, in that metric's unit: invited
	// accounts, consumed quota, or paid money.
	RankMetric   string  `json:"rank_metric" gorm:"type:varchar(16);default:''"`
	RankMinValue float64 `json:"rank_min_value" gorm:"type:decimal(20,4);not null;default:0"`
	// LeaderboardStyle is how a leaderboard shows its top three ranks.
	LeaderboardStyle string `json:"leaderboard_style" gorm:"type:varchar(16);default:''"`

	// Spins allowed per user for wheel activities; 0 means unlimited.
	WheelTotalLimit int `json:"wheel_total_limit" gorm:"type:int;default:0"`
	WheelDailyLimit int `json:"wheel_daily_limit" gorm:"type:int;default:0"`

	// EntryCount counts entries (participants or spins). Every entry first
	// increments it, which serializes entries of one activity on all databases.
	// WinnerNotice tells winners how the prize reaches them; WinnerFields is
	// the information they are asked to fill in to receive it.
	WinnerNotice string                              `json:"winner_notice" gorm:"type:text"`
	WinnerFields LotteryJSONList[LotteryWinnerField] `json:"winner_fields" gorm:"type:text"`

	EntryCount int   `json:"entry_count" gorm:"type:int;default:0"`
	DrawnAt    int64 `json:"drawn_at" gorm:"bigint;default:0"`
	CreatedAt  int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt  int64 `json:"updated_at" gorm:"bigint"`

	Prizes []LotteryPrize `json:"prizes" gorm:"-"`
}

type LotteryPrize struct {
	Id         int    `json:"id"`
	ActivityId int    `json:"activity_id" gorm:"index"`
	Name       string `json:"name" gorm:"type:varchar(128);not null"`
	Type       string `json:"type" gorm:"type:varchar(16);not null"`
	Quota      int    `json:"quota" gorm:"type:int;default:0"`
	PlanId     int    `json:"plan_id" gorm:"type:int;default:0"`
	// Quantity is the number of winners when drawn, or the wheel stock where
	// 0 means unlimited.
	Quantity    int `json:"quantity" gorm:"type:int;default:0"`
	Awarded     int `json:"awarded" gorm:"type:int;default:0"`
	Probability int `json:"probability" gorm:"type:int;default:0"`
	SortOrder   int `json:"sort_order" gorm:"type:int;default:0"`
}

// LotteryEntry is one participation or one spin, and the prize it won.
type LotteryEntry struct {
	Id             int    `json:"id"`
	ActivityId     int    `json:"activity_id" gorm:"index:idx_lottery_entry_activity_user,priority:1"`
	UserId         int    `json:"user_id" gorm:"index:idx_lottery_entry_activity_user,priority:2;index"`
	SpinDate       string `json:"spin_date" gorm:"type:varchar(10);default:''"`
	PrizeId        int    `json:"prize_id" gorm:"type:int;default:0;index"`
	PrizeName      string `json:"prize_name" gorm:"type:varchar(128);default:''"`
	PrizeType      string `json:"prize_type" gorm:"type:varchar(16);default:''"`
	DeliveryStatus string `json:"delivery_status" gorm:"type:varchar(16);default:'none';index"`
	DeliveryNote   string `json:"delivery_note" gorm:"type:varchar(255);default:''"`
	DeliveredAt    int64  `json:"delivered_at" gorm:"bigint;default:0"`
	// WinnerInfo is what the winner filled in for the activity's WinnerFields.
	WinnerInfo   LotteryJSONList[LotteryWinnerAnswer] `json:"winner_info" gorm:"type:text"`
	WinnerInfoAt int64                                `json:"winner_info_at" gorm:"bigint;default:0"`
	WinNotice    int                                  `json:"-" gorm:"type:int;default:0;index"`
	CreatedAt    int64                                `json:"created_at" gorm:"bigint"`

	// Leaderboard entries record the locked rank and score. A disqualified
	// entry gets no prize and the entries after it move up.
	// "rank" is reserved in MySQL 8, so the column is named ranking.
	Rank         int     `json:"rank" gorm:"column:ranking;type:int;default:0"`
	Score        float64 `json:"score" gorm:"type:decimal(20,4);not null;default:0"`
	Disqualified bool    `json:"disqualified"`
}

func (a *LotteryActivity) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	a.CreatedAt = now
	a.UpdatedAt = now
	return nil
}

func (a *LotteryActivity) BeforeUpdate(tx *gorm.DB) error {
	a.UpdatedAt = common.GetTimestamp()
	return nil
}

func (e *LotteryEntry) BeforeCreate(tx *gorm.DB) error {
	if e.CreatedAt == 0 {
		e.CreatedAt = common.GetTimestamp()
	}
	return nil
}

// lotteryIntN returns a uniform random number in [0, n) from crypto/rand, so
// draw results cannot be predicted from earlier ones.
func lotteryIntN(n int) (int, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0, err
	}
	return int(value.Int64()), nil
}

func lotteryToday() string {
	return time.Now().Format("2006-01-02")
}

// validateWinnerInfoRequest checks the notice and the fields winners fill in.
func (a *LotteryActivity) validateWinnerInfoRequest() error {
	a.WinnerNotice = strings.TrimSpace(a.WinnerNotice)
	if utf8.RuneCountInString(a.WinnerNotice) > maxLotteryWinnerNoticeLength {
		return common.NewMessage("The winner notice must be at most 1000 characters")
	}
	if len(a.WinnerFields) > maxLotteryWinnerFields {
		return common.NewMessage("Winners can be asked for at most 10 pieces of information")
	}
	labels := make(map[string]bool, len(a.WinnerFields))
	for i := range a.WinnerFields {
		label := strings.TrimSpace(a.WinnerFields[i].Label)
		if label == "" || utf8.RuneCountInString(label) > maxLotteryWinnerLabelLength || labels[label] {
			return common.NewMessage("Each piece of winner information needs a unique name of at most 64 characters")
		}
		labels[label] = true
		a.WinnerFields[i].Label = label
	}
	return nil
}

// Validate checks an activity and its prizes before they are saved.
func (a *LotteryActivity) Validate() error {
	a.Title = strings.TrimSpace(a.Title)
	if a.Title == "" || len(a.Title) > 128 {
		return common.NewMessage("Activity title is required and must be at most 128 characters")
	}
	if a.Status != LotteryStatusDraft && a.Status != LotteryStatusActive {
		return common.NewMessage("Invalid activity status")
	}
	a.Rules = strings.TrimSpace(a.Rules)
	if utf8.RuneCountInString(a.Rules) > maxLotteryRulesLength {
		return common.NewMessage("Activity rules must be at most 10000 characters")
	}
	if err := a.validateWinnerInfoRequest(); err != nil {
		return err
	}
	if a.StartTime < 0 || a.EndTime < 0 || a.DrawTime < 0 || a.SpendStartTime < 0 || a.SpendEndTime < 0 ||
		a.InviteStartTime < 0 || a.InviteEndTime < 0 {
		return common.NewMessage("Invalid activity time")
	}
	if a.EndTime > 0 && a.EndTime <= a.StartTime {
		return common.NewMessage("End time must be later than start time")
	}
	// A past end or draw time would close or draw the activity at once.
	now := common.GetTimestamp()
	if a.EndTime > 0 && a.EndTime <= now {
		return common.NewMessage("End time must be in the future")
	}
	if a.SpendEndTime > 0 && a.SpendEndTime <= a.SpendStartTime {
		return common.NewMessage("Spending window end must be later than its start")
	}
	if a.MinSpend < 0 || a.MinSpend > 1e9 {
		return common.NewMessage("Invalid minimum spending")
	}
	if a.InviteEndTime > 0 && a.InviteEndTime <= a.InviteStartTime {
		return common.NewMessage("Invitation window end must be later than its start")
	}
	if a.MinInvites < 0 || a.MinInvites > 100000 {
		return common.NewMessage("Invalid minimum invitations")
	}
	if a.Mode != LotteryModeLeaderboard {
		a.RankMetric, a.RankMinValue, a.LeaderboardStyle = "", 0, ""
	}
	a.TargetParticipants = max(a.TargetParticipants, 0)
	a.WheelTotalLimit = max(a.WheelTotalLimit, 0)
	a.WheelDailyLimit = max(a.WheelDailyLimit, 0)
	switch a.Mode {
	case LotteryModeWheel:
		a.DrawTime, a.TargetParticipants = 0, 0
	case LotteryModeScheduled:
		if a.DrawTime <= a.StartTime {
			return common.NewMessage("Scheduled draws need a draw time later than the start time")
		}
		if a.DrawTime <= now {
			return common.NewMessage("Draw time must be in the future")
		}
		if a.EndTime == 0 || a.EndTime > a.DrawTime {
			a.EndTime = a.DrawTime
		}
		a.TargetParticipants, a.WheelTotalLimit, a.WheelDailyLimit = 0, 0, 0
	case LotteryModeParticipants:
		if a.TargetParticipants < 1 || a.TargetParticipants > 1000000 {
			return common.NewMessage("Participant-count draws need a participant target")
		}
		a.DrawTime, a.WheelTotalLimit, a.WheelDailyLimit = 0, 0, 0
	case LotteryModeLeaderboard:
		if a.EndTime == 0 {
			return common.NewMessage("Leaderboards need an end time")
		}
		if !slices.Contains(lotteryRankMetrics, a.RankMetric) {
			return common.NewMessage("Invalid ranking metric")
		}
		if a.LeaderboardStyle == "" {
			a.LeaderboardStyle = LeaderboardStyleHorse
		}
		if !slices.Contains(leaderboardStyles, a.LeaderboardStyle) {
			return common.NewMessage("Invalid leaderboard style")
		}
		if math.IsNaN(a.RankMinValue) || a.RankMinValue < 0 || a.RankMinValue > maxLeaderboardMinValue {
			return common.NewMessage("Invalid leaderboard threshold")
		}
		// A leaderboard ranks everyone; its threshold replaces the entry
		// requirements of the other modes.
		a.DrawTime, a.TargetParticipants, a.WheelTotalLimit, a.WheelDailyLimit = 0, 0, 0, 0
		a.MinSpend, a.SpendStartTime, a.SpendEndTime = 0, 0, 0
		a.MinInvites, a.InviteStartTime, a.InviteEndTime = 0, 0, 0
	default:
		return common.NewMessage("Invalid lottery mode")
	}
	if len(a.Prizes) == 0 || len(a.Prizes) > maxLotteryPrizes {
		return common.NewMessage("An activity needs 1 to 20 prizes")
	}
	probability, ranks := 0, 0
	for i := range a.Prizes {
		prize := &a.Prizes[i]
		prize.Name = strings.TrimSpace(prize.Name)
		if prize.Name == "" || len(prize.Name) > 128 {
			return common.NewMessage("Prize name is required and must be at most 128 characters")
		}
		switch prize.Type {
		case LotteryPrizeManual:
			prize.Quota, prize.PlanId = 0, 0
		case LotteryPrizeQuota:
			prize.PlanId = 0
			if prize.Quota <= 0 {
				return common.NewMessage("Balance prizes need a positive quota")
			}
			if err := common.ValidateWalletQuota(prize.Quota); err != nil {
				return err
			}
		case LotteryPrizeSubscription:
			prize.Quota = 0
			var plan SubscriptionPlan
			if prize.PlanId <= 0 || DB.First(&plan, prize.PlanId).Error != nil || !plan.Enabled {
				return common.NewMessage("Please select an enabled subscription plan")
			}
		default:
			return common.NewMessage("Invalid prize type")
		}
		if prize.Quantity < 0 || prize.Quantity > maxLotteryPrizeQuantity {
			return common.NewMessage("Invalid prize quantity")
		}
		if a.Mode != LotteryModeWheel && prize.Quantity == 0 {
			return common.NewMessage("Drawn prizes need at least one winner")
		}
		if a.Mode == LotteryModeWheel {
			if prize.Probability < 0 || prize.Probability > LotteryProbabilityScale {
				return common.NewMessage("Invalid prize probability")
			}
			probability += prize.Probability
		} else {
			prize.Probability = 0
		}
		ranks += prize.Quantity
		prize.SortOrder = i
		prize.Awarded = 0
	}
	if a.Mode == LotteryModeLeaderboard && ranks > maxLeaderboardRanks {
		return common.NewMessage("Leaderboard prizes can cover at most 500 ranks")
	}
	if probability > LotteryProbabilityScale {
		return common.NewMessage("Prize probabilities add up to more than 100%")
	}
	// Only manually delivered prizes need anything from their winners.
	if !slices.ContainsFunc(a.Prizes, func(prize LotteryPrize) bool { return prize.Type == LotteryPrizeManual }) {
		a.WinnerFields = nil
	}
	return nil
}

func loadLotteryPrizes(tx *gorm.DB, activities []LotteryActivity) error {
	if len(activities) == 0 {
		return nil
	}
	ids := make([]int, len(activities))
	for i := range activities {
		ids[i] = activities[i].Id
	}
	var prizes []LotteryPrize
	if err := tx.Where("activity_id IN ?", ids).Order("sort_order asc, id asc").Find(&prizes).Error; err != nil {
		return err
	}
	byActivity := make(map[int][]LotteryPrize, len(activities))
	for _, prize := range prizes {
		byActivity[prize.ActivityId] = append(byActivity[prize.ActivityId], prize)
	}
	for i := range activities {
		activities[i].Prizes = byActivity[activities[i].Id]
		if activities[i].Prizes == nil {
			activities[i].Prizes = []LotteryPrize{}
		}
	}
	return nil
}

func GetLotteryActivity(id int) (*LotteryActivity, error) {
	var activity LotteryActivity
	if err := DB.First(&activity, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewMessage("Activity not found")
		}
		return nil, err
	}
	activities := []LotteryActivity{activity}
	if err := loadLotteryPrizes(DB, activities); err != nil {
		return nil, err
	}
	return &activities[0], nil
}

// ListLotteryActivities lists activities newest first. For users
// (visibleOnly) it returns every running activity followed by the latest
// finished ones: drawn activities, wheels past their end time, and cancelled
// activities that people had entered. Drafts are never shown to users.
func ListLotteryActivities(visibleOnly bool) ([]LotteryActivity, error) {
	var activities []LotteryActivity
	if !visibleOnly {
		if err := DB.Order("id desc").Find(&activities).Error; err != nil {
			return nil, err
		}
		return activities, loadLotteryPrizes(DB, activities)
	}
	now := common.GetTimestamp()
	if err := DB.Where("(status = ? AND (mode <> ? OR end_time = 0 OR end_time >= ?)) OR status = ?",
		LotteryStatusActive, LotteryModeWheel, now, LotteryStatusRanked).
		Order("id desc").Find(&activities).Error; err != nil {
		return nil, err
	}
	var history []LotteryActivity
	if err := DB.Where("status = ? OR (status = ? AND entry_count > 0) OR (status = ? AND mode = ? AND end_time > 0 AND end_time < ?)",
		LotteryStatusDrawn, LotteryStatusCancelled, LotteryStatusActive, LotteryModeWheel, now).
		Order("id desc").Limit(lotteryHistoryLimit).Find(&history).Error; err != nil {
		return nil, err
	}
	activities = append(activities, history...)
	return activities, loadLotteryPrizes(DB, activities)
}

func CreateLotteryActivity(activity *LotteryActivity) error {
	if err := activity.Validate(); err != nil {
		return err
	}
	activity.Id, activity.EntryCount, activity.DrawnAt = 0, 0, 0
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Omit("Prizes").Create(activity).Error; err != nil {
			return err
		}
		for i := range activity.Prizes {
			activity.Prizes[i].Id = 0
			activity.Prizes[i].ActivityId = activity.Id
		}
		return tx.Create(&activity.Prizes).Error
	})
}

// UpdateLotteryActivity saves an edited activity. Once anyone has entered,
// only the title, description, rules text, end time and what winners are told
// and asked for may change, so entrants keep the mechanics they joined under.
func UpdateLotteryActivity(update *LotteryActivity) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var current LotteryActivity
		if err := lockForUpdate(tx).First(&current, update.Id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Activity not found")
			}
			return err
		}
		if current.Status != LotteryStatusDraft && current.Status != LotteryStatusActive {
			return common.NewMessage("Drawn or cancelled activities cannot be edited")
		}
		if current.EntryCount > 0 {
			title := strings.TrimSpace(update.Title)
			if title == "" || len(title) > 128 {
				return common.NewMessage("Activity title is required and must be at most 128 characters")
			}
			rules := strings.TrimSpace(update.Rules)
			if utf8.RuneCountInString(rules) > maxLotteryRulesLength {
				return common.NewMessage("Activity rules must be at most 10000 characters")
			}
			if update.EndTime < 0 || (update.EndTime > 0 && update.EndTime <= current.StartTime) {
				return common.NewMessage("End time must be later than start time")
			}
			if current.Mode == LotteryModeScheduled && (update.EndTime == 0 || update.EndTime > current.DrawTime) {
				update.EndTime = current.DrawTime
			}
			if err := update.validateWinnerInfoRequest(); err != nil {
				return err
			}
			return tx.Model(&current).Updates(map[string]any{
				"title":         title,
				"description":   update.Description,
				"rules":         rules,
				"end_time":      update.EndTime,
				"winner_notice": update.WinnerNotice,
				"winner_fields": update.WinnerFields,
			}).Error
		}
		if err := update.Validate(); err != nil {
			return err
		}
		if err := tx.Model(&current).Select(
			"title", "description", "rules", "mode", "status", "start_time", "end_time", "draw_time",
			"target_participants", "min_spend", "spend_start_time", "spend_end_time",
			"min_invites", "invite_start_time", "invite_end_time",
			"rank_metric", "rank_min_value", "leaderboard_style",
			"wheel_total_limit", "wheel_daily_limit",
			"winner_notice", "winner_fields",
		).Updates(update).Error; err != nil {
			return err
		}
		if err := tx.Where("activity_id = ?", current.Id).Delete(&LotteryPrize{}).Error; err != nil {
			return err
		}
		for i := range update.Prizes {
			update.Prizes[i].Id = 0
			update.Prizes[i].ActivityId = current.Id
		}
		return tx.Create(&update.Prizes).Error
	})
}

// DeleteLotteryActivity removes an activity nobody has entered yet.
func DeleteLotteryActivity(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND entry_count = 0", id).Delete(&LotteryActivity{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return common.NewMessage("Activities with entries cannot be deleted; cancel them instead")
		}
		return tx.Where("activity_id = ?", id).Delete(&LotteryPrize{}).Error
	})
}

// CancelLotteryActivity stops an activity that has not been drawn, including
// a leaderboard waiting for its awards. Prizes already won on a wheel stay
// with their winners.
func CancelLotteryActivity(id int) error {
	result := DB.Model(&LotteryActivity{}).
		Where("id = ? AND status IN ?", id, []string{LotteryStatusDraft, LotteryStatusActive, LotteryStatusRanked}).
		Updates(map[string]any{"status": LotteryStatusCancelled, "updated_at": common.GetTimestamp()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return common.NewMessage("Only activities that have not been drawn can be cancelled")
	}
	return nil
}

// SumUserPaidMoney totals the money a user paid in successful orders within
// [from, to], where 0 leaves a bound open. Subscription purchases record a
// top-up row too, so they count; balance purchases were counted when the
// balance was paid for.
func SumUserPaidMoney(tx *gorm.DB, userId int, from int64, to int64) (float64, error) {
	query := tx.Model(&TopUp{}).Where("user_id = ? AND status = ?", userId, common.TopUpStatusSuccess)
	if from > 0 {
		query = query.Where("complete_time >= ?", from)
	}
	if to > 0 {
		query = query.Where("complete_time <= ?", to)
	}
	var total float64
	err := query.Select("COALESCE(SUM(money), 0)").Scan(&total).Error
	return total, err
}

// CountUserInvitees counts the accounts a user currently invites that
// registered within [from, to]; 0 leaves that side open. Cancelled
// invitations and deleted accounts do not count.
func CountUserInvitees(tx *gorm.DB, inviterId int, from int64, to int64) (int64, error) {
	query := tx.Model(&User{}).Where("inviter_id = ?", inviterId)
	if from > 0 {
		query = query.Where("created_at >= ?", from)
	}
	if to > 0 {
		query = query.Where("created_at <= ?", to)
	}
	var count int64
	err := query.Count(&count).Error
	return count, err
}

// LotteryUserState is what a user sees of their own standing in an activity.
type LotteryUserState struct {
	Paid           float64        `json:"paid"`
	Invited        int64          `json:"invited"`
	Eligible       bool           `json:"eligible"`
	Joined         bool           `json:"joined"`
	SpinsUsed      int            `json:"spins_used"`
	SpinsUsedToday int            `json:"spins_used_today"`
	Wins           []LotteryEntry `json:"wins"`
}

func GetLotteryUserState(tx *gorm.DB, activity *LotteryActivity, userId int) (*LotteryUserState, error) {
	state := &LotteryUserState{Eligible: true, Wins: []LotteryEntry{}}
	if activity.MinSpend > 0 {
		paid, err := SumUserPaidMoney(tx, userId, activity.SpendStartTime, activity.SpendEndTime)
		if err != nil {
			return nil, err
		}
		state.Paid = paid
		state.Eligible = paid+1e-9 >= activity.MinSpend
	}
	if activity.MinInvites > 0 {
		invited, err := CountUserInvitees(tx, userId, activity.InviteStartTime, activity.InviteEndTime)
		if err != nil {
			return nil, err
		}
		state.Invited = invited
		state.Eligible = state.Eligible && invited >= int64(activity.MinInvites)
	}
	// Counted rather than loaded: an unlimited wheel can hold many spins.
	mine := func() *gorm.DB {
		return tx.Model(&LotteryEntry{}).Where("activity_id = ? AND user_id = ?", activity.Id, userId)
	}
	var total, today int64
	if err := mine().Count(&total).Error; err != nil {
		return nil, err
	}
	if err := mine().Where("spin_date = ?", lotteryToday()).Count(&today).Error; err != nil {
		return nil, err
	}
	if err := mine().Where("prize_id > 0").Order("id desc").Limit(lotteryUserWinsLimit).Find(&state.Wins).Error; err != nil {
		return nil, err
	}
	state.Joined = total > 0
	state.SpinsUsed = int(total)
	state.SpinsUsedToday = int(today)
	return state, nil
}

// requirementError names the requirement an ineligible user misses.
func (s *LotteryUserState) requirementError(activity *LotteryActivity) error {
	if activity.MinSpend > 0 && s.Paid+1e-9 < activity.MinSpend {
		return common.NewMessage("You do not meet the spending requirement of this activity")
	}
	return common.NewMessage("You do not meet the invitation requirement of this activity")
}

// beginLotteryEntry takes the activity's entry slot inside tx and checks that
// it accepts entries now. Incrementing the counter first makes concurrent
// entries of one activity queue behind each other on every database, and the
// same update refuses a participant-count activity that is already full, so
// nobody can join between the last entry and the draw.
func beginLotteryEntry(tx *gorm.DB, activityId int, mode string) (*LotteryActivity, error) {
	result := tx.Model(&LotteryActivity{}).
		Where("id = ? AND status = ? AND mode <> ?", activityId, LotteryStatusActive, LotteryModeLeaderboard).
		Where("mode <> ? OR entry_count < target_participants", LotteryModeParticipants).
		Update("entry_count", gorm.Expr("entry_count + 1"))
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		var current LotteryActivity
		if err := tx.Select("status", "mode", "entry_count", "target_participants").First(&current, activityId).Error; err == nil &&
			current.Status == LotteryStatusActive && current.Mode == LotteryModeParticipants {
			return nil, common.NewMessage("This activity is full; waiting for the draw")
		}
		return nil, common.NewMessage("This activity is not open")
	}
	var activity LotteryActivity
	if err := tx.First(&activity, activityId).Error; err != nil {
		return nil, err
	}
	if (mode == LotteryModeWheel) != (activity.Mode == LotteryModeWheel) {
		return nil, common.NewMessage("This activity is not open")
	}
	now := common.GetTimestamp()
	if activity.StartTime > 0 && now < activity.StartTime {
		return nil, common.NewMessage("This activity has not started yet")
	}
	if activity.EndTime > 0 && now > activity.EndTime {
		return nil, common.NewMessage("This activity has ended")
	}
	return &activity, nil
}

// JoinLotteryActivity enters a user into a scheduled or participant-count
// activity. A participant-count activity is drawn once the target is reached.
func JoinLotteryActivity(activityId int, userId int) error {
	reachedTarget := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		activity, err := beginLotteryEntry(tx, activityId, LotteryModeScheduled)
		if err != nil {
			return err
		}
		state, err := GetLotteryUserState(tx, activity, userId)
		if err != nil {
			return err
		}
		if state.Joined {
			return common.NewMessage("You have already joined this activity")
		}
		if !state.Eligible {
			return state.requirementError(activity)
		}
		if err := tx.Create(&LotteryEntry{ActivityId: activityId, UserId: userId, DeliveryStatus: LotteryDeliveryNone}).Error; err != nil {
			return err
		}
		reachedTarget = activity.Mode == LotteryModeParticipants && activity.EntryCount >= activity.TargetParticipants
		return nil
	})
	if err != nil {
		return err
	}
	if reachedTarget {
		if err := DrawLotteryActivity(activityId); err != nil {
			common.SysError(common.LogText("lottery draw of activity %d failed: %v", activityId, err))
		}
	}
	return nil
}

// SpinLotteryWheel spins a wheel activity once for a user and returns the
// entry, whose PrizeId is 0 when nothing was won.
func SpinLotteryWheel(activityId int, userId int) (*LotteryEntry, error) {
	entry := &LotteryEntry{ActivityId: activityId, UserId: userId, SpinDate: lotteryToday(), DeliveryStatus: LotteryDeliveryNone}
	err := DB.Transaction(func(tx *gorm.DB) error {
		activity, err := beginLotteryEntry(tx, activityId, LotteryModeWheel)
		if err != nil {
			return err
		}
		state, err := GetLotteryUserState(tx, activity, userId)
		if err != nil {
			return err
		}
		if !state.Eligible {
			return state.requirementError(activity)
		}
		if activity.WheelTotalLimit > 0 && state.SpinsUsed >= activity.WheelTotalLimit {
			return common.NewMessage("You have used all your spins for this activity")
		}
		if activity.WheelDailyLimit > 0 && state.SpinsUsedToday >= activity.WheelDailyLimit {
			return common.NewMessage("You have used all your spins for today")
		}
		var prizes []LotteryPrize
		if err := tx.Where("activity_id = ?", activityId).Order("sort_order asc, id asc").Find(&prizes).Error; err != nil {
			return err
		}
		roll, err := lotteryIntN(LotteryProbabilityScale)
		if err != nil {
			return err
		}
		// Landing on a prize that is out of stock wins nothing, so the odds
		// of the other prizes stay as configured.
		for _, prize := range prizes {
			if roll >= prize.Probability {
				roll -= prize.Probability
				continue
			}
			result := tx.Model(&LotteryPrize{}).
				Where("id = ? AND (quantity = 0 OR awarded < quantity)", prize.Id).
				Update("awarded", gorm.Expr("awarded + 1"))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 1 {
				entry.PrizeId, entry.PrizeName, entry.PrizeType = prize.Id, prize.Name, prize.Type
				entry.DeliveryStatus = LotteryDeliveryPending
			}
			break
		}
		return tx.Create(entry).Error
	})
	if err != nil {
		return nil, err
	}
	if entry.PrizeId > 0 && entry.PrizeType != LotteryPrizeManual {
		if err := DeliverLotteryEntry(entry.Id); err != nil {
			common.SysError(common.LogText("lottery prize delivery of entry %d failed: %v", entry.Id, err))
		}
		_ = DB.First(entry, entry.Id).Error
	}
	return entry, nil
}

// DrawLotteryActivity draws a scheduled or participant-count activity: the
// entries are shuffled and the prizes handed out in order, one per winner.
// Drawing an activity that is no longer active does nothing.
func DrawLotteryActivity(activityId int) error {
	var winners []int
	err := DB.Transaction(func(tx *gorm.DB) error {
		now := common.GetTimestamp()
		result := tx.Model(&LotteryActivity{}).
			Where("id = ? AND status = ? AND mode IN ?", activityId, LotteryStatusActive,
				[]string{LotteryModeScheduled, LotteryModeParticipants}).
			Updates(map[string]any{"status": LotteryStatusDrawn, "drawn_at": now, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		var entries []LotteryEntry
		if err := tx.Where("activity_id = ?", activityId).Order("id asc").Find(&entries).Error; err != nil {
			return err
		}
		var prizes []LotteryPrize
		if err := tx.Where("activity_id = ?", activityId).Order("sort_order asc, id asc").Find(&prizes).Error; err != nil {
			return err
		}
		var activity LotteryActivity
		if err := tx.Select("title", "winner_fields").First(&activity, activityId).Error; err != nil {
			return err
		}
		var messages []UserMessage
		for i := len(entries) - 1; i > 0; i-- {
			j, err := lotteryIntN(i + 1)
			if err != nil {
				return err
			}
			entries[i], entries[j] = entries[j], entries[i]
		}
		next := 0
		for _, prize := range prizes {
			count := min(prize.Quantity, len(entries)-next)
			for _, entry := range entries[next : next+count] {
				if err := tx.Model(&LotteryEntry{}).Where("id = ?", entry.Id).Updates(map[string]any{
					"prize_id":        prize.Id,
					"prize_name":      prize.Name,
					"prize_type":      prize.Type,
					"delivery_status": LotteryDeliveryPending,
					"win_notice":      lotteryWinNoticePending,
				}).Error; err != nil {
					return err
				}
				content := UserMessageLotteryWinContent
				if prize.Type == LotteryPrizeManual && len(activity.WinnerFields) > 0 {
					content = UserMessageLotteryWinInfoContent
				}
				messages = append(messages, UserMessage{UserId: entry.UserId, Title: UserMessageLotteryWinTitle, Content: content,
					Params: MessageParams{"prize": prize.Name, "activity": activity.Title}})
				if prize.Type != LotteryPrizeManual {
					winners = append(winners, entry.Id)
				}
			}
			if err := tx.Model(&LotteryPrize{}).Where("id = ?", prize.Id).Update("awarded", count).Error; err != nil {
				return err
			}
			next += count
		}
		if len(messages) == 0 {
			return nil
		}
		return tx.CreateInBatches(&messages, 100).Error
	})
	if err != nil {
		return err
	}
	for _, entryId := range winners {
		if err := DeliverLotteryEntry(entryId); err != nil {
			common.SysError(common.LogText("lottery prize delivery of entry %d failed: %v", entryId, err))
		}
	}
	return nil
}

// DeliverLotteryEntry hands out a won balance or subscription prize. It is
// idempotent: only pending or failed entries are delivered. A business
// failure (such as a plan's purchase limit) marks the entry failed with the
// reason so an admin can retry it; other errors leave it pending for the
// draw task to retry.
func DeliverLotteryEntry(entryId int) error {
	var entry LotteryEntry
	var subscription *UserSubscription
	var quota int
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Claim the entry before reading anything: the write lock serializes
		// concurrent deliveries, and SQLite must take it first to queue on
		// its busy timeout instead of failing on a stale read.
		result := tx.Model(&LotteryEntry{}).
			Where("id = ? AND prize_type IN ? AND delivery_status IN ?", entryId,
				[]string{LotteryPrizeQuota, LotteryPrizeSubscription}, []string{LotteryDeliveryPending, LotteryDeliveryFailed}).
			Updates(map[string]any{"delivery_status": LotteryDeliveryDelivered, "delivery_note": "", "delivered_at": common.GetTimestamp()})
		if result.Error != nil {
			return result.Error
		}
		if err := tx.First(&entry, entryId).Error; err != nil {
			return err
		}
		if result.RowsAffected != 1 {
			if entry.PrizeId == 0 || entry.PrizeType == LotteryPrizeManual {
				return common.NewMessage("This entry has no prize to deliver automatically")
			}
			return common.NewMessage("This prize has already been delivered")
		}
		var prize LotteryPrize
		if err := tx.First(&prize, entry.PrizeId).Error; err != nil {
			return common.NewMessage("The prize no longer exists")
		}
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", entry.UserId).First(&user).Error; err != nil {
			return common.NewMessage("The winner no longer exists")
		}
		if prize.Type == LotteryPrizeQuota {
			quota = prize.Quota
			return creditTopUpQuota(tx, entry.UserId, prize.Quota, nil)
		}
		var plan SubscriptionPlan
		if err := tx.First(&plan, prize.PlanId).Error; err != nil {
			return common.NewMessage("Please select an enabled subscription plan")
		}
		created, err := CreateUserSubscriptionFromPlanTx(tx, entry.UserId, &plan, "lottery")
		subscription = created
		return err
	})
	if err != nil {
		var message *common.Message
		if errors.As(err, &message) {
			DB.Model(&LotteryEntry{}).
				Where("id = ? AND prize_type IN ? AND delivery_status IN ?", entryId,
					[]string{LotteryPrizeQuota, LotteryPrizeSubscription}, []string{LotteryDeliveryPending, LotteryDeliveryFailed}).
				Updates(map[string]any{"delivery_status": LotteryDeliveryFailed, "delivery_note": message.Error()})
		}
		return err
	}
	if quota > 0 {
		syncCreditUserQuotaCache(entry.UserId, quota, common.LogText("lottery prize"))
		RecordLog(entry.UserId, LogTypeSystem, common.NewMessage("Won lottery prize {{prize}}, received {{quota}}", map[string]any{"prize": entry.PrizeName, "quota": logger.FormatQuota(quota)}))
		return nil
	}
	if subscription != nil {
		if subscription.PrevUserGroup != "" {
			refreshSubscriptionUserGroupCache(entry.UserId, common.LogText("lottery subscription prize"))
		}
		RecordLog(entry.UserId, LogTypeSystem, common.NewMessage("Won lottery prize {{prize}}, subscription ID {{subscription_id}}", map[string]any{"prize": entry.PrizeName, "subscription_id": subscription.Id}))
	}
	return nil
}

// MarkLotteryEntryDelivered records that an admin handed out a manual prize.
func MarkLotteryEntryDelivered(entryId int, note string) error {
	note = strings.TrimSpace(note)
	if len(note) > 255 {
		return common.NewMessage("Delivery note must be at most 255 characters")
	}
	result := DB.Model(&LotteryEntry{}).
		Where("id = ? AND prize_type = ? AND delivery_status = ?", entryId, LotteryPrizeManual, LotteryDeliveryPending).
		Updates(map[string]any{"delivery_status": LotteryDeliveryDelivered, "delivery_note": note, "delivered_at": common.GetTimestamp()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return common.NewMessage("Only pending manual prizes can be marked as delivered")
	}
	return nil
}

// ListLotteryEntries pages through an activity's entries for admins.
// Leaderboard entries are listed by rank.
func ListLotteryEntries(activityId int, winnersOnly bool, byRank bool, pageInfo *common.PageInfo) ([]LotteryEntry, int64, error) {
	query := DB.Model(&LotteryEntry{}).Where("activity_id = ?", activityId)
	if winnersOnly {
		query = query.Where("prize_id > 0")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var entries []LotteryEntry
	order := "prize_id = 0, id desc"
	if byRank {
		order = "ranking asc, id asc"
	}
	err := query.Order(order).Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&entries).Error
	return entries, total, err
}

// LotteryWinner is a public record of a win, naming the winner only by ID.
type LotteryWinner struct {
	UserId    int    `json:"user_id"`
	PrizeId   int    `json:"prize_id"`
	PrizeName string `json:"prize_name"`
	CreatedAt int64  `json:"created_at"`
}

// ListLotteryWinners returns an activity's latest wins and how many there are
// in total.
func ListLotteryWinners(activityId int, limit int) ([]LotteryWinner, int64, error) {
	query := DB.Model(&LotteryEntry{}).Where("activity_id = ? AND prize_id > 0", activityId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	winners := []LotteryWinner{}
	err := query.Select("user_id", "prize_id", "prize_name", "created_at").Order("id desc").Limit(limit).Find(&winners).Error
	return winners, total, err
}

// LotteryWin is a prize a user won, with the activity it came from.
type LotteryWin struct {
	LotteryEntry
	ActivityTitle string `json:"activity_title"`
	// WinnerNotice and WinnerFields are the activity's, so the winner can read
	// the notice and fill in the information without loading the activity.
	WinnerNotice string                              `json:"winner_notice"`
	WinnerFields LotteryJSONList[LotteryWinnerField] `json:"winner_fields"`
}

func ListUserLotteryWins(userId int, limit int) ([]LotteryWin, error) {
	var entries []LotteryEntry
	if err := DB.Where("user_id = ? AND prize_id > 0", userId).Order("id desc").Limit(limit).Find(&entries).Error; err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.ActivityId)
	}
	var activities []LotteryActivity
	if len(ids) > 0 {
		if err := DB.Select("id", "title", "winner_notice", "winner_fields").Where("id IN ?", ids).Find(&activities).Error; err != nil {
			return nil, err
		}
	}
	byId := make(map[int]LotteryActivity, len(activities))
	for _, activity := range activities {
		byId[activity.Id] = activity
	}
	wins := make([]LotteryWin, len(entries))
	for i, entry := range entries {
		activity := byId[entry.ActivityId]
		wins[i] = LotteryWin{LotteryEntry: entry, ActivityTitle: activity.Title, WinnerNotice: activity.WinnerNotice, WinnerFields: activity.WinnerFields}
	}
	return wins, nil
}

// SubmitLotteryWinnerInfo saves what the winner of a manually delivered prize
// filled in for the activity's winner fields, one value per field in the same
// order. It can be corrected until the prize is marked as delivered.
func SubmitLotteryWinnerInfo(entryId int, userId int, values []string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var entry LotteryEntry
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND prize_id > 0", entryId, userId).First(&entry).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Prize not found")
			}
			return err
		}
		if entry.PrizeType != LotteryPrizeManual {
			return common.NewMessage("This prize is delivered automatically and needs no information")
		}
		if entry.DeliveryStatus == LotteryDeliveryDelivered {
			return common.NewMessage("This prize has already been delivered")
		}
		var activity LotteryActivity
		if err := tx.Select("winner_fields").First(&activity, entry.ActivityId).Error; err != nil {
			return err
		}
		if len(activity.WinnerFields) == 0 || len(values) != len(activity.WinnerFields) {
			return common.NewMessage("The information this activity asks for has changed. Refresh and try again.")
		}
		answers := make(LotteryJSONList[LotteryWinnerAnswer], len(values))
		for i, field := range activity.WinnerFields {
			value := strings.TrimSpace(values[i])
			if value == "" && field.Required {
				return common.NewMessage("{{label}} is required", map[string]any{"label": field.Label})
			}
			if utf8.RuneCountInString(value) > maxLotteryWinnerValueLength {
				return common.NewMessage("{{label}} must be at most 255 characters", map[string]any{"label": field.Label})
			}
			answers[i] = LotteryWinnerAnswer{Label: field.Label, Value: value}
		}
		return tx.Model(&LotteryEntry{}).Where("id = ?", entry.Id).
			Updates(map[string]any{"winner_info": answers, "winner_info_at": common.GetTimestamp()}).Error
	})
}

// LotteryWinNotice is a win whose email is due, with what the email says and
// who receives it.
type LotteryWinNotice struct {
	UserId        int
	Email         string
	Setting       dto.UserSetting
	PrizeName     string
	ActivityTitle string
	WinnerNotice  string
	// WinnerFields is empty for a prize the system delivers on its own.
	WinnerFields LotteryJSONList[LotteryWinnerField]
}

// TakeDueLotteryWinNotices hands out the wins whose email has not been sent.
// Each win is handed out once, even with several nodes asking: a win is
// marked before it is returned, so a mail that then fails is not retried.
func TakeDueLotteryWinNotices(limit int) ([]LotteryWinNotice, error) {
	var entries []LotteryEntry
	if err := DB.Select("id", "activity_id", "user_id", "prize_name", "prize_type").
		Where("win_notice = ?", lotteryWinNoticePending).Order("id asc").Limit(limit).Find(&entries).Error; err != nil {
		return nil, err
	}
	var notices []LotteryWinNotice
	for _, entry := range entries {
		result := DB.Model(&LotteryEntry{}).Where("id = ? AND win_notice = ?", entry.Id, lotteryWinNoticePending).
			Update("win_notice", lotteryWinNoticeSent)
		if result.Error != nil {
			return notices, result.Error
		}
		if result.RowsAffected != 1 {
			continue
		}
		var activity LotteryActivity
		if err := DB.Select("title", "winner_notice", "winner_fields").First(&activity, entry.ActivityId).Error; err != nil {
			continue
		}
		var user User
		if err := DB.Select("id", "email", "setting").Where("id = ? AND status = ?", entry.UserId, common.UserStatusEnabled).First(&user).Error; err != nil {
			continue
		}
		if entry.PrizeType != LotteryPrizeManual {
			activity.WinnerFields = nil
		}
		notices = append(notices, LotteryWinNotice{UserId: user.Id, Email: user.Email, Setting: user.GetSetting(), PrizeName: entry.PrizeName,
			ActivityTitle: activity.Title, WinnerNotice: activity.WinnerNotice, WinnerFields: activity.WinnerFields})
	}
	return notices, nil
}

// RunDueLotteryDraws draws scheduled activities whose draw time has passed
// and participant-count activities that reached their target or ended, locks
// the ranks of ended leaderboards, then retries automatic prizes left pending
// by an interrupted delivery.
func RunDueLotteryDraws() error {
	now := common.GetTimestamp()
	var ended []LotteryActivity
	if err := DB.Select("id").Where("status = ? AND mode = ? AND end_time > 0 AND end_time <= ?",
		LotteryStatusActive, LotteryModeLeaderboard, now).Find(&ended).Error; err != nil {
		return err
	}
	for _, activity := range ended {
		if err := LockLeaderboard(activity.Id); err != nil {
			common.SysError(common.LogText("leaderboard lock of activity %d failed: %v", activity.Id, err))
		}
	}
	var due []LotteryActivity
	err := DB.Select("id").Where("status = ?", LotteryStatusActive).
		Where("(mode = ? AND draw_time > 0 AND draw_time <= ?) OR (mode = ? AND (entry_count >= target_participants OR (end_time > 0 AND end_time <= ?)))",
			LotteryModeScheduled, now, LotteryModeParticipants, now).
		Find(&due).Error
	if err != nil {
		return err
	}
	for _, activity := range due {
		if err := DrawLotteryActivity(activity.Id); err != nil {
			common.SysError(common.LogText("lottery draw of activity %d failed: %v", activity.Id, err))
		}
	}
	var stale []LotteryEntry
	err = DB.Select("id").
		Where("delivery_status = ? AND prize_type IN ? AND created_at < ?", LotteryDeliveryPending, []string{LotteryPrizeQuota, LotteryPrizeSubscription}, now-60).
		Limit(100).Find(&stale).Error
	if err != nil {
		return err
	}
	for _, entry := range stale {
		if err := DeliverLotteryEntry(entry.Id); err != nil {
			common.SysError(common.LogText("lottery prize delivery of entry %d failed: %v", entry.Id, err))
		}
	}
	return nil
}
