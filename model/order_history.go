package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// BillingRecord is a read-only projection. Subscription orders are authoritative;
// their legacy top-up mirrors are excluded from both counting and pagination.
type BillingRecord struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no"`
	PaymentMethod   string  `json:"payment_method"`
	PaymentProvider string  `json:"payment_provider"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	Status          string  `json:"status"`
	OrderType       string  `json:"order_type"`
	PlanId          int     `json:"plan_id,omitempty"`
	PlanTitle       string  `json:"plan_title,omitempty"`
}

func containsSearchPattern(keyword string) string {
	return "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(keyword) + "%"
}

func queryBillingHistory(userId int, admin bool, keyword string, page *common.PageInfo) (records []*BillingRecord, total int64, err error) {
	keyword = strings.TrimSpace(keyword)
	if len(keyword) > 255 {
		return nil, 0, errors.New("搜索内容过长")
	}
	records = make([]*BillingRecord, 0)
	err = DB.Transaction(func(tx *gorm.DB) error {
		topups := tx.Table("top_ups AS t").Select("t.id, t.user_id, t.amount, t.money, t.trade_no, t.payment_method, t.payment_provider, t.create_time, t.complete_time, t.status, 'topup' AS order_type, 0 AS plan_id, '' AS plan_title").
			Where("NOT EXISTS (?)", tx.Table("subscription_orders AS s").Select("1").Where("s.trade_no = t.trade_no"))
		subscriptions := tx.Table("subscription_orders AS s").Select("s.id, s.user_id, 0 AS amount, s.money, s.trade_no, s.payment_method, s.payment_provider, s.create_time, s.complete_time, s.status, 'subscription' AS order_type, s.plan_id, COALESCE(p.title, '') AS plan_title").
			Joins("LEFT JOIN subscription_plans AS p ON p.id = s.plan_id")
		// UNION ALL is needed to apply one database ordering and offset to both
		// sources. Its SQL is dialect-neutral; values stay bound parameters.
		query := tx.Table("(? UNION ALL ?) AS orders", topups, subscriptions)
		if !admin {
			query = query.Where("orders.user_id = ? AND orders.create_time >= ?", userId, topUpQueryCutoff())
		}
		if keyword != "" {
			pattern := containsSearchPattern(keyword)
			condition := "orders.trade_no LIKE ? ESCAPE '!'"
			args := []any{pattern}
			if admin {
				users := tx.Unscoped().Model(&User{}).Select("id").Where("username LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!'", pattern, pattern, pattern)
				condition += " OR orders.user_id IN (?)"
				args = append(args, users)
				if id, parseErr := strconv.Atoi(keyword); parseErr == nil && id > 0 {
					condition += " OR orders.user_id = ?"
					args = append(args, id)
				}
			}
			query = query.Where("("+condition+")", args...)
		}
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		if keyword != "" {
			query = query.Select("orders.*, CASE WHEN orders.trade_no = ? THEN 0 ELSE 1 END AS search_rank", keyword).Order("search_rank ASC")
		} else {
			query = query.Select("orders.*")
		}
		size := min(max(page.GetPageSize(), 1), 100)
		return query.Order("orders.create_time DESC, orders.trade_no DESC, orders.order_type ASC").Limit(size).Offset(max(page.GetStartIdx(), 0)).Scan(&records).Error
	})
	return
}
