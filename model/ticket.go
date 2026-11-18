package model

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	TicketStatusOpen    = "open"
	TicketStatusReplied = "replied"
	TicketStatusClosed  = "closed"

	TicketCategoryBilling = "billing"
	TicketCategoryAPI     = "api"
	TicketCategoryAccount = "account"
	TicketCategoryOther   = "other"

	TicketClosedByUser   = "user"
	TicketClosedByAdmin  = "admin"
	TicketClosedBySystem = "system"
)

// Personal message a user receives when support answers a ticket; the console
// translates the English keys with the params.
const (
	UserMessageTicketRepliedTitle   = "Ticket replied"
	UserMessageTicketRepliedContent = "Support replied to your ticket #{{id}} \"{{title}}\"."
)

var (
	ErrTicketClosed    = common.NewMessage("This ticket is closed")
	ErrTicketNotClosed = common.NewMessage("This ticket is not closed")
)

// Ticket is a support conversation a user opened. Status says whose turn it
// is: open waits for support, replied waits for the user.
type Ticket struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"not null;index:idx_ticket_user_updated,priority:1"`
	Title        string `json:"title" gorm:"type:varchar(128);not null"`
	Category     string `json:"category" gorm:"type:varchar(32);not null"`
	Status       string `json:"status" gorm:"type:varchar(16);not null;index:idx_ticket_status_updated,priority:1"`
	TopUpTradeNo string `json:"topup_trade_no" gorm:"type:varchar(255);not null;default:''"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64);not null;default:''"`
	AssigneeId   int    `json:"assignee_id" gorm:"not null;default:0;index"`
	UserUnread   bool   `json:"user_unread" gorm:"not null"`
	AdminUnread  bool   `json:"admin_unread" gorm:"not null"`
	// The times are written by this file, so marking a ticket read never
	// reorders the lists sorted by UpdatedAt.
	CreatedAt int64  `json:"created_at" gorm:"not null;autoCreateTime:false"`
	UpdatedAt int64  `json:"updated_at" gorm:"not null;autoUpdateTime:false;index:idx_ticket_user_updated,priority:2;index:idx_ticket_status_updated,priority:2"`
	ClosedAt  int64  `json:"closed_at" gorm:"not null;default:0"`
	ClosedBy  string `json:"closed_by" gorm:"type:varchar(16);not null;default:''"`
	Username  string `json:"username,omitempty" gorm:"-"`
}

// TicketMessage is one post in a ticket, by its owner or by support.
type TicketMessage struct {
	Id          int                `json:"id"`
	TicketId    int                `json:"ticket_id" gorm:"not null;index"`
	UserId      int                `json:"user_id" gorm:"not null"`
	IsStaff     bool               `json:"is_staff" gorm:"not null"`
	Content     string             `json:"content" gorm:"type:text;not null"`
	CreatedAt   int64              `json:"created_at" gorm:"not null;autoCreateTime:false"`
	Username    string             `json:"username,omitempty" gorm:"-"`
	Attachments []TicketAttachment `json:"attachments" gorm:"-"`
}

// TicketAttachment is an image posted with a ticket message. Data holds the
// base64 bytes in its own row so a single insert stays under MySQL's default
// packet size; lists never select it.
type TicketAttachment struct {
	Id        int      `json:"id"`
	TicketId  int      `json:"-" gorm:"not null;index"`
	MessageId int      `json:"-" gorm:"not null;index"`
	UserId    int      `json:"-" gorm:"not null"`
	MediaType string   `json:"media_type" gorm:"type:varchar(32);not null"`
	Size      int      `json:"size" gorm:"not null"`
	Data      LongText `json:"-" gorm:"not null"`
	CreatedAt int64    `json:"-" gorm:"not null;autoCreateTime:false"`
}

// TicketFilter narrows the support queue. Zero values do not filter.
type TicketFilter struct {
	Status     string
	Category   string
	UserId     int
	AssigneeId int
	Keyword    string
}

// TicketSummary counts the support queue for the console badges.
type TicketSummary struct {
	Open    int64 `json:"open"`
	Replied int64 `json:"replied"`
	Unread  int64 `json:"unread"`
}

// CreateTicket stores a new ticket with its first message and images, unless
// the user already has maxOpen tickets that are not closed.
func CreateTicket(ticket *Ticket, message *TicketMessage, attachments []TicketAttachment, maxOpen int) error {
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		var open int64
		if err := tx.Model(&Ticket{}).Where("user_id = ? AND status <> ?", ticket.UserId, TicketStatusClosed).
			Count(&open).Error; err != nil {
			return err
		}
		if open >= int64(maxOpen) {
			return common.NewMessage("You can have at most {{count}} unresolved tickets", map[string]any{"count": maxOpen})
		}
		ticket.Status = TicketStatusOpen
		ticket.AdminUnread = true
		ticket.CreatedAt, ticket.UpdatedAt = now, now
		if err := tx.Create(ticket).Error; err != nil {
			return err
		}
		message.TicketId, message.UserId, message.IsStaff, message.CreatedAt = ticket.Id, ticket.UserId, false, now
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		return createTicketAttachmentsTx(tx, ticket.Id, message, attachments)
	})
}

// ReplyTicket adds a message to a ticket that is not closed and hands the
// turn to the other side. ownerId limits the ticket to that user; staff
// replies pass 0. The first staff member to reply becomes the assignee.
func ReplyTicket(ticketId int, ownerId int, message *TicketMessage, attachments []TicketAttachment) (*Ticket, error) {
	var ticket Ticket
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(ticketScope(tx, ticketId, ownerId)).First(&ticket).Error; err != nil {
			return err
		}
		if ticket.Status == TicketStatusClosed {
			return ErrTicketClosed
		}
		message.TicketId, message.CreatedAt = ticket.Id, now
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		if err := createTicketAttachmentsTx(tx, ticket.Id, message, attachments); err != nil {
			return err
		}
		updates := map[string]any{"updated_at": now}
		if message.IsStaff {
			updates["status"], updates["user_unread"], updates["admin_unread"] = TicketStatusReplied, true, false
			if ticket.AssigneeId == 0 {
				updates["assignee_id"] = message.UserId
			}
		} else {
			updates["status"], updates["user_unread"], updates["admin_unread"] = TicketStatusOpen, false, true
		}
		if err := tx.Model(&Ticket{}).Where("id = ?", ticket.Id).UpdateColumns(updates).Error; err != nil {
			return err
		}
		if message.IsStaff {
			notice := UserMessage{UserId: ticket.UserId, Title: UserMessageTicketRepliedTitle, Content: UserMessageTicketRepliedContent,
				Params: MessageParams{"id": ticket.Id, "title": ticket.Title}, CreatedAt: now}
			if err := tx.Create(&notice).Error; err != nil {
				return err
			}
		}
		return tx.Where("id = ?", ticket.Id).First(&ticket).Error
	})
	if err != nil {
		return nil, err
	}
	return &ticket, nil
}

// CloseTicket closes a ticket that is not closed yet. ownerId limits the
// ticket to that user; staff pass 0.
func CloseTicket(ticketId int, ownerId int, closedBy string) error {
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := lockForUpdate(ticketScope(tx, ticketId, ownerId)).First(&ticket).Error; err != nil {
			return err
		}
		if ticket.Status == TicketStatusClosed {
			return ErrTicketClosed
		}
		return tx.Model(&Ticket{}).Where("id = ?", ticket.Id).UpdateColumns(map[string]any{
			"status": TicketStatusClosed, "closed_at": now, "closed_by": closedBy, "updated_at": now,
			"user_unread": false, "admin_unread": false,
		}).Error
	})
}

// ReopenTicket puts a closed ticket back in the support queue.
func ReopenTicket(ticketId int) error {
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := lockForUpdate(tx.Where("id = ?", ticketId)).First(&ticket).Error; err != nil {
			return err
		}
		if ticket.Status != TicketStatusClosed {
			return ErrTicketNotClosed
		}
		return tx.Model(&Ticket{}).Where("id = ?", ticket.Id).UpdateColumns(map[string]any{
			"status": TicketStatusOpen, "closed_at": 0, "closed_by": "", "updated_at": now,
		}).Error
	})
}

// GetTicket returns a ticket with its owner's name; ownerId limits it to that
// user, 0 does not.
func GetTicket(ticketId int, ownerId int) (*Ticket, error) {
	var ticket Ticket
	if err := ticketScope(DB, ticketId, ownerId).First(&ticket).Error; err != nil {
		return nil, err
	}
	names, err := ticketUserNames([]int{ticket.UserId})
	if err != nil {
		return nil, err
	}
	ticket.Username = names[ticket.UserId]
	return &ticket, nil
}

// MarkTicketRead clears the unread flag of one side without touching the
// ticket's order.
func MarkTicketRead(ticketId int, staff bool) error {
	column := "user_unread"
	if staff {
		column = "admin_unread"
	}
	return DB.Model(&Ticket{}).Where("id = ? AND "+column+" = ?", ticketId, true).UpdateColumn(column, false).Error
}

// ListUserTickets returns a page of the user's tickets, most recently active
// first, with how many carry an unread support reply.
func ListUserTickets(userId int, status string, pageInfo *common.PageInfo) ([]Ticket, int64, int64, error) {
	query := DB.Model(&Ticket{}).Where("user_id = ?", userId)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total, unread int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}
	if err := DB.Model(&Ticket{}).Where("user_id = ? AND user_unread = ?", userId, true).Count(&unread).Error; err != nil {
		return nil, 0, 0, err
	}
	var tickets []Ticket
	if err := query.Order("updated_at DESC").Order("id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&tickets).Error; err != nil {
		return nil, 0, 0, err
	}
	return tickets, total, unread, nil
}

// CountUserUnreadTickets counts the user's tickets with an unread support
// reply.
func CountUserUnreadTickets(userId int) (int64, error) {
	var unread int64
	err := DB.Model(&Ticket{}).Where("user_id = ? AND user_unread = ?", userId, true).Count(&unread).Error
	return unread, err
}

// ListTickets returns a page of the support queue, most recently active
// first, with each owner's name.
func ListTickets(filter TicketFilter, pageInfo *common.PageInfo) ([]Ticket, int64, error) {
	query := DB.Model(&Ticket{})
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.AssigneeId > 0 {
		query = query.Where("assignee_id = ?", filter.AssigneeId)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR title LIKE ?", id, "%"+keyword+"%")
		} else {
			query = query.Where("title LIKE ?", "%"+keyword+"%")
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tickets []Ticket
	if err := query.Order("updated_at DESC").Order("id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&tickets).Error; err != nil {
		return nil, 0, err
	}
	userIds := make([]int, 0, len(tickets))
	for _, ticket := range tickets {
		userIds = append(userIds, ticket.UserId)
	}
	names, err := ticketUserNames(userIds)
	if err != nil {
		return nil, 0, err
	}
	for i := range tickets {
		tickets[i].Username = names[tickets[i].UserId]
	}
	return tickets, total, nil
}

// GetTicketSummary counts the tickets waiting for support, those waiting for
// users, and those with an unread user post.
func GetTicketSummary() (*TicketSummary, error) {
	summary := &TicketSummary{}
	if err := DB.Model(&Ticket{}).Where("status = ?", TicketStatusOpen).Count(&summary.Open).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Ticket{}).Where("status = ?", TicketStatusReplied).Count(&summary.Replied).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Ticket{}).Where("admin_unread = ?", true).Count(&summary.Unread).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

// ListTicketMessages returns a ticket's messages, oldest first, with their
// images' metadata and each author's name.
func ListTicketMessages(ticketId int) ([]TicketMessage, error) {
	var messages []TicketMessage
	if err := DB.Where("ticket_id = ?", ticketId).Order("id ASC").Find(&messages).Error; err != nil {
		return nil, err
	}
	var attachments []TicketAttachment
	if err := DB.Select("id", "message_id", "media_type", "size").
		Where("ticket_id = ?", ticketId).Order("id ASC").Find(&attachments).Error; err != nil {
		return nil, err
	}
	byMessage := make(map[int][]TicketAttachment, len(messages))
	for _, attachment := range attachments {
		byMessage[attachment.MessageId] = append(byMessage[attachment.MessageId], attachment)
	}
	userIds := make([]int, 0, len(messages))
	for _, message := range messages {
		userIds = append(userIds, message.UserId)
	}
	names, err := ticketUserNames(userIds)
	if err != nil {
		return nil, err
	}
	for i := range messages {
		messages[i].Attachments = byMessage[messages[i].Id]
		if messages[i].Attachments == nil {
			messages[i].Attachments = []TicketAttachment{}
		}
		messages[i].Username = names[messages[i].UserId]
	}
	return messages, nil
}

// GetTicketAttachment returns an image with its bytes and the owner of its
// ticket, who may always read it.
func GetTicketAttachment(attachmentId int) (*TicketAttachment, int, error) {
	var attachment TicketAttachment
	if err := DB.Where("id = ?", attachmentId).First(&attachment).Error; err != nil {
		return nil, 0, err
	}
	var ticket Ticket
	if err := DB.Select("id", "user_id").Where("id = ?", attachment.TicketId).First(&ticket).Error; err != nil {
		return nil, 0, err
	}
	return &attachment, ticket.UserId, nil
}

// TopUpBelongsToUser reports whether the top-up order is the user's.
func TopUpBelongsToUser(tradeNo string, userId int) (bool, error) {
	var count int64
	err := DB.Model(&TopUp{}).Where("trade_no = ? AND user_id = ?", tradeNo, userId).Count(&count).Error
	return count > 0, err
}

// AutoCloseRepliedTickets closes the tickets whose support reply has waited
// for the user since before the given time, and returns how many it closed.
func AutoCloseRepliedTickets(before int64) (int64, error) {
	now := common.GetTimestamp()
	result := DB.Model(&Ticket{}).Where("status = ? AND updated_at < ?", TicketStatusReplied, before).
		UpdateColumns(map[string]any{
			"status": TicketStatusClosed, "closed_at": now, "closed_by": TicketClosedBySystem, "updated_at": now,
		})
	return result.RowsAffected, result.Error
}

func ticketScope(tx *gorm.DB, ticketId int, ownerId int) *gorm.DB {
	query := tx.Where("id = ?", ticketId)
	if ownerId > 0 {
		query = query.Where("user_id = ?", ownerId)
	}
	return query
}

func createTicketAttachmentsTx(tx *gorm.DB, ticketId int, message *TicketMessage, attachments []TicketAttachment) error {
	if len(attachments) == 0 {
		return nil
	}
	for i := range attachments {
		attachments[i].TicketId, attachments[i].MessageId = ticketId, message.Id
		attachments[i].UserId, attachments[i].CreatedAt = message.UserId, message.CreatedAt
	}
	// One row per insert keeps each statement under MySQL's packet limit.
	for i := range attachments {
		if err := tx.Create(&attachments[i]).Error; err != nil {
			return err
		}
	}
	return nil
}

func ticketUserNames(userIds []int) (map[int]string, error) {
	names := make(map[int]string, len(userIds))
	if len(userIds) == 0 {
		return names, nil
	}
	var users []User
	if err := DB.Unscoped().Select("id", "username", "display_name").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		names[user.Id] = user.DisplayName
		if names[user.Id] == "" {
			names[user.Id] = user.Username
		}
	}
	return names, nil
}
