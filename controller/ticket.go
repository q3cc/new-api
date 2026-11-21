package controller

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ticketRequestMaxBytes bounds a ticket form: the images it may carry plus
// room for the text fields and multipart framing.
const ticketRequestMaxBytes = service.TicketMaxImagesPerMessage*service.TicketMaxImageBytes + 1<<20

var ticketStatuses = []string{model.TicketStatusOpen, model.TicketStatusReplied, model.TicketStatusClosed}

// ticketSubmission is a ticket or reply as posted, either as multipart form
// with images under "images" or as JSON without images.
type ticketSubmission struct {
	Title        string `json:"title" form:"title"`
	Category     string `json:"category" form:"category"`
	Content      string `json:"content" form:"content"`
	TopUpTradeNo string `json:"topup_trade_no" form:"topup_trade_no"`
	RequestId    string `json:"request_id" form:"request_id"`
	// Internal posts a support message as a note only support can see.
	Internal bool `json:"internal" form:"internal"`
	images   [][]byte
}

// GetSelfTickets returns a page of the user's tickets, most recently active
// first, with how many carry an unread support reply.
func GetSelfTickets(c *gin.Context) {
	status := c.Query("status")
	if status != "" && !slices.Contains(ticketStatuses, status) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	pageInfo := common.GetPageQuery(c)
	tickets, total, unread, err := model.ListUserTickets(c.GetInt("id"), status, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range tickets {
		forTicketOwner(&tickets[i])
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tickets)
	common.ApiSuccess(c, gin.H{"unread": unread, "page": pageInfo})
}

// GetSelfTicketUnread returns how many of the user's tickets carry an unread
// support reply.
func GetSelfTicketUnread(c *gin.Context) {
	unread, err := model.CountUserUnreadTickets(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"unread": unread})
}

// CreateSelfTicket opens a ticket for the user.
func CreateSelfTicket(c *gin.Context) {
	submission, err := readTicketSubmission(c)
	if err != nil {
		respondTicketError(c, err)
		return
	}
	ticket, err := service.OpenTicket(c.GetInt("id"), c.GetString("username"), service.TicketDraft{
		Title:        submission.Title,
		Category:     submission.Category,
		Content:      submission.Content,
		TopUpTradeNo: submission.TopUpTradeNo,
		RequestId:    submission.RequestId,
		Images:       submission.images,
	})
	if err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}

// GetSelfTicket returns one of the user's tickets with its messages and marks
// support's replies read. Support staff are shown without their identity.
func GetSelfTicket(c *gin.Context) {
	userId := c.GetInt("id")
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	ticket, err := model.GetTicket(ticketId, userId)
	if err != nil {
		respondTicketError(c, err)
		return
	}
	messages, err := model.ListTicketMessages(ticket.Id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range messages {
		if messages[i].IsStaff {
			messages[i].UserId, messages[i].Username = 0, ""
		}
	}
	if ticket.UserUnread {
		if err := model.MarkTicketRead(ticket.Id, false); err != nil {
			common.ApiError(c, err)
			return
		}
		ticket.UserUnread = false
	}
	forTicketOwner(ticket)
	common.ApiSuccess(c, gin.H{"ticket": ticket, "messages": messages})
}

// ReplySelfTicket adds the user's message to one of their open tickets.
func ReplySelfTicket(c *gin.Context) {
	replyTicket(c, false)
}

// CloseSelfTicket closes one of the user's tickets.
func CloseSelfTicket(c *gin.Context) {
	userId := c.GetInt("id")
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := model.CloseTicket(ticketId, userId, model.TicketClosedByUser); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetAllTickets returns a page of the support queue.
func GetAllTickets(c *gin.Context) {
	filter := model.TicketFilter{
		Status:   c.Query("status"),
		Category: c.Query("category"),
		Priority: c.Query("priority"),
		Keyword:  c.Query("keyword"),
	}
	if filter.Status != "" && !slices.Contains(ticketStatuses, filter.Status) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if filter.Priority != "" && !slices.Contains(model.TicketPriorities, filter.Priority) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if c.Query("overdue") == "true" {
		filter.OverdueBefore = service.TicketResponseCutoffs()
	}
	if userId := c.Query("user_id"); userId != "" {
		id, err := strconv.Atoi(userId)
		if err != nil || id <= 0 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		filter.UserId = id
	}
	if c.Query("mine") == "true" {
		filter.AssigneeId = c.GetInt("id")
	}
	pageInfo := common.GetPageQuery(c)
	tickets, total, err := model.ListTickets(filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range tickets {
		tickets[i].ResponseDueAt = service.TicketResponseDueAt(&tickets[i])
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tickets)
	common.ApiSuccess(c, pageInfo)
}

// GetTicketSummary counts the support queue for the console badges.
func GetTicketSummary(c *gin.Context) {
	summary, err := model.GetTicketSummary(service.TicketResponseCutoffs())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// GetTicketDetail returns a ticket with its messages for support and marks
// the user's posts read.
func GetTicketDetail(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	ticket, err := model.GetTicket(ticketId, 0)
	if err != nil {
		respondTicketError(c, err)
		return
	}
	messages, err := model.ListTicketMessages(ticket.Id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ticket.ResponseDueAt = service.TicketResponseDueAt(ticket)
	if ticket.AdminUnread {
		if err := model.MarkTicketRead(ticket.Id, true); err != nil {
			common.ApiError(c, err)
			return
		}
		ticket.AdminUnread = false
	}
	common.ApiSuccess(c, gin.H{"ticket": ticket, "messages": messages})
}

// ReplyTicket adds a support reply to a ticket that is not closed.
func ReplyTicket(c *gin.Context) {
	replyTicket(c, true)
}

// CloseTicket closes a ticket on support's side.
func CloseTicket(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := model.CloseTicket(ticketId, 0, model.TicketClosedByAdmin); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ReopenTicket puts a closed ticket back in the support queue.
func ReopenTicket(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := service.ReopenTicket(ticketId, 0, c.GetString("username")); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ReopenSelfTicket puts one of the user's closed tickets back in the support
// queue.
func ReopenSelfTicket(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := service.ReopenTicket(ticketId, c.GetInt("id"), c.GetString("username")); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetTicketAttachment serves a ticket image to whoever may read every
// ticket, and to the ticket's owner unless the image belongs to a note.
// Anyone else gets 404, so image IDs cannot be probed.
func GetTicketAttachment(c *gin.Context) {
	attachmentId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	attachment, ownerId, note, err := model.GetTicketAttachment(attachmentId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userId := c.GetInt("id")
	ownerMayRead := ownerId == userId && !note
	if !ownerMayRead && !authz.Can(userId, c.GetInt("role"), authz.TicketRead) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	data, err := base64.StdEncoding.DecodeString(string(attachment.Data))
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	c.Data(http.StatusOK, attachment.MediaType, data)
}

// replyTicket posts a reply from the ticket's owner, or from support when
// staff is true.
func replyTicket(c *gin.Context, staff bool) {
	ownerId := c.GetInt("id")
	if staff {
		ownerId = 0
	}
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	submission, err := readTicketSubmission(c)
	if err != nil {
		respondTicketError(c, err)
		return
	}
	ticket, err := service.PostTicketReply(service.TicketPost{
		TicketId:   ticketId,
		OwnerId:    ownerId,
		AuthorId:   c.GetInt("id"),
		AuthorName: c.GetString("username"),
		Staff:      staff,
		Note:       staff && submission.Internal,
		Content:    submission.Content,
		Images:     submission.images,
	})
	if err != nil {
		respondTicketError(c, err)
		return
	}
	if staff {
		ticket.ResponseDueAt = service.TicketResponseDueAt(ticket)
	} else {
		forTicketOwner(ticket)
	}
	common.ApiSuccess(c, ticket)
}

// readTicketSubmission reads a multipart ticket form with its images, or a
// JSON body without images.
func readTicketSubmission(c *gin.Context) (*ticketSubmission, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, ticketRequestMaxBytes)
	submission := &ticketSubmission{}
	if !strings.HasPrefix(c.ContentType(), "multipart/form-data") {
		if err := common.DecodeJson(c.Request.Body, submission); err != nil {
			return nil, common.NewMessage("Invalid parameters")
		}
		return submission, nil
	}
	if err := c.Request.ParseMultipartForm(ticketRequestMaxBytes); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, common.NewMessage("Each image must be at most {{size}} MB", map[string]any{"size": service.TicketMaxImageBytes >> 20})
		}
		return nil, common.NewMessage("Invalid parameters")
	}
	if err := c.ShouldBind(submission); err != nil {
		return nil, common.NewMessage("Invalid parameters")
	}
	files := c.Request.MultipartForm.File["images"]
	if len(files) > service.TicketMaxImagesPerMessage {
		return nil, common.NewMessage("At most {{count}} images per message", map[string]any{"count": service.TicketMaxImagesPerMessage})
	}
	for _, header := range files {
		if header.Size > service.TicketMaxImageBytes {
			return nil, common.NewMessage("Each image must be at most {{size}} MB", map[string]any{"size": service.TicketMaxImageBytes >> 20})
		}
		file, err := header.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(file, service.TicketMaxImageBytes+1))
		file.Close()
		if err != nil {
			return nil, err
		}
		submission.images = append(submission.images, data)
	}
	return submission, nil
}

// respondTicketError answers a ticket request: a missing ticket, or one that
// is not the caller's, is 404; a rule the request broke is shown as is.
func respondTicketError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Ticket not found"))
		return
	}
	common.ApiError(c, err)
}

// SetTicketPriority changes how pressing a ticket is.
func SetTicketPriority(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	var request struct {
		Priority string `json:"priority"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := service.SetTicketPriority(ticketId, request.Priority); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DeleteTicket permanently removes a ticket with its messages and images.
func DeleteTicket(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := model.DeleteTicket(ticketId); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// RateSelfTicket records the user's satisfaction with one of their closed
// tickets.
func RateSelfTicket(c *gin.Context) {
	ticketId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	var request struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := service.RateTicket(ticketId, c.GetInt("id"), c.GetString("username"), request.Rating, request.Comment); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetTicketSettings returns the response target of every priority, in hours.
func GetTicketSettings(c *gin.Context) {
	common.ApiSuccess(c, operation_setting.GetTicketSetting())
}

// UpdateTicketSettings changes the response targets.
func UpdateTicketSettings(c *gin.Context) {
	var request operation_setting.TicketSetting
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := service.UpdateTicketSLA(request); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, operation_setting.GetTicketSetting())
}

// GetTicketCannedReplies returns the reply texts support staff share.
func GetTicketCannedReplies(c *gin.Context) {
	replies, err := model.ListTicketCannedReplies()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, replies)
}

// CreateTicketCannedReply adds a shared reply text.
func CreateTicketCannedReply(c *gin.Context) {
	saveTicketCannedReply(c, 0)
}

// UpdateTicketCannedReply changes a shared reply text.
func UpdateTicketCannedReply(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	saveTicketCannedReply(c, id)
}

// DeleteTicketCannedReply removes a shared reply text.
func DeleteTicketCannedReply(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondTicketError(c, gorm.ErrRecordNotFound)
		return
	}
	if err := model.DeleteTicketCannedReply(id); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// saveTicketCannedReply creates a shared reply text, or updates the one with
// the given id.
func saveTicketCannedReply(c *gin.Context, id int) {
	var request struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	reply := &model.TicketCannedReply{Id: id, Title: request.Title, Content: request.Content, UpdatedBy: c.GetInt("id")}
	if err := service.SaveTicketCannedReply(reply); err != nil {
		respondTicketError(c, err)
		return
	}
	common.ApiSuccess(c, reply)
}

// forTicketOwner hides what only support needs from a ticket shown to its
// owner: who handles it and how pressing support marked it.
func forTicketOwner(ticket *model.Ticket) {
	ticket.AssigneeId = 0
	ticket.Priority = ""
}
