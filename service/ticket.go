package service

import (
	"context"
	"encoding/base64"
	"html"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	TicketTitleMaxLength      = 128
	TicketContentMaxLength    = 5000
	TicketMaxOpenPerUser      = 5
	TicketMaxImagesPerMessage = 3
	TicketMaxImageBytes       = 2 << 20

	ticketNotifyType        = "ticket"
	ticketAutoCloseAfter    = 7 * 24 * time.Hour
	ticketAutoCloseInterval = time.Hour
)

var (
	ticketCategories       = []string{model.TicketCategoryBilling, model.TicketCategoryAPI, model.TicketCategoryAccount, model.TicketCategoryOther}
	ticketImageMediaTypes  = []string{"image/png", "image/jpeg", "image/gif", "image/webp"}
	ticketRequestIdPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)

	ticketAutoCloseOnce    sync.Once
	ticketAutoCloseRunning atomic.Bool
)

// TicketDraft is what a user submits to open a ticket. Images are the raw
// bytes of the uploaded files.
type TicketDraft struct {
	Title        string
	Category     string
	Content      string
	TopUpTradeNo string
	RequestId    string
	Images       [][]byte
}

// OpenTicket validates a draft and stores it as a new ticket, then tells the
// administrators who receive ticket notices.
func OpenTicket(userId int, username string, draft TicketDraft) (*model.Ticket, error) {
	title := strings.TrimSpace(draft.Title)
	if title == "" {
		return nil, common.NewMessage("Title is required")
	}
	if utf8.RuneCountInString(title) > TicketTitleMaxLength {
		return nil, common.NewMessage("Title must be at most {{max}} characters", map[string]any{"max": TicketTitleMaxLength})
	}
	if !slices.Contains(ticketCategories, draft.Category) {
		return nil, common.NewMessage("Invalid ticket category")
	}
	content, err := normalizeTicketContent(draft.Content)
	if err != nil {
		return nil, err
	}
	tradeNo := strings.TrimSpace(draft.TopUpTradeNo)
	if tradeNo != "" {
		owned, err := model.TopUpBelongsToUser(tradeNo, userId)
		if err != nil {
			return nil, err
		}
		if !owned {
			return nil, common.NewMessage("Top-up order not found")
		}
	}
	requestId := strings.TrimSpace(draft.RequestId)
	if requestId != "" && !ticketRequestIdPattern.MatchString(requestId) {
		return nil, common.NewMessage("Invalid request ID")
	}
	attachments, err := ticketAttachmentsFromImages(draft.Images)
	if err != nil {
		return nil, err
	}

	ticket := &model.Ticket{UserId: userId, Title: title, Category: draft.Category, TopUpTradeNo: tradeNo, RequestId: requestId}
	message := &model.TicketMessage{Content: content}
	if err := model.CreateTicket(ticket, message, attachments, TicketMaxOpenPerUser); err != nil {
		return nil, err
	}
	params := map[string]any{"Id": ticket.Id, "Title": html.EscapeString(ticket.Title), "User": html.EscapeString(username),
		"Link": PaymentReturnURL("/tickets/manage/" + strconv.Itoa(ticket.Id))}
	gopool.Go(func() {
		notifyTicketWatchers(func(lang string) (string, string) {
			return i18n.Translate(lang, i18n.MsgTicketNotifyNewSubject, params), i18n.Translate(lang, i18n.MsgTicketNotifyNewContent, params)
		})
	})
	return ticket, nil
}

// PostTicketReply adds a message to a ticket that is not closed. A staff
// reply notifies the ticket's owner; a user reply notifies the administrators
// who receive ticket notices. ownerId limits the ticket to that user and is 0
// for staff.
func PostTicketReply(ticketId int, ownerId int, authorId int, authorName string, staff bool, content string, images [][]byte) (*model.Ticket, error) {
	content, err := normalizeTicketContent(content)
	if err != nil {
		return nil, err
	}
	attachments, err := ticketAttachmentsFromImages(images)
	if err != nil {
		return nil, err
	}
	message := &model.TicketMessage{UserId: authorId, IsStaff: staff, Content: content}
	ticket, err := model.ReplyTicket(ticketId, ownerId, message, attachments)
	if err != nil {
		return nil, err
	}
	params := map[string]any{"Id": ticket.Id, "Title": html.EscapeString(ticket.Title), "User": html.EscapeString(authorName)}
	if staff {
		params["Link"] = PaymentReturnURL("/tickets/" + strconv.Itoa(ticket.Id))
		gopool.Go(func() {
			notifyTicketOwner(ticket.UserId, params)
		})
		return ticket, nil
	}
	params["Link"] = PaymentReturnURL("/tickets/manage/" + strconv.Itoa(ticket.Id))
	gopool.Go(func() {
		notifyTicketWatchers(func(lang string) (string, string) {
			return i18n.Translate(lang, i18n.MsgTicketNotifyUserReplySubject, params), i18n.Translate(lang, i18n.MsgTicketNotifyUserReplyContent, params)
		})
	})
	return ticket, nil
}

// ticketAttachmentsFromImages checks the images posted with a ticket message
// by count, size and content, and returns them ready to store. Only PNG,
// JPEG, GIF and WebP are accepted: the type is read from the bytes, never from
// the file name, and SVG is refused because it can carry scripts.
func ticketAttachmentsFromImages(images [][]byte) ([]model.TicketAttachment, error) {
	if len(images) > TicketMaxImagesPerMessage {
		return nil, common.NewMessage("At most {{count}} images per message", map[string]any{"count": TicketMaxImagesPerMessage})
	}
	attachments := make([]model.TicketAttachment, 0, len(images))
	for _, image := range images {
		if len(image) == 0 {
			continue
		}
		if len(image) > TicketMaxImageBytes {
			return nil, common.NewMessage("Each image must be at most {{size}} MB", map[string]any{"size": TicketMaxImageBytes >> 20})
		}
		mediaType := http.DetectContentType(image)
		if !slices.Contains(ticketImageMediaTypes, mediaType) {
			return nil, common.NewMessage("Only PNG, JPEG, GIF and WebP images are supported")
		}
		attachments = append(attachments, model.TicketAttachment{
			MediaType: mediaType,
			Size:      len(image),
			Data:      model.LongText(base64.StdEncoding.EncodeToString(image)),
		})
	}
	return attachments, nil
}

// StartTicketAutoCloseTask closes, hourly on the master node, tickets whose
// support reply has waited for the user for 7 days.
func StartTicketAutoCloseTask() {
	ticketAutoCloseOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(ticketAutoCloseInterval)
			defer ticker.Stop()
			if !runBackgroundRound(autoCloseIdleTickets) {
				return
			}
			for range ticker.C {
				if !ticketAutoCloseRunning.CompareAndSwap(false, true) {
					continue
				}
				running := runBackgroundRound(autoCloseIdleTickets)
				ticketAutoCloseRunning.Store(false)
				if !running {
					return
				}
			}
		})
	})
}

func autoCloseIdleTickets() {
	closed, err := model.AutoCloseRepliedTickets(time.Now().Add(-ticketAutoCloseAfter).Unix())
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("ticket auto close failed: %v", err))
		return
	}
	if closed > 0 {
		logger.LogInfo(context.Background(), common.LogText("ticket auto close closed %d tickets", closed))
	}
}

func normalizeTicketContent(content string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", common.NewMessage("Message content is required")
	}
	if utf8.RuneCountInString(content) > TicketContentMaxLength {
		return "", common.NewMessage("Message must be at most {{max}} characters", map[string]any{"max": TicketContentMaxLength})
	}
	return content, nil
}

// notifyTicketWatchers sends a ticket notice to every administrator who
// receives them. Until they choose, the root user receives them and other
// administrators do not.
func notifyTicketWatchers(render func(lang string) (subject string, content string)) {
	notifyAdmins(ticketNotifyType, func(role int, setting dto.UserSetting) bool {
		if setting.TicketNotifyEnabled != nil {
			return *setting.TicketNotifyEnabled
		}
		return role == common.RoleRootUser
	}, render)
}

func notifyTicketOwner(userId int, params map[string]any) {
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.SysLog(common.LogText("failed to load user %d for ticket notice: %s", userId, err.Error()))
		return
	}
	setting := user.GetSetting()
	subject := i18n.Translate(setting.Language, i18n.MsgTicketNotifyStaffReplySubject, params)
	content := i18n.Translate(setting.Language, i18n.MsgTicketNotifyStaffReplyContent, params)
	if err := NotifyUser(user.Id, user.Email, setting, dto.NewNotify(ticketNotifyType, subject, content, nil)); err != nil {
		common.SysLog(common.LogText("failed to send ticket notice to user %d: %s", user.Id, err.Error()))
	}
}
