package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// playgroundError answers a failed playground request with the status the
// error calls for; its default is neutral because reads use it too.
func playgroundError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	message := common.NewMessage("Playground request failed")
	var maxBytes *http.MaxBytesError
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, message = http.StatusNotFound, common.NewMessage("Conversation not found")
	case errors.Is(err, model.ErrPlaygroundConflict):
		status, message = http.StatusConflict, common.NewMessage(err.Error())
	case errors.Is(err, model.ErrPlaygroundLimit):
		status, message = http.StatusForbidden, common.NewMessage(err.Error())
	case errors.Is(err, model.ErrPlaygroundInvalid), errors.Is(err, model.ErrPlaygroundSettingsInvalid):
		status, message = http.StatusBadRequest, common.NewMessage(err.Error())
	case errors.As(err, &maxBytes), errors.Is(err, model.ErrPlaygroundTooLarge):
		status, message = http.StatusRequestEntityTooLarge, common.NewMessage(model.ErrPlaygroundTooLarge.Error())
	}
	common.ApiErrorStatus(c, status, message)
}

// decodePlaygroundRequest reads a JSON body bounded by the document limit.
func decodePlaygroundRequest(c *gin.Context, target any) bool {
	limit := int64(model.PlaygroundDocumentLimit)
	if constant.MaxRequestBodyMB > 0 {
		limit = min(limit, int64(constant.MaxRequestBodyMB)*1024*1024)
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	body, err := io.ReadAll(c.Request.Body)
	if err == nil {
		err = common.Unmarshal(body, target)
	}
	if err != nil {
		var maxBytes *http.MaxBytesError
		if !errors.As(err, &maxBytes) {
			err = model.ErrPlaygroundInvalid
		}
		playgroundError(c, err)
		return false
	}
	return true
}

func ListPlaygroundConversations(c *gin.Context) {
	page := common.GetPageQuery(c)
	rows, count, err := model.ListPlaygroundConversations(c.GetInt("id"), c.Query("keyword"), page)
	if err != nil {
		playgroundError(c, err)
		return
	}
	page.SetItems(rows)
	page.SetTotal(int(count))
	common.ApiSuccess(c, page)
}

func GetPlaygroundConversation(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	row, err := model.GetPlaygroundConversation(c.GetInt("id"), id)
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}

// respondPlaygroundSaved answers a write. The client already holds the document
// it sent, so with return=meta only the saved metadata goes back instead of a
// second copy of a document of up to several megabytes. Clients that do not
// ask still receive the full row.
func respondPlaygroundSaved(c *gin.Context, row *model.PlaygroundConversationDetail) {
	if c.Query("return") == "meta" {
		common.ApiSuccess(c, row.PlaygroundConversation)
		return
	}
	common.ApiSuccess(c, row)
}

func CreatePlaygroundConversation(c *gin.Context) {
	var write model.PlaygroundWrite
	if !decodePlaygroundRequest(c, &write) {
		return
	}
	row, err := model.CreatePlaygroundConversation(c.GetInt("id"), write)
	if err != nil {
		playgroundError(c, err)
		return
	}
	respondPlaygroundSaved(c, row)
}

func SavePlaygroundConversation(c *gin.Context) {
	var write model.PlaygroundWrite
	if !decodePlaygroundRequest(c, &write) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	row, err := model.SavePlaygroundConversation(c.GetInt("id"), id, write)
	if err != nil {
		playgroundError(c, err)
		return
	}
	respondPlaygroundSaved(c, row)
}

func PatchPlaygroundConversation(c *gin.Context) {
	var patch model.PlaygroundPatch
	if !decodePlaygroundRequest(c, &patch) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	row, err := model.PatchPlaygroundConversation(c.GetInt("id"), id, patch)
	if err != nil {
		playgroundError(c, err)
		return
	}
	respondPlaygroundSaved(c, row)
}

func DeletePlaygroundConversation(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := model.DeletePlaygroundConversation(c.GetInt("id"), id); err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ImportPlaygroundConversation(c *gin.Context) {
	var request struct {
		Source model.PlaygroundLegacySource `json:"source"`
	}
	if !decodePlaygroundRequest(c, &request) {
		return
	}
	result, err := model.ImportPlaygroundConversation(c.GetInt("id"), request.Source)
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func PlaygroundUploadStatus(c *gin.Context) {
	size, _ := strconv.Atoi(c.Query("size"))
	result, err := model.GetPlaygroundUpload(c.GetInt("id"), c.Param("fingerprint"), size)
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func PlaygroundUploadChunk(c *gin.Context) {
	var request struct {
		Size    int    `json:"size"`
		Index   int    `json:"index"`
		Hash    string `json:"hash"`
		Content string `json:"content"`
	}
	if !decodePlaygroundRequest(c, &request) {
		return
	}
	err := model.SavePlaygroundUploadChunk(c.GetInt("id"), c.Param("fingerprint"), request.Size, request.Index, request.Hash, request.Content)
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func PlaygroundUploadComplete(c *gin.Context) {
	var request struct {
		Size int `json:"size"`
	}
	if !decodePlaygroundRequest(c, &request) {
		return
	}
	result, err := model.CompletePlaygroundUpload(c.GetInt("id"), c.Param("fingerprint"), request.Size)
	if err != nil {
		playgroundError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
