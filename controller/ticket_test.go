package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type ticketTestResponse struct {
	Status     int
	Success    bool   `json:"success"`
	MessageKey string `json:"message_key"`
	Data       struct {
		Id          int    `json:"id"`
		Status      string `json:"status"`
		AssigneeId  int    `json:"assignee_id"`
		UserUnread  bool   `json:"user_unread"`
		AdminUnread bool   `json:"admin_unread"`
		Unread      int    `json:"unread"`
		Ticket      struct {
			Id         int    `json:"id"`
			UserUnread bool   `json:"user_unread"`
			Username   string `json:"username"`
		} `json:"ticket"`
		Messages []struct {
			UserId      int    `json:"user_id"`
			IsStaff     bool   `json:"is_staff"`
			Content     string `json:"content"`
			Attachments []struct {
				Id        int    `json:"id"`
				MediaType string `json:"media_type"`
			} `json:"attachments"`
		} `json:"messages"`
	} `json:"data"`
}

// ticketForm builds a multipart ticket form with the given images.
func ticketForm(t *testing.T, fields map[string]string, images ...[]byte) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for name, value := range fields {
		require.NoError(t, writer.WriteField(name, value))
	}
	for i, image := range images {
		part, err := writer.CreateFormFile("images", "image"+strconv.Itoa(i)+".png")
		require.NoError(t, err)
		_, err = part.Write(image)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	return body, writer.FormDataContentType()
}

// TestTicketLifecycle covers a ticket from opening to closing: what a user may
// attach and link, who may read it and its images, how replies hand the turn
// between the user and support, and the automatic close of idle replies.
func TestTicketLifecycle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// Replies notify in the background with backend-translated text.
	require.NoError(t, i18n.Init())
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("database DSN not configured")
			}
			db, _ := newAuditTestDatabase(t, dialect.kind, dsn)
			setupEpayCallbackDatabase(t, db, common.DatabaseType(dialect.kind))
			require.NoError(t, db.AutoMigrate(&model.Ticket{}, &model.TicketMessage{}, &model.TicketAttachment{}, &model.UserMessage{}))
			require.NoError(t, db.AutoMigrate(&model.Ticket{}, &model.TicketMessage{}, &model.TicketAttachment{}), "a second migration must be a no-op")

			const alice, bob, root = 931, 932, 933
			for _, user := range []model.User{
				{Id: alice, Username: "alice", AffCode: "t931", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
				{Id: bob, Username: "bob", AffCode: "t932", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
				{Id: root, Username: "root", AffCode: "t933", Status: common.UserStatusEnabled, Role: common.RoleRootUser},
			} {
				require.NoError(t, db.Create(&user).Error)
			}
			require.NoError(t, db.Create(&model.TopUp{UserId: alice, TradeNo: "T-ALICE-1", Status: "success"}).Error)
			require.NoError(t, db.Create(&model.TopUp{UserId: bob, TradeNo: "T-BOB-1", Status: "success"}).Error)

			router := gin.New()
			router.Use(func(c *gin.Context) {
				id, _ := strconv.Atoi(c.GetHeader("X-User"))
				role, _ := strconv.Atoi(c.GetHeader("X-Role"))
				c.Set("id", id)
				c.Set("role", role)
				c.Set("username", c.GetHeader("X-Name"))
				c.Next()
			})
			router.GET("/self/tickets", GetSelfTickets)
			router.POST("/self/tickets", CreateSelfTicket)
			router.GET("/self/tickets/:id", GetSelfTicket)
			router.POST("/self/tickets/:id/reply", ReplySelfTicket)
			router.POST("/self/tickets/:id/close", CloseSelfTicket)
			router.GET("/ticket/attachment/:id", GetTicketAttachment)
			router.GET("/ticket/:id", GetTicketDetail)
			router.POST("/ticket/:id/reply", ReplyTicket)
			router.POST("/ticket/:id/reopen", ReopenTicket)
			call := func(method, path string, userId int, body *bytes.Buffer, contentType string) (ticketTestResponse, *httptest.ResponseRecorder) {
				if body == nil {
					body = &bytes.Buffer{}
				}
				request := httptest.NewRequest(method, path, body)
				if contentType != "" {
					request.Header.Set("Content-Type", contentType)
				}
				role := common.RoleCommonUser
				if userId == root {
					role = common.RoleRootUser
				}
				request.Header.Set("X-User", strconv.Itoa(userId))
				request.Header.Set("X-Role", strconv.Itoa(role))
				request.Header.Set("X-Name", map[int]string{alice: "alice", bob: "bob", root: "root"}[userId])
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)
				result := ticketTestResponse{Status: recorder.Code}
				if recorder.Header().Get("Content-Type") == "application/json; charset=utf-8" {
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
				}
				return result, recorder
			}
			open := func(userId int, fields map[string]string, images ...[]byte) ticketTestResponse {
				body, contentType := ticketForm(t, fields, images...)
				result, _ := call(http.MethodPost, "/self/tickets", userId, body, contentType)
				return result
			}

			png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)
			oversized := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, service.TicketMaxImageBytes)...)
			svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`)
			valid := map[string]string{"title": "Top-up missing", "category": model.TicketCategoryBilling, "content": "Paid but no credit", "topup_trade_no": "T-ALICE-1", "request_id": "20261118000000abc"}

			for _, rejected := range []struct {
				name   string
				fields map[string]string
				images [][]byte
				key    string
			}{
				{"another user's order", map[string]string{"title": "x", "category": "billing", "content": "x", "topup_trade_no": "T-BOB-1"}, nil, "Top-up order not found"},
				{"svg image", map[string]string{"title": "x", "category": "api", "content": "x"}, [][]byte{svg}, "Only PNG, JPEG, GIF and WebP images are supported"},
				{"oversized image", map[string]string{"title": "x", "category": "api", "content": "x"}, [][]byte{oversized}, "Each image must be at most {{size}} MB"},
				{"too many images", map[string]string{"title": "x", "category": "api", "content": "x"}, [][]byte{png, png, png, png}, "At most {{count}} images per message"},
				{"unknown category", map[string]string{"title": "x", "category": "refund", "content": "x"}, nil, "Invalid ticket category"},
				{"bad request id", map[string]string{"title": "x", "category": "api", "content": "x", "request_id": "<script>"}, nil, "Invalid request ID"},
			} {
				result := open(alice, rejected.fields, rejected.images...)
				assert.False(t, result.Success, rejected.name)
				assert.Equal(t, rejected.key, result.MessageKey, rejected.name)
			}

			created := open(alice, valid, png)
			require.True(t, created.Success, created.MessageKey)
			ticketId := created.Data.Id
			assert.Equal(t, model.TicketStatusOpen, created.Data.Status)
			assert.True(t, created.Data.AdminUnread)
			ticketPath := "/self/tickets/" + strconv.Itoa(ticketId)

			// Only the owner, or someone who may read every ticket, sees the
			// ticket and its image; everyone else gets 404.
			detail, _ := call(http.MethodGet, ticketPath, alice, nil, "")
			require.True(t, detail.Success)
			require.Len(t, detail.Data.Messages, 1)
			require.Len(t, detail.Data.Messages[0].Attachments, 1)
			attachmentPath := "/ticket/attachment/" + strconv.Itoa(detail.Data.Messages[0].Attachments[0].Id)
			for _, probe := range []struct {
				method, path string
				userId       int
			}{
				{http.MethodGet, ticketPath, bob},
				{http.MethodPost, ticketPath + "/close", bob},
				{http.MethodGet, attachmentPath, bob},
			} {
				_, recorder := call(probe.method, probe.path, probe.userId, nil, "")
				assert.Equal(t, http.StatusNotFound, recorder.Code, probe.path)
			}
			for _, reader := range []int{alice, root} {
				_, recorder := call(http.MethodGet, attachmentPath, reader, nil, "")
				require.Equal(t, http.StatusOK, recorder.Code)
				assert.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
				assert.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
				assert.Equal(t, png, recorder.Body.Bytes())
			}

			// A support reply hands the turn to the user, assigns the ticket,
			// and leaves a personal message; the user sees support anonymously.
			body, contentType := ticketForm(t, map[string]string{"content": "We are checking it"})
			reply, _ := call(http.MethodPost, "/ticket/"+strconv.Itoa(ticketId)+"/reply", root, body, contentType)
			require.True(t, reply.Success, reply.MessageKey)
			assert.Equal(t, model.TicketStatusReplied, reply.Data.Status)
			assert.Equal(t, root, reply.Data.AssigneeId)
			assert.True(t, reply.Data.UserUnread)
			var notices int64
			require.NoError(t, db.Model(&model.UserMessage{}).Where("user_id = ? AND title = ?", alice, model.UserMessageTicketRepliedTitle).Count(&notices).Error)
			assert.Equal(t, int64(1), notices)
			list, _ := call(http.MethodGet, "/self/tickets", alice, nil, "")
			assert.Equal(t, 1, list.Data.Unread)
			detail, _ = call(http.MethodGet, ticketPath, alice, nil, "")
			require.Len(t, detail.Data.Messages, 2)
			assert.True(t, detail.Data.Messages[1].IsStaff)
			assert.Zero(t, detail.Data.Messages[1].UserId)
			list, _ = call(http.MethodGet, "/self/tickets", alice, nil, "")
			assert.Zero(t, list.Data.Unread, "opening the ticket marks the reply read")

			// The user's JSON reply hands the turn back to support.
			reply, _ = call(http.MethodPost, ticketPath+"/reply", alice, bytes.NewBufferString(`{"content":"Thanks"}`), "application/json")
			require.True(t, reply.Success, reply.MessageKey)
			assert.Equal(t, model.TicketStatusOpen, reply.Data.Status)
			assert.True(t, reply.Data.AdminUnread)
			assert.Zero(t, reply.Data.AssigneeId, "users do not see who handles their ticket")

			// A closed ticket takes no replies until support reopens it.
			closed, _ := call(http.MethodPost, ticketPath+"/close", alice, nil, "")
			require.True(t, closed.Success)
			reply, _ = call(http.MethodPost, ticketPath+"/reply", alice, bytes.NewBufferString(`{"content":"One more"}`), "application/json")
			assert.False(t, reply.Success)
			assert.Equal(t, "This ticket is closed", reply.MessageKey)
			reopened, _ := call(http.MethodPost, "/ticket/"+strconv.Itoa(ticketId)+"/reopen", root, nil, "")
			require.True(t, reopened.Success)
			adminDetail, _ := call(http.MethodGet, "/ticket/"+strconv.Itoa(ticketId), root, nil, "")
			assert.Equal(t, "alice", adminDetail.Data.Ticket.Username)

			// A user may keep at most TicketMaxOpenPerUser tickets unresolved.
			for range service.TicketMaxOpenPerUser - 1 {
				require.True(t, open(alice, valid).Success)
			}
			capped := open(alice, valid)
			assert.False(t, capped.Success)
			assert.Equal(t, "You can have at most {{count}} unresolved tickets", capped.MessageKey)

			// Support replies the user left unanswered for the idle period
			// close on their own; a recent one stays.
			idle := time.Now().Add(-8 * 24 * time.Hour).Unix()
			require.NoError(t, db.Model(&model.Ticket{}).Where("id = ?", ticketId).
				UpdateColumns(map[string]any{"status": model.TicketStatusReplied, "updated_at": idle}).Error)
			var recentTicket model.Ticket
			require.NoError(t, db.Where("user_id = ? AND id <> ?", alice, ticketId).Order("id ASC").First(&recentTicket).Error)
			require.NoError(t, db.Model(&model.Ticket{}).Where("id = ?", recentTicket.Id).
				UpdateColumns(map[string]any{"status": model.TicketStatusReplied}).Error)
			closedCount, err := model.AutoCloseRepliedTickets(time.Now().Add(-7 * 24 * time.Hour).Unix())
			require.NoError(t, err)
			assert.Equal(t, int64(1), closedCount)
			var idleTicket model.Ticket
			require.NoError(t, db.First(&idleTicket, ticketId).Error)
			require.NoError(t, db.First(&recentTicket, recentTicket.Id).Error)
			assert.Equal(t, model.TicketStatusClosed, idleTicket.Status)
			assert.Equal(t, model.TicketClosedBySystem, idleTicket.ClosedBy)
			assert.Equal(t, model.TicketStatusReplied, recentTicket.Status)
		})
	}
}
