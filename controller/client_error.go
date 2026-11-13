package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/gin-gonic/gin"
)

// clientErrorReport is what the web console sends when its error page is
// shown: the error as the browser console prints it, and where it happened.
type clientErrorReport struct {
	Message string `json:"message"`
	Stack   string `json:"stack"`
	Status  int    `json:"status"`
	Page    string `json:"page"`
	Build   string `json:"build"`
	// Request and RequestID identify the API call that failed, when one did.
	Request   string `json:"request"`
	RequestID string `json:"request_id"`
}

// ReportClientError writes a browser error to the server log, so a failure a
// visitor saw can be found without asking them for their console output.
// Anyone can call it: every field is cut to a fixed length and logged quoted.
func ReportClientError(c *gin.Context) {
	var report clientErrorReport
	if err := common.DecodeJson(c.Request.Body, &report); err != nil || report.Message == "" {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	limit := func(value string, length int) string {
		if len(value) > length {
			return value[:length]
		}
		return value
	}
	logger.LogError(c, common.LogText("browser error reported: user=%d status=%d page=%q build=%q request=%q request_id=%q message=%q stack=%q",
		c.GetInt("id"), report.Status, limit(report.Page, 256), limit(report.Build, 64),
		limit(report.Request, 256), limit(report.RequestID, 64), limit(report.Message, 512), limit(report.Stack, 4096)))
	common.ApiSuccess(c, nil)
}
