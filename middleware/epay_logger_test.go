package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestEpayCallbacksDoNotLogSignedPaymentParameters(t *testing.T) {
	previous := gin.DefaultWriter
	var output bytes.Buffer
	gin.DefaultWriter = &output
	t.Cleanup(func() { gin.DefaultWriter = previous })
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetUpLogger(router)
	paths := []string{"/api/user/epay/a/notify", "/api/subscription/epay/b/return", "/api/user/epay/notify", "/api/subscription/epay/return"}
	for _, path := range paths {
		router.GET(path, func(c *gin.Context) { assert.Equal(t, "secret-signature", c.Query("sign")); c.Status(http.StatusOK) })
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path+"?sign=secret-signature&pid=101&out_trade_no=private-order&money=10.00", nil))
		assert.Equal(t, http.StatusOK, response.Code)
		assert.Contains(t, output.String(), path)
	}
	assert.NotContains(t, output.String(), "secret-signature")
	assert.NotContains(t, output.String(), "private-order")
	assert.NotContains(t, output.String(), "money=")
}
