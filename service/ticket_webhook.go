package service

import (
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// Ticket events posted to the ticket webhook.
const (
	TicketEventCreated  = "ticket.created"
	TicketEventReplied  = "ticket.replied"
	TicketEventReopened = "ticket.reopened"
	TicketEventRated    = "ticket.rated"

	ticketEventContentMaxLength = 300
)

// TicketEvent is the body the ticket webhook receives. X-Webhook-Signature is
// the hex HMAC-SHA256 of the body under the shared secret; a receiver should
// also reject an old timestamp and a delivery ID it has already seen.
type TicketEvent struct {
	Event      string            `json:"event"`
	DeliveryId string            `json:"delivery_id"`
	Timestamp  int64             `json:"timestamp"`
	Ticket     TicketEventTicket `json:"ticket"`
	Content    string            `json:"content,omitempty"`
	ImageCount int               `json:"image_count,omitempty"`
	Rating     int               `json:"rating,omitempty"`
	Link       string            `json:"link"`
}

// TicketEventTicket is the ticket a TicketEvent is about.
type TicketEventTicket struct {
	Id           int    `json:"id"`
	Title        string `json:"title"`
	Category     string `json:"category"`
	Priority     string `json:"priority"`
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	TopUpTradeNo string `json:"topup_trade_no,omitempty"`
	RequestId    string `json:"request_id,omitempty"`
}

// postTicketEvent sends a ticket event to the ticket webhook in the
// background. Without both a webhook URL and a secret it sends nothing, so a
// receiver never has to accept unsigned events.
func postTicketEvent(event string, ticket *model.Ticket, username string, content string, imageCount int) {
	setting := operation_setting.GetTicketWebhookSetting()
	webhookURL, secret := strings.TrimSpace(setting.URL), setting.Secret
	if webhookURL == "" || secret == "" {
		return
	}
	if runes := []rune(content); len(runes) > ticketEventContentMaxLength {
		content = string(runes[:ticketEventContentMaxLength]) + "…"
	}
	body := TicketEvent{
		Event:      event,
		DeliveryId: common.GetUUID(),
		Timestamp:  time.Now().Unix(),
		Ticket: TicketEventTicket{
			Id: ticket.Id, Title: ticket.Title, Category: ticket.Category, Priority: ticket.Priority,
			UserId: ticket.UserId, Username: username, TopUpTradeNo: ticket.TopUpTradeNo, RequestId: ticket.RequestId,
		},
		Content:    content,
		ImageCount: imageCount,
		Link:       PaymentReturnURL("/tickets/manage/" + strconv.Itoa(ticket.Id)),
	}
	if event == TicketEventRated {
		body.Rating = ticket.Rating
	}
	gopool.Go(func() {
		payload, err := common.Marshal(body)
		if err == nil {
			err = deliverWebhook(webhookURL, secret, payload)
		}
		if err != nil {
			common.SysLog(common.LogText("ticket webhook %s for ticket %d failed: %s", event, ticket.Id, err.Error()))
		}
	})
}
