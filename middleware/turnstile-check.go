package middleware

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// TurnstileCheck guards a route with the active human verification provider:
// Cloudflare Turnstile, GeeTest v4 or reCAPTCHA v2 (the name is kept for the
// existing routes). The browser sends the widget answer in the "turnstile"
// query parameter for every provider; service.VerifyHuman describes its form.
func TurnstileCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		err := service.VerifyHuman(c.Request.Context(), c.Query("turnstile"), c.ClientIP())
		if err == nil {
			c.Next()
			return
		}
		switch {
		case errors.Is(err, service.ErrHumanVerificationMissing):
			common.ApiErrorT(c, "Please complete the human verification first")
		case errors.Is(err, service.ErrHumanVerificationFailed):
			common.ApiErrorT(c, "Human verification failed, please refresh and try again!")
		default:
			common.SysLog(common.LogText("human verification is unavailable: %s", err.Error()))
			common.ApiErrorT(c, "Human verification is temporarily unavailable. Please try again later.")
		}
		c.Abort()
	}
}
