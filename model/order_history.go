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
	Username        string  `json:"username,omitempty"`
	EpayVersionId   int     `json:"-"`
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

func queryBillingHistory(userId int, admin bool, keyword string, page *common.PageInfo, filters BillingHistoryFilter) (records []*BillingRecord, total int64, err error) {
	keyword = strings.TrimSpace(keyword)
	if len(keyword) > 255 {
		return nil, 0, errors.New("搜索内容过长")
	}
	if err := filters.Validate(); err != nil {
		return nil, 0, err
	}
	records = make([]*BillingRecord, 0)
	err = DB.Transaction(func(tx *gorm.DB) error {
		query := billingOrders(tx)
		if admin {
			query = query.Joins("LEFT JOIN users AS owner ON owner.id = orders.user_id")
		}
		if !admin {
			query = query.Where("orders.user_id = ? AND orders.create_time >= ?", userId, topUpQueryCutoff())
		}
		if admin {
			if filters.OrderType != "" {
				query = query.Where("orders.order_type = ?", filters.OrderType)
			}
			if filters.Status != "" {
				query = query.Where("orders.status = ?", filters.Status)
			}
			if filters.PaymentMethod != "" {
				query = query.Where("orders.payment_method = ?", filters.PaymentMethod)
			}
			if filters.StartTimestamp != nil {
				query = query.Where("orders.create_time >= ?", *filters.StartTimestamp)
			}
			if filters.EndTimestamp != nil {
				query = query.Where("orders.create_time <= ?", *filters.EndTimestamp)
			}
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
		columns := "orders.*"
		if admin {
			columns += ", COALESCE(owner.username, '') AS username"
		}
		if keyword != "" {
			query = query.Select(columns+", CASE WHEN orders.trade_no = ? THEN 0 ELSE 1 END AS search_rank", keyword).Order("search_rank ASC")
		} else {
			query = query.Select(columns)
		}
		size := min(max(page.GetPageSize(), 1), 100)
		return query.Order("orders.create_time DESC, orders.trade_no DESC, orders.order_type ASC").Limit(size).Offset(max(page.GetStartIdx(), 0)).Scan(&records).Error
	})
	return
}

type BillingHistoryFilter struct {
	OrderType      string `form:"order_type"`
	Status         string `form:"status"`
	PaymentMethod  string `form:"payment_method"`
	StartTimestamp *int64 `form:"start_timestamp"`
	EndTimestamp   *int64 `form:"end_timestamp"`
}

func (f BillingHistoryFilter) Validate() error {
	if f.OrderType != "" && f.OrderType != "topup" && f.OrderType != "subscription" {
		return common.NewMessage("Invalid parameters")
	}
	switch f.Status {
	case "", common.TopUpStatusPending, common.TopUpStatusSuccess, common.TopUpStatusFailed, common.TopUpStatusExpired:
	default:
		return common.NewMessage("Invalid parameters")
	}
	if len(f.PaymentMethod) > 50 || f.StartTimestamp != nil && *f.StartTimestamp < 0 || f.EndTimestamp != nil && *f.EndTimestamp < 0 || f.StartTimestamp != nil && f.EndTimestamp != nil && *f.StartTimestamp > *f.EndTimestamp {
		return common.NewMessage("Invalid parameters")
	}
	return nil
}

func billingOrders(tx *gorm.DB) *gorm.DB {
	topups := tx.Table("top_ups AS t").Select("t.id, t.user_id, t.amount, t.money, t.trade_no, t.payment_method, t.payment_provider, t.epay_version_id, t.create_time, t.complete_time, t.status, 'topup' AS order_type, 0 AS plan_id, '' AS plan_title").
		Where("NOT EXISTS (?)", tx.Table("subscription_orders AS s").Select("1").Where("s.trade_no = t.trade_no"))
	subscriptions := tx.Table("subscription_orders AS s").Select("s.id, s.user_id, 0 AS amount, s.money, s.trade_no, s.payment_method, s.payment_provider, s.epay_version_id, s.create_time, s.complete_time, s.status, 'subscription' AS order_type, s.plan_id, COALESCE(p.title, '') AS plan_title").
		Joins("LEFT JOIN subscription_plans AS p ON p.id = s.plan_id")
	// UNION ALL is needed to apply one database ordering and offset to both
	// sources. Its SQL is dialect-neutral; values stay bound parameters.
	return tx.Table("(? UNION ALL ?) AS orders", topups, subscriptions)
}

func GetAdminBillingHistory(keyword string, filters BillingHistoryFilter, page *common.PageInfo) ([]*BillingRecord, int64, error) {
	return queryBillingHistory(0, true, keyword, page, filters)
}

func GetBillingPaymentMethods() ([]string, error) {
	methods := []string{}
	err := billingOrders(DB).Where("orders.payment_method <> ?", "").Distinct("orders.payment_method").Order("orders.payment_method ASC").Pluck("orders.payment_method", &methods).Error
	return methods, err
}

type BillingOrderDetail struct {
	BillingRecord
	DisplayName        string `json:"display_name"`
	Email              string `json:"email"`
	PaymentServiceId   string `json:"payment_service_id,omitempty"`
	PaymentServiceName string `json:"payment_service_name,omitempty"`
}

func GetBillingOrderDetail(orderType, tradeNo string) (*BillingOrderDetail, error) {
	if (orderType != "topup" && orderType != "subscription") || strings.TrimSpace(tradeNo) == "" || len(tradeNo) > 255 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var detail BillingOrderDetail
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := billingOrders(tx).Where("orders.order_type = ? AND orders.trade_no = ?", orderType, tradeNo).
			Joins("LEFT JOIN users AS owner ON owner.id = orders.user_id").
			Joins("LEFT JOIN epay_endpoint_versions AS version ON version.id = orders.epay_version_id AND orders.payment_provider = ?", PaymentProviderEpay).
			Joins("LEFT JOIN epay_endpoints AS endpoint ON endpoint.id = version.endpoint_id").
			Select("orders.*, COALESCE(owner.username, '') AS username, COALESCE(owner.display_name, '') AS display_name, COALESCE(owner.email, '') AS email, COALESCE(version.endpoint_id, '') AS payment_service_id, COALESCE(endpoint.name, '') AS payment_service_name").Limit(1).Scan(&detail)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	return &detail, err
}
