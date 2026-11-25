package controller

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const ticketAlice, ticketBob, ticketRoot = 931, 932, 933

type ticketTestResponse struct {
	Status     int
	Success    bool   `json:"success"`
	MessageKey string `json:"message_key"`
	Data       struct {
		Id             int    `json:"id"`
		Status         string `json:"status"`
		Priority       string `json:"priority"`
		AssigneeId     int    `json:"assignee_id"`
		UserUnread     bool   `json:"user_unread"`
		AdminUnread    bool   `json:"admin_unread"`
		ResponseDueAt  int64  `json:"response_due_at"`
		Unread         int    `json:"unread"`
		Open           int64  `json:"open"`
		Overdue        int64  `json:"overdue"`
		Title          string `json:"title"`
		Content        string `json:"content"`
		SLAUrgentHours int    `json:"sla_urgent_hours"`
		Items          []struct {
			Id            int   `json:"id"`
			ResponseDueAt int64 `json:"response_due_at"`
		} `json:"items"`
		Ticket struct {
			Id            int    `json:"id"`
			Status        string `json:"status"`
			Priority      string `json:"priority"`
			UserUnread    bool   `json:"user_unread"`
			Username      string `json:"username"`
			ResponseDueAt int64  `json:"response_due_at"`
			Rating        int    `json:"rating"`
			RatingComment string `json:"rating_comment"`
		} `json:"ticket"`
		Messages []struct {
			UserId      int    `json:"user_id"`
			IsStaff     bool   `json:"is_staff"`
			Kind        string `json:"kind"`
			Content     string `json:"content"`
			Attachments []struct {
				Id        int    `json:"id"`
				MediaType string `json:"media_type"`
			} `json:"attachments"`
		} `json:"messages"`
	} `json:"data"`
}

// ticketTestEnv is a ticket database with the users alice and bob, the root
// user, a top-up order each for alice and bob, and every ticket route. The
// X-User header picks who calls.
type ticketTestEnv struct {
	t      *testing.T
	db     *gorm.DB
	router *gin.Engine
}

// runTicketDialects runs a ticket test on SQLite, and on MySQL and PostgreSQL
// when their DSNs are configured.
func runTicketDialects(t *testing.T, test func(t *testing.T, env *ticketTestEnv)) {
	gin.SetMode(gin.TestMode)
	// Replies notify in the background with backend-translated text.
	require.NoError(t, i18n.Init())
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("database DSN not configured")
			}
			test(t, newTicketTestEnv(t, dialect.kind, dsn))
		})
	}
}

func newTicketTestEnv(t *testing.T, kind, dsn string) *ticketTestEnv {
	db, _ := newAuditTestDatabase(t, kind, dsn)
	setupEpayCallbackDatabase(t, db, common.DatabaseType(kind))
	tables := []any{&model.Ticket{}, &model.TicketMessage{}, &model.TicketAttachment{}, &model.TicketCannedReply{}}
	require.NoError(t, db.AutoMigrate(append(tables, &model.UserMessage{})...))
	require.NoError(t, db.AutoMigrate(tables...), "a second migration must be a no-op")
	for _, user := range []model.User{
		{Id: ticketAlice, Username: "alice", Email: "alice@example.com", AffCode: "t931", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
		{Id: ticketBob, Username: "bob", AffCode: "t932", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
		{Id: ticketRoot, Username: "root", AffCode: "t933", Status: common.UserStatusEnabled, Role: common.RoleRootUser},
	} {
		require.NoError(t, db.Create(&user).Error)
	}
	require.NoError(t, db.Create(&model.TopUp{UserId: ticketAlice, TradeNo: "T-ALICE-1", Status: "success"}).Error)
	require.NoError(t, db.Create(&model.TopUp{UserId: ticketBob, TradeNo: "T-BOB-1", Status: "success"}).Error)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		id, _ := strconv.Atoi(c.GetHeader("X-User"))
		role := common.RoleCommonUser
		if id == ticketRoot {
			role = common.RoleRootUser
		}
		c.Set("id", id)
		c.Set("role", role)
		c.Set("username", map[int]string{ticketAlice: "alice", ticketBob: "bob", ticketRoot: "root"}[id])
		c.Next()
	})
	router.GET("/self/tickets", GetSelfTickets)
	router.POST("/self/tickets", CreateSelfTicket)
	router.GET("/self/tickets/:id", GetSelfTicket)
	router.POST("/self/tickets/:id/reply", ReplySelfTicket)
	router.POST("/self/tickets/:id/close", CloseSelfTicket)
	router.POST("/self/tickets/:id/reopen", ReopenSelfTicket)
	router.POST("/self/tickets/:id/rate", RateSelfTicket)
	router.GET("/ticket/", GetAllTickets)
	router.GET("/ticket/summary", GetTicketSummary)
	router.GET("/ticket/settings", GetTicketSettings)
	router.PUT("/ticket/settings", UpdateTicketSettings)
	router.GET("/ticket/canned-replies", GetTicketCannedReplies)
	router.POST("/ticket/canned-replies", CreateTicketCannedReply)
	router.PUT("/ticket/canned-replies/:id", UpdateTicketCannedReply)
	router.DELETE("/ticket/canned-replies/:id", DeleteTicketCannedReply)
	router.GET("/ticket/attachment/:id", GetTicketAttachment)
	router.GET("/ticket/:id", GetTicketDetail)
	router.DELETE("/ticket/:id", DeleteTicket)
	router.POST("/ticket/:id/reply", ReplyTicket)
	router.POST("/ticket/:id/close", CloseTicket)
	router.POST("/ticket/:id/reopen", ReopenTicket)
	router.PUT("/ticket/:id/priority", SetTicketPriority)
	return &ticketTestEnv{t: t, db: db, router: router}
}

func (env *ticketTestEnv) serve(method, path string, userId int, body *bytes.Buffer, contentType string) *httptest.ResponseRecorder {
	if body == nil {
		body = &bytes.Buffer{}
	}
	request := httptest.NewRequest(method, path, body)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	request.Header.Set("X-User", strconv.Itoa(userId))
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, request)
	return recorder
}

func (env *ticketTestEnv) call(method, path string, userId int, body *bytes.Buffer, contentType string) (ticketTestResponse, *httptest.ResponseRecorder) {
	recorder := env.serve(method, path, userId, body, contentType)
	result := ticketTestResponse{Status: recorder.Code}
	if recorder.Header().Get("Content-Type") == "application/json; charset=utf-8" {
		require.NoError(env.t, common.Unmarshal(recorder.Body.Bytes(), &result))
	}
	return result, recorder
}

func (env *ticketTestEnv) json(method, path string, userId int, body string) ticketTestResponse {
	result, _ := env.call(method, path, userId, bytes.NewBufferString(body), "application/json")
	return result
}

func (env *ticketTestEnv) open(userId int, fields map[string]string, images ...[]byte) ticketTestResponse {
	body, contentType := ticketForm(env.t, fields, images...)
	result, _ := env.call(http.MethodPost, "/self/tickets", userId, body, contentType)
	return result
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

var ticketTestPNG = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)

// TestTicketLifecycle covers a ticket from opening to closing: what a user may
// attach and link, who may read it and its images, how replies hand the turn
// between the user and support, and the automatic close of idle replies.
func TestTicketLifecycle(t *testing.T) {
	runTicketDialects(t, func(t *testing.T, env *ticketTestEnv) {
		const alice, bob, root = ticketAlice, ticketBob, ticketRoot
		png := ticketTestPNG
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
			result := env.open(alice, rejected.fields, rejected.images...)
			assert.False(t, result.Success, rejected.name)
			assert.Equal(t, rejected.key, result.MessageKey, rejected.name)
		}

		created := env.open(alice, valid, png)
		require.True(t, created.Success, created.MessageKey)
		ticketId := created.Data.Id
		assert.Equal(t, model.TicketStatusOpen, created.Data.Status)
		assert.True(t, created.Data.AdminUnread)
		ticketPath := "/self/tickets/" + strconv.Itoa(ticketId)

		// Only the owner, or someone who may read every ticket, sees the
		// ticket and its image; everyone else gets 404.
		detail, _ := env.call(http.MethodGet, ticketPath, alice, nil, "")
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
			_, recorder := env.call(probe.method, probe.path, probe.userId, nil, "")
			assert.Equal(t, http.StatusNotFound, recorder.Code, probe.path)
		}
		for _, reader := range []int{alice, root} {
			_, recorder := env.call(http.MethodGet, attachmentPath, reader, nil, "")
			require.Equal(t, http.StatusOK, recorder.Code)
			assert.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
			assert.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
			assert.Equal(t, png, recorder.Body.Bytes())
		}

		// A support reply hands the turn to the user, assigns the ticket,
		// and leaves a personal message; the user sees support anonymously.
		body, contentType := ticketForm(t, map[string]string{"content": "We are checking it"})
		reply, _ := env.call(http.MethodPost, "/ticket/"+strconv.Itoa(ticketId)+"/reply", root, body, contentType)
		require.True(t, reply.Success, reply.MessageKey)
		assert.Equal(t, model.TicketStatusReplied, reply.Data.Status)
		assert.Equal(t, root, reply.Data.AssigneeId)
		assert.True(t, reply.Data.UserUnread)
		var notices int64
		require.NoError(t, env.db.Model(&model.UserMessage{}).Where("user_id = ? AND title = ?", alice, model.UserMessageTicketRepliedTitle).Count(&notices).Error)
		assert.Equal(t, int64(1), notices)
		list, _ := env.call(http.MethodGet, "/self/tickets", alice, nil, "")
		assert.Equal(t, 1, list.Data.Unread)
		detail, _ = env.call(http.MethodGet, ticketPath, alice, nil, "")
		require.Len(t, detail.Data.Messages, 2)
		assert.True(t, detail.Data.Messages[1].IsStaff)
		assert.Zero(t, detail.Data.Messages[1].UserId)
		list, _ = env.call(http.MethodGet, "/self/tickets", alice, nil, "")
		assert.Zero(t, list.Data.Unread, "opening the ticket marks the reply read")

		// The user's JSON reply hands the turn back to support.
		reply = env.json(http.MethodPost, ticketPath+"/reply", alice, `{"content":"Thanks"}`)
		require.True(t, reply.Success, reply.MessageKey)
		assert.Equal(t, model.TicketStatusOpen, reply.Data.Status)
		assert.True(t, reply.Data.AdminUnread)
		assert.Zero(t, reply.Data.AssigneeId, "users do not see who handles their ticket")

		// A closed ticket takes no replies until it is reopened. Its owner
		// may reopen it, which hands it back to support; nobody else may.
		closed, _ := env.call(http.MethodPost, ticketPath+"/close", alice, nil, "")
		require.True(t, closed.Success)
		reply = env.json(http.MethodPost, ticketPath+"/reply", alice, `{"content":"One more"}`)
		assert.False(t, reply.Success)
		assert.Equal(t, "This ticket is closed", reply.MessageKey)
		_, recorder := env.call(http.MethodPost, ticketPath+"/reopen", bob, nil, "")
		assert.Equal(t, http.StatusNotFound, recorder.Code)
		require.True(t, env.json(http.MethodPost, ticketPath+"/reopen", alice, ``).Success)
		var reopenedTicket model.Ticket
		require.NoError(t, env.db.First(&reopenedTicket, ticketId).Error)
		assert.Equal(t, model.TicketStatusOpen, reopenedTicket.Status)
		assert.True(t, reopenedTicket.AdminUnread, "support sees the reopened ticket as unread")
		assert.Empty(t, reopenedTicket.ClosedBy)
		assert.Equal(t, "This ticket is not closed", env.json(http.MethodPost, ticketPath+"/reopen", alice, ``).MessageKey)
		require.True(t, env.json(http.MethodPost, "/ticket/"+strconv.Itoa(ticketId)+"/close", root, ``).Success)
		reopened, _ := env.call(http.MethodPost, "/ticket/"+strconv.Itoa(ticketId)+"/reopen", root, nil, "")
		require.True(t, reopened.Success)
		adminDetail, _ := env.call(http.MethodGet, "/ticket/"+strconv.Itoa(ticketId), root, nil, "")
		assert.Equal(t, "alice", adminDetail.Data.Ticket.Username)

		// A user may keep at most TicketMaxOpenPerUser tickets unresolved,
		// and reopening one counts toward that limit.
		var others []int
		for range service.TicketMaxOpenPerUser - 1 {
			other := env.open(alice, valid)
			require.True(t, other.Success)
			others = append(others, other.Data.Id)
		}
		capped := env.open(alice, valid)
		assert.False(t, capped.Success)
		assert.Equal(t, "You can have at most {{count}} unresolved tickets", capped.MessageKey)
		othersPath := "/self/tickets/" + strconv.Itoa(others[0])
		require.True(t, env.json(http.MethodPost, othersPath+"/close", alice, ``).Success)
		require.True(t, env.open(alice, valid).Success)
		assert.Equal(t, "You can have at most {{count}} unresolved tickets", env.json(http.MethodPost, othersPath+"/reopen", alice, ``).MessageKey)

		// A ticket whose last support reply has waited TicketAutoCloseAfter
		// (30 minutes) for the user closes on its own; a fresher one stays.
		assert.Equal(t, 30*time.Minute, service.TicketAutoCloseAfter)
		idle := time.Now().Add(-service.TicketAutoCloseAfter - time.Minute).Unix()
		require.NoError(t, env.db.Model(&model.Ticket{}).Where("id = ?", ticketId).
			UpdateColumns(map[string]any{"status": model.TicketStatusReplied, "updated_at": idle}).Error)
		recentTicket := model.Ticket{Id: others[1]}
		require.NoError(t, env.db.Model(&model.Ticket{}).Where("id = ?", recentTicket.Id).
			UpdateColumns(map[string]any{"status": model.TicketStatusReplied, "updated_at": time.Now().Add(-10 * time.Minute).Unix()}).Error)
		closedCount, err := model.AutoCloseRepliedTickets(time.Now().Add(-service.TicketAutoCloseAfter).Unix())
		require.NoError(t, err)
		assert.Equal(t, int64(1), closedCount)
		var idleTicket model.Ticket
		require.NoError(t, env.db.First(&idleTicket, ticketId).Error)
		require.NoError(t, env.db.First(&recentTicket, recentTicket.Id).Error)
		assert.Equal(t, model.TicketStatusClosed, idleTicket.Status)
		assert.Equal(t, model.TicketClosedBySystem, idleTicket.ClosedBy)
		assert.Equal(t, model.TicketStatusReplied, recentTicket.Status)
	})
}

// TestTicketSupportTools covers what support works with besides replies:
// notes users never see, priorities and the response targets they set,
// shared canned replies, the owner's one-time rating, and deleting a ticket.
func TestTicketSupportTools(t *testing.T) {
	previous := *operation_setting.GetTicketSetting()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		*operation_setting.GetTicketSetting() = previous
		common.OptionMap = previousOptions
	})
	runTicketDialects(t, func(t *testing.T, env *ticketTestEnv) {
		const alice, bob, root = ticketAlice, ticketBob, ticketRoot
		*operation_setting.GetTicketSetting() = previous
		draft := map[string]string{"title": "Model errors", "category": model.TicketCategoryAPI, "content": "429 since noon"}
		first := env.open(alice, draft)
		require.True(t, first.Success, first.MessageKey)
		second := env.open(alice, draft)
		require.True(t, second.Success, second.MessageKey)
		firstPath := "/ticket/" + strconv.Itoa(first.Data.Id)
		ownerPath := "/self/tickets/" + strconv.Itoa(first.Data.Id)

		// A note with an image stays with support: the ticket keeps waiting
		// for support, the owner is not told, and neither sees the note nor
		// may fetch its image. A user cannot post a note.
		body, contentType := ticketForm(t, map[string]string{"content": "Upstream key exhausted", "internal": "true"}, ticketTestPNG)
		note, _ := env.call(http.MethodPost, firstPath+"/reply", root, body, contentType)
		require.True(t, note.Success, note.MessageKey)
		assert.Equal(t, model.TicketStatusOpen, note.Data.Status)
		var notices int64
		require.NoError(t, env.db.Model(&model.UserMessage{}).Where("user_id = ?", alice).Count(&notices).Error)
		assert.Zero(t, notices)
		staffView, _ := env.call(http.MethodGet, firstPath, root, nil, "")
		require.Len(t, staffView.Data.Messages, 2)
		assert.Equal(t, model.TicketMessageNote, staffView.Data.Messages[1].Kind)
		noteImage := "/ticket/attachment/" + strconv.Itoa(staffView.Data.Messages[1].Attachments[0].Id)
		ownerView, _ := env.call(http.MethodGet, ownerPath, alice, nil, "")
		require.Len(t, ownerView.Data.Messages, 1)
		assert.Equal(t, http.StatusNotFound, env.serve(http.MethodGet, noteImage, alice, nil, "").Code)
		assert.Equal(t, http.StatusOK, env.serve(http.MethodGet, noteImage, root, nil, "").Code)
		userNote := env.json(http.MethodPost, ownerPath+"/reply", alice, `{"content":"psst","internal":true}`)
		require.True(t, userNote.Success, userNote.MessageKey)
		var userKinds []string
		require.NoError(t, env.db.Model(&model.TicketMessage{}).Where("user_id = ?", alice).Pluck("kind", &userKinds).Error)
		assert.NotContains(t, userKinds, model.TicketMessageNote)

		// Priority is support's to set and stays hidden from the owner.
		assert.Equal(t, "Invalid ticket priority", env.json(http.MethodPut, firstPath+"/priority", root, `{"priority":"critical"}`).MessageKey)
		require.True(t, env.json(http.MethodPut, firstPath+"/priority", root, `{"priority":"urgent"}`).Success)
		staffView, _ = env.call(http.MethodGet, firstPath, root, nil, "")
		assert.Equal(t, model.TicketPriorityUrgent, staffView.Data.Ticket.Priority)
		ownerView, _ = env.call(http.MethodGet, ownerPath, alice, nil, "")
		assert.Empty(t, ownerView.Data.Ticket.Priority)

		// Response targets: out-of-range hours are refused; an urgent
		// ticket waiting 3 hours is overdue at 2, a normal one is not.
		assert.Equal(t, "Response targets must be between 1 and {{max}} hours",
			env.json(http.MethodPut, "/ticket/settings", root, `{"sla_urgent_hours":0,"sla_high_hours":8,"sla_normal_hours":24,"sla_low_hours":72}`).MessageKey)
		settings := env.json(http.MethodPut, "/ticket/settings", root, `{"sla_urgent_hours":2,"sla_high_hours":8,"sla_normal_hours":24,"sla_low_hours":72}`)
		require.True(t, settings.Success, settings.MessageKey)
		assert.Equal(t, 2, settings.Data.SLAUrgentHours)
		waited := time.Now().Add(-3 * time.Hour).Unix()
		require.NoError(t, env.db.Model(&model.Ticket{}).Where("user_id = ?", alice).UpdateColumn("waiting_since", waited).Error)
		overdue, _ := env.call(http.MethodGet, "/ticket/?overdue=true", root, nil, "")
		require.Len(t, overdue.Data.Items, 1)
		assert.Equal(t, first.Data.Id, overdue.Data.Items[0].Id)
		assert.Equal(t, waited+2*3600, overdue.Data.Items[0].ResponseDueAt)
		summary, _ := env.call(http.MethodGet, "/ticket/summary", root, nil, "")
		assert.Equal(t, int64(2), summary.Data.Open)
		assert.Equal(t, int64(1), summary.Data.Overdue)

		// Canned replies are shared; a missing one is 404.
		assert.Equal(t, "Title is required", env.json(http.MethodPost, "/ticket/canned-replies", root, `{"title":" ","content":"x"}`).MessageKey)
		canned := env.json(http.MethodPost, "/ticket/canned-replies", root, `{"title":"Refund","content":"We refunded your order."}`)
		require.True(t, canned.Success, canned.MessageKey)
		cannedPath := "/ticket/canned-replies/" + strconv.Itoa(canned.Data.Id)
		updated := env.json(http.MethodPut, cannedPath, root, `{"title":"Refund done","content":"Refunded within 3 days."}`)
		require.True(t, updated.Success, updated.MessageKey)
		assert.Equal(t, "Refund done", updated.Data.Title)
		var listed struct {
			Data []model.TicketCannedReply `json:"data"`
		}
		require.NoError(t, common.Unmarshal(env.serve(http.MethodGet, "/ticket/canned-replies", root, nil, "").Body.Bytes(), &listed))
		require.Len(t, listed.Data, 1)
		assert.Equal(t, "Refunded within 3 days.", listed.Data[0].Content)
		_, recorder := env.call(http.MethodDelete, cannedPath, root, nil, "")
		assert.Equal(t, http.StatusOK, recorder.Code)
		_, recorder = env.call(http.MethodDelete, cannedPath, root, nil, "")
		assert.Equal(t, http.StatusNotFound, recorder.Code)

		// The owner rates a closed ticket once, 1 to 5 stars; nobody else
		// may rate it.
		assert.Equal(t, "A ticket can be rated once it is closed", env.json(http.MethodPost, ownerPath+"/rate", alice, `{"rating":5}`).MessageKey)
		require.True(t, env.json(http.MethodPost, firstPath+"/close", root, ``).Success)
		assert.Equal(t, "Rating must be between 1 and 5", env.json(http.MethodPost, ownerPath+"/rate", alice, `{"rating":6}`).MessageKey)
		assert.Equal(t, http.StatusNotFound, env.json(http.MethodPost, ownerPath+"/rate", bob, `{"rating":1}`).Status)
		require.True(t, env.json(http.MethodPost, ownerPath+"/rate", alice, `{"rating":4,"comment":"  Quick fix  "}`).Success)
		assert.Equal(t, "This ticket has already been rated", env.json(http.MethodPost, ownerPath+"/rate", alice, `{"rating":5}`).MessageKey)
		staffView, _ = env.call(http.MethodGet, firstPath, root, nil, "")
		assert.Equal(t, 4, staffView.Data.Ticket.Rating)
		assert.Equal(t, "Quick fix", staffView.Data.Ticket.RatingComment)

		// A note may still go on the closed ticket; deleting the ticket
		// removes it with its messages and images.
		require.True(t, env.json(http.MethodPost, firstPath+"/reply", root, `{"content":"Root cause fixed","internal":true}`).Success)
		_, recorder = env.call(http.MethodDelete, firstPath, root, nil, "")
		require.Equal(t, http.StatusOK, recorder.Code)
		for _, table := range []any{&model.TicketMessage{}, &model.TicketAttachment{}} {
			var left int64
			require.NoError(t, env.db.Model(table).Where("ticket_id = ?", first.Data.Id).Count(&left).Error)
			assert.Zero(t, left)
		}
		_, recorder = env.call(http.MethodGet, firstPath, root, nil, "")
		assert.Equal(t, http.StatusNotFound, recorder.Code)
		_, recorder = env.call(http.MethodGet, "/ticket/"+strconv.Itoa(second.Data.Id), root, nil, "")
		assert.Equal(t, http.StatusOK, recorder.Code, "other tickets stay")

		// The queue search also finds a ticket by its owner's name or email;
		// a % or _ in the keyword matches only itself.
		refund := env.open(bob, map[string]string{"title": "Refund 50%", "category": model.TicketCategoryBilling, "content": "Charged twice"})
		require.True(t, refund.Success, refund.MessageKey)
		for keyword, want := range map[string][]int{
			"errors":                     {second.Data.Id},
			"ali":                        {second.Data.Id},
			"alice@example.com":          {second.Data.Id},
			strconv.Itoa(refund.Data.Id): {refund.Data.Id},
			"50%":                        {refund.Data.Id},
			"%":                          {refund.Data.Id},
			"_":                          {},
		} {
			found, _ := env.call(http.MethodGet, "/ticket/?keyword="+url.QueryEscape(keyword), root, nil, "")
			ids := []int{}
			for _, item := range found.Data.Items {
				ids = append(ids, item.Id)
			}
			assert.Equal(t, want, ids, "keyword %q", keyword)
		}
	})
}

// TestTicketWebhookEvents covers what the ticket webhook, such as a Koishi bot
// relaying to the support group, receives: a signed event when a user opens,
// replies to, rates or reopens a ticket, nothing for support replies, notes
// and reopenings, and nothing until both a URL and a secret are set.
func TestTicketWebhookEvents(t *testing.T) {
	const secret = "ticket-webhook-test-secret"
	type delivery struct {
		event  service.TicketEvent
		signed bool
	}
	received := make(chan delivery, 16)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		var event service.TicketEvent
		_ = common.Unmarshal(body, &event)
		received <- delivery{event: event, signed: r.Header.Get("X-Webhook-Signature") == hex.EncodeToString(mac.Sum(nil))}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	service.InitHttpClient()
	fetch := system_setting.GetFetchSetting()
	webhook := operation_setting.GetTicketWebhookSetting()
	savedProtection, savedWebhook, savedWorker := fetch.EnableSSRFProtection, *webhook, system_setting.WorkerUrl
	t.Cleanup(func() {
		fetch.EnableSSRFProtection, *webhook, system_setting.WorkerUrl = savedProtection, savedWebhook, savedWorker
	})
	fetch.EnableSSRFProtection, system_setting.WorkerUrl = false, ""
	next := func(t *testing.T) service.TicketEvent {
		t.Helper()
		select {
		case got := <-received:
			assert.True(t, got.signed, "X-Webhook-Signature must be the HMAC-SHA256 of the body")
			assert.NotEmpty(t, got.event.DeliveryId)
			assert.InDelta(t, time.Now().Unix(), got.event.Timestamp, 60)
			return got.event
		case <-time.After(5 * time.Second):
			require.FailNow(t, "no ticket webhook event arrived")
			return service.TicketEvent{}
		}
	}

	runTicketDialects(t, func(t *testing.T, env *ticketTestEnv) {
		const alice, root = ticketAlice, ticketRoot
		*webhook = operation_setting.TicketWebhookSetting{}
		// The webhook settings are read before anything is sent, so these
		// two posts cannot deliver once the settings change below.
		unsent := env.open(alice, map[string]string{"title": "Before setup", "category": "api", "content": "x"})
		require.True(t, unsent.Success, unsent.MessageKey)
		webhook.URL = server.URL + "/koishi"
		require.True(t, env.json(http.MethodPost, "/self/tickets/"+strconv.Itoa(unsent.Data.Id)+"/reply", alice, `{"content":"no secret yet"}`).Success)
		webhook.Secret = secret

		long := strings.Repeat("长", 320)
		created := env.open(alice, map[string]string{"title": "Refund <now>", "category": "billing", "content": long, "topup_trade_no": "T-ALICE-1", "request_id": "req-1"}, ticketTestPNG)
		require.True(t, created.Success, created.MessageKey)
		id := created.Data.Id
		event := next(t)
		assert.Equal(t, service.TicketEventCreated, event.Event)
		assert.Equal(t, service.TicketEventTicket{Id: id, Title: "Refund <now>", Category: "billing", Priority: model.TicketPriorityNormal,
			UserId: alice, Username: "alice", TopUpTradeNo: "T-ALICE-1", RequestId: "req-1"}, event.Ticket)
		assert.Equal(t, strings.Repeat("长", 300)+"…", event.Content, "long messages are cut to 300 characters")
		assert.Equal(t, 1, event.ImageCount)
		assert.Zero(t, event.Rating)
		assert.True(t, strings.HasSuffix(event.Link, "/tickets/manage/"+strconv.Itoa(id)), event.Link)

		path := "/self/tickets/" + strconv.Itoa(id)
		staffPath := "/ticket/" + strconv.Itoa(id)
		require.True(t, env.json(http.MethodPost, staffPath+"/reply", root, `{"content":"Looking"}`).Success)
		require.True(t, env.json(http.MethodPost, staffPath+"/reply", root, `{"content":"Internal","internal":true}`).Success)
		require.True(t, env.json(http.MethodPost, path+"/reply", alice, `{"content":"Still broken"}`).Success)
		event = next(t)
		assert.Equal(t, service.TicketEventReplied, event.Event, "support replies and notes send nothing")
		assert.Equal(t, id, event.Ticket.Id)
		assert.Equal(t, "alice", event.Ticket.Username)
		assert.Equal(t, "Still broken", event.Content)
		assert.Zero(t, event.ImageCount)

		require.True(t, env.json(http.MethodPost, path+"/close", alice, ``).Success)
		require.True(t, env.json(http.MethodPost, path+"/rate", alice, `{"rating":4,"comment":"Quick fix"}`).Success)
		event = next(t)
		assert.Equal(t, service.TicketEventRated, event.Event)
		assert.Equal(t, id, event.Ticket.Id)
		assert.Equal(t, 4, event.Rating)
		assert.Equal(t, "Quick fix", event.Content)

		// A user reopening tells the webhook; support reopening does not.
		require.True(t, env.json(http.MethodPost, path+"/reopen", alice, ``).Success)
		event = next(t)
		assert.Equal(t, service.TicketEventReopened, event.Event)
		assert.Equal(t, id, event.Ticket.Id)
		assert.Equal(t, "alice", event.Ticket.Username)
		require.True(t, env.json(http.MethodPost, staffPath+"/close", root, ``).Success)
		require.True(t, env.json(http.MethodPost, staffPath+"/reopen", root, ``).Success)
		assert.Empty(t, received)
	})
}
