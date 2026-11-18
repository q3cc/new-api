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

	TicketPriorityUrgent = "urgent"
	TicketPriorityHigh   = "high"
	TicketPriorityNormal = "normal"
	TicketPriorityLow    = "low"

	TicketClosedByUser   = "user"
	TicketClosedByAdmin  = "admin"
	TicketClosedBySystem = "system"

	// TicketMessageNote marks a post only support can see; a reply has no
	// kind.
	TicketMessageNote = "note"
)

// TicketPriorities lists the priorities from most to least pressing.
var TicketPriorities = []string{TicketPriorityUrgent, TicketPriorityHigh, TicketPriorityNormal, TicketPriorityLow}

// Personal message a user receives when support answers a ticket; the console
// translates the English keys with the params.
const (
	UserMessageTicketRepliedTitle   = "Ticket replied"
	UserMessageTicketRepliedContent = "Support replied to your ticket #{{id}} \"{{title}}\"."
)

var (
	ErrTicketClosed      = common.NewMessage("This ticket is closed")
	ErrTicketNotClosed   = common.NewMessage("This ticket is not closed")
	ErrTicketRated       = common.NewMessage("This ticket has already been rated")
	ErrTicketNotRateable = common.NewMessage("A ticket can be rated once it is closed")
)

// Ticket is a support conversation a user opened. Status says whose turn it
// is: open waits for support, replied waits for the user.
type Ticket struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"not null;index:idx_ticket_user_updated,priority:1"`
	Title        string `json:"title" gorm:"type:varchar(128);not null"`
	Category     string `json:"category" gorm:"type:varchar(32);not null"`
	Status       string `json:"status" gorm:"type:varchar(16);not null;index:idx_ticket_status_updated,priority:1"`
	Priority     string `json:"priority" gorm:"type:varchar(16);not null;default:'normal'"`
	TopUpTradeNo string `json:"topup_trade_no" gorm:"type:varchar(255);not null;default:''"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64);not null;default:''"`
	AssigneeId   int    `json:"assignee_id" gorm:"not null;default:0;index"`
	UserUnread   bool   `json:"user_unread" gorm:"not null"`
	AdminUnread  bool   `json:"admin_unread" gorm:"not null"`
	// The times are written by this file, so marking a ticket read never
	// reorders the lists sorted by UpdatedAt.
	CreatedAt int64 `json:"created_at" gorm:"not null;autoCreateTime:false"`
	UpdatedAt int64 `json:"updated_at" gorm:"not null;autoUpdateTime:false;index:idx_ticket_user_updated,priority:2;index:idx_ticket_status_updated,priority:2"`
	// WaitingSince is when the ticket last started waiting for support: its
	// creation, the user's latest reply or its reopening. The response target
	// counts from it.
	WaitingSince   int64  `json:"waiting_since" gorm:"not null;default:0"`
	FirstRepliedAt int64  `json:"first_replied_at" gorm:"not null;default:0"`
	ClosedAt       int64  `json:"closed_at" gorm:"not null;default:0"`
	ClosedBy       string `json:"closed_by" gorm:"type:varchar(16);not null;default:''"`
	Rating         int    `json:"rating" gorm:"not null;default:0"`
	RatingComment  string `json:"rating_comment" gorm:"type:varchar(500);not null;default:''"`
	RatedAt        int64  `json:"rated_at" gorm:"not null;default:0"`
	Username       string `json:"username,omitempty" gorm:"-"`
	// ResponseDueAt is when an open ticket's response target runs out.
	ResponseDueAt int64 `json:"response_due_at,omitempty" gorm:"-"`
}

// TicketMessage is one post in a ticket, by its owner or by support. Kind is
// empty for a reply and TicketMessageNote for a note only support sees.
type TicketMessage struct {
	Id          int                `json:"id"`
	TicketId    int                `json:"ticket_id" gorm:"not null;index"`
	UserId      int                `json:"user_id" gorm:"not null"`
	IsStaff     bool               `json:"is_staff" gorm:"not null"`
	Kind        string             `json:"kind" gorm:"type:varchar(16);not null;default:''"`
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

// TicketCannedReply is a reply text support staff share and insert into
// their answers.
type TicketCannedReply struct {
	Id        int    `json:"id"`
	Title     string `json:"title" gorm:"type:varchar(64);not null"`
	Content   string `json:"content" gorm:"type:text;not null"`
	UpdatedBy int    `json:"updated_by" gorm:"not null;default:0"`
	CreatedAt int64  `json:"created_at" gorm:"not null;autoCreateTime:false"`
	UpdatedAt int64  `json:"updated_at" gorm:"not null;autoUpdateTime:false"`
}

// TicketFilter narrows the support queue. Zero values do not filter.
// OverdueBefore keeps only open tickets that have waited for support since
// before the cutoff of their priority.
type TicketFilter struct {
	Status        string
	Category      string
	Priority      string
	UserId        int
	AssigneeId    int
	Keyword       string
	OverdueBefore map[string]int64
}

// TicketSummary counts the support queue for the console badges.
type TicketSummary struct {
	Open    int64 `json:"open"`
	Overdue int64 `json:"overdue"`
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
		ticket.Status, ticket.Priority = TicketStatusOpen, TicketPriorityNormal
		ticket.AdminUnread = true
		ticket.CreatedAt, ticket.UpdatedAt, ticket.WaitingSince = now, now, now
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

// ReplyTicket adds a message to a ticket. A reply needs the ticket not to be
// closed and hands the turn to the other side; the first staff member to
// reply becomes the assignee. A note is kept for support only and changes
// nothing else, so it may go on a closed ticket too. ownerId limits the
// ticket to that user; staff pass 0.
func ReplyTicket(ticketId int, ownerId int, message *TicketMessage, attachments []TicketAttachment) (*Ticket, error) {
	var ticket Ticket
	now := common.GetTimestamp()
	note := message.Kind == TicketMessageNote
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(ticketScope(tx, ticketId, ownerId)).First(&ticket).Error; err != nil {
			return err
		}
		if ticket.Status == TicketStatusClosed && !note {
			return ErrTicketClosed
		}
		message.TicketId, message.CreatedAt = ticket.Id, now
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		if err := createTicketAttachmentsTx(tx, ticket.Id, message, attachments); err != nil {
			return err
		}
		if note {
			return nil
		}
		updates := map[string]any{"updated_at": now}
		if message.IsStaff {
			updates["status"], updates["user_unread"], updates["admin_unread"] = TicketStatusReplied, true, false
			if ticket.AssigneeId == 0 {
				updates["assignee_id"] = message.UserId
			}
			if ticket.FirstRepliedAt == 0 {
				updates["first_replied_at"] = now
			}
		} else {
			updates["status"], updates["user_unread"], updates["admin_unread"] = TicketStatusOpen, false, true
			updates["waiting_since"] = now
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

// ReopenTicket puts a closed ticket back in the support queue; its response
// target counts again from now.
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
			"status": TicketStatusOpen, "closed_at": 0, "closed_by": "", "updated_at": now, "waiting_since": now,
		}).Error
	})
}

// SetTicketPriority changes how pressing a ticket is, which also changes its
// response target.
func SetTicketPriority(ticketId int, priority string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := lockForUpdate(tx.Select("id").Where("id = ?", ticketId)).First(&ticket).Error; err != nil {
			return err
		}
		return tx.Model(&Ticket{}).Where("id = ?", ticket.Id).UpdateColumn("priority", priority).Error
	})
}

// RateTicket records the owner's satisfaction with a closed ticket, once.
func RateTicket(ticketId int, ownerId int, rating int, comment string) error {
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := lockForUpdate(ticketScope(tx, ticketId, ownerId)).First(&ticket).Error; err != nil {
			return err
		}
		if ticket.Status != TicketStatusClosed {
			return ErrTicketNotRateable
		}
		if ticket.RatedAt != 0 {
			return ErrTicketRated
		}
		return tx.Model(&Ticket{}).Where("id = ?", ticket.Id).UpdateColumns(map[string]any{
			"rating": rating, "rating_comment": comment, "rated_at": now,
		}).Error
	})
}

// DeleteTicket removes a ticket with all its messages and images.
func DeleteTicket(ticketId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := lockForUpdate(tx.Select("id").Where("id = ?", ticketId)).First(&ticket).Error; err != nil {
			return err
		}
		if err := tx.Where("ticket_id = ?", ticket.Id).Delete(&TicketAttachment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("ticket_id = ?", ticket.Id).Delete(&TicketMessage{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", ticket.Id).Delete(&Ticket{}).Error
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
	if filter.Priority != "" {
		query = query.Where("priority = ?", filter.Priority)
	}
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.AssigneeId > 0 {
		query = query.Where("assignee_id = ?", filter.AssigneeId)
	}
	if filter.OverdueBefore != nil {
		query = query.Where(ticketOverdueCondition(filter.OverdueBefore))
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

// GetTicketSummary counts the tickets waiting for support, those of them
// past their response target, those waiting for users, and those with an
// unread user post.
func GetTicketSummary(overdueBefore map[string]int64) (*TicketSummary, error) {
	summary := &TicketSummary{}
	if err := DB.Model(&Ticket{}).Where("status = ?", TicketStatusOpen).Count(&summary.Open).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Ticket{}).Where(ticketOverdueCondition(overdueBefore)).Count(&summary.Overdue).Error; err != nil {
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
// images' metadata and each author's name. Notes are left out unless
// withNotes.
func ListTicketMessages(ticketId int, withNotes bool) ([]TicketMessage, error) {
	query := DB.Where("ticket_id = ?", ticketId)
	if !withNotes {
		query = query.Where("kind <> ?", TicketMessageNote)
	}
	var messages []TicketMessage
	if err := query.Order("id ASC").Find(&messages).Error; err != nil {
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

// GetTicketAttachment returns an image with its bytes, the owner of its
// ticket, and whether it belongs to a note. The owner may read it unless it
// does.
func GetTicketAttachment(attachmentId int) (*TicketAttachment, int, bool, error) {
	var attachment TicketAttachment
	if err := DB.Where("id = ?", attachmentId).First(&attachment).Error; err != nil {
		return nil, 0, false, err
	}
	var ticket Ticket
	if err := DB.Select("id", "user_id").Where("id = ?", attachment.TicketId).First(&ticket).Error; err != nil {
		return nil, 0, false, err
	}
	var message TicketMessage
	if err := DB.Select("id", "kind").Where("id = ?", attachment.MessageId).First(&message).Error; err != nil {
		return nil, 0, false, err
	}
	return &attachment, ticket.UserId, message.Kind == TicketMessageNote, nil
}

// ListTicketCannedReplies returns the shared reply texts by title.
func ListTicketCannedReplies() ([]TicketCannedReply, error) {
	replies := []TicketCannedReply{}
	err := DB.Order("title ASC").Order("id ASC").Find(&replies).Error
	return replies, err
}

// SaveTicketCannedReply creates a reply text, or updates it when its Id is
// set.
func SaveTicketCannedReply(reply *TicketCannedReply) error {
	now := common.GetTimestamp()
	reply.UpdatedAt = now
	if reply.Id == 0 {
		reply.CreatedAt = now
		return DB.Create(reply).Error
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var existing TicketCannedReply
		if err := lockForUpdate(tx.Where("id = ?", reply.Id)).First(&existing).Error; err != nil {
			return err
		}
		if err := tx.Model(&TicketCannedReply{}).Where("id = ?", reply.Id).UpdateColumns(map[string]any{
			"title": reply.Title, "content": reply.Content, "updated_by": reply.UpdatedBy, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", reply.Id).First(reply).Error
	})
}

// DeleteTicketCannedReply removes a reply text.
func DeleteTicketCannedReply(id int) error {
	result := DB.Where("id = ?", id).Delete(&TicketCannedReply{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
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

// ticketOverdueCondition matches open tickets that have waited for support
// since before the cutoff of their priority.
func ticketOverdueCondition(overdueBefore map[string]int64) *gorm.DB {
	condition := DB.Where("1 = 0")
	for _, priority := range TicketPriorities {
		if cutoff, ok := overdueBefore[priority]; ok {
			condition = condition.Or("priority = ? AND waiting_since < ?", priority, cutoff)
		}
	}
	return DB.Where("status = ?", TicketStatusOpen).Where(condition)
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
