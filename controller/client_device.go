package controller

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// clientDeviceBodyLimit bounds the anonymous device endpoints' JSON bodies.
const clientDeviceBodyLimit = 8 << 10

// StartClientDeviceAuthorization begins a browser authorization for a native
// client and returns the codes it shows and polls with.
func StartClientDeviceAuthorization(c *gin.Context) {
	setAuthNoStore(c)
	var request service.ClientDeviceStartRequest
	if !decodeClientDeviceRequest(c, &request) {
		return
	}
	result, err := service.StartClientDeviceAuthorization(request, c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	verificationURI := strings.TrimRight(system_setting.ServerAddress, "/") + "/device"
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"device_code":               result.DeviceCode,
		"user_code":                 result.UserCode,
		"verification_uri":          verificationURI,
		"verification_uri_complete": verificationURI + "?code=" + url.QueryEscape(result.UserCode),
		"expires_in":                result.ExpiresIn,
		"interval":                  result.Interval,
	}})
}

// ExchangeClientDeviceCode is the device's poll. It answers with an RFC 8628
// error code until the user decides, then signs the device in once.
func ExchangeClientDeviceCode(c *gin.Context) {
	setAuthNoStore(c)
	var request service.ClientDeviceTokenRequest
	if !decodeClientDeviceRequest(c, &request) {
		return
	}
	login, err := service.ExchangeClientDeviceCode(request, c.ClientIP())
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	writeClientDeviceLogin(c, login)
}

// RefreshClientDeviceSession rotates a device's refresh token; the device keeps
// it instead of a cookie and must sign the request with its device key.
func RefreshClientDeviceSession(c *gin.Context) {
	setAuthNoStore(c)
	var request service.ClientDeviceRefreshRequest
	if !decodeClientDeviceRequest(c, &request) {
		return
	}
	login, err := service.RefreshClientDeviceSession(request, c.ClientIP())
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	writeClientDeviceLogin(c, login)
}

// GetClientDeviceAuthorization shows the signed-in user what is asking for
// access before they approve it.
func GetClientDeviceAuthorization(c *gin.Context) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	view, err := service.GetPendingClientDeviceAuthorization(c.Param("user_code"))
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// ApproveClientDeviceAuthorization signs the requesting device in for the
// current user. It needs a security proof bound to the same user code.
func ApproveClientDeviceAuthorization(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	userCode := service.NormalizeClientDeviceUserCode(c.Param("user_code"))
	context, err := common.Marshal(service.ClientDeviceAuthorizeContext{UserCode: userCode})
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeClientDeviceAuthorize, Context: context}) == nil {
		return
	}
	authorization, err := service.DecideClientDeviceAuthorization(identity.UserID, userCode, true)
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	recordUserSecurityAudit(c, identity.UserID, "client_device.approve", map[string]any{
		"name": authorization.ClientName, "platform": authorization.Platform, "verified": authorization.Verified,
	})
	common.ApiSuccess(c, gin.H{"status": authorization.Status})
}

// DenyClientDeviceAuthorization rejects a pending request.
func DenyClientDeviceAuthorization(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	authorization, err := service.DecideClientDeviceAuthorization(identity.UserID, c.Param("user_code"), false)
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	recordUserSecurityAudit(c, identity.UserID, "client_device.deny", map[string]any{
		"name": authorization.ClientName, "platform": authorization.Platform,
	})
	common.ApiSuccess(c, gin.H{"status": authorization.Status})
}

func ListClientDevices(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	devices, err := service.ListClientDevices(identity.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, devices)
}

// RevokeClientDevice revokes one of the user's devices and signs it out.
func RevokeClientDevice(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid client device ID"))
		return
	}
	device, err := service.RevokeClientDevice(identity.UserID, id)
	if err != nil {
		writeClientDeviceError(c, err)
		return
	}
	recordUserSecurityAudit(c, identity.UserID, "client_device.revoke", map[string]any{
		"name": device.Name, "platform": device.Platform,
	})
	common.ApiSuccess(c, gin.H{"id": device.Id, "current": device.SessionSID == identity.SessionID})
}

func decodeClientDeviceRequest(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, clientDeviceBodyLimit)
	if err := common.DecodeJson(c.Request.Body, target); err != nil {
		writeClientDeviceError(c, service.ErrClientDeviceRequestInvalid)
		return false
	}
	return true
}

func writeClientDeviceLogin(c *gin.Context, login *service.ClientDeviceLogin) {
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"access_token":      login.Bundle.AccessToken,
		"token_type":        login.Bundle.TokenType,
		"access_expires_at": login.Bundle.AccessExpiresAt,
		"refresh_token":     login.Bundle.RefreshToken,
		"session":           login.Bundle.Session,
		"user":              buildSelfUserData(login.User),
		"device": gin.H{
			"device_id": login.Device.DeviceId,
			"name":      login.Device.Name,
			"platform":  login.Device.Platform,
			"verified":  login.Device.Verified,
		},
	}})
}

// writeClientDeviceError maps device flow errors to a status and a stable code.
// Poll states use the RFC 8628 error names so clients can follow the spec.
func writeClientDeviceError(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, "CLIENT_DEVICE_INTERNAL_ERROR", "Please try again later."
	switch {
	case errors.Is(err, service.ErrClientDevicePending):
		status, code, message = http.StatusBadRequest, "authorization_pending", "Waiting for the user to approve this device."
	case errors.Is(err, service.ErrClientDeviceSlowDown):
		status, code, message = http.StatusBadRequest, "slow_down", "Polling too fast."
	case errors.Is(err, service.ErrClientDeviceExpired):
		status, code, message = http.StatusBadRequest, "expired_token", "This authorization has expired. Start again."
	case errors.Is(err, service.ErrClientDeviceDenied):
		status, code, message = http.StatusBadRequest, "access_denied", "The authorization was denied."
	case errors.Is(err, service.ErrClientDeviceDisabled):
		status, code, message = http.StatusForbidden, "CLIENT_DEVICE_DISABLED", "Client sign-in is disabled on this site."
	case errors.Is(err, service.ErrClientDeviceRequestInvalid):
		status, code, message = http.StatusBadRequest, "CLIENT_DEVICE_REQUEST_INVALID", "The request is invalid."
	case errors.Is(err, service.ErrClientDeviceSignatureInvalid), errors.Is(err, service.ErrClientDeviceReplay):
		status, code, message = http.StatusUnauthorized, "CLIENT_DEVICE_SIGNATURE_INVALID", "The device signature is invalid."
	case errors.Is(err, service.ErrClientDeviceLimit):
		status, code, message = http.StatusConflict, "CLIENT_DEVICE_LIMIT", "You have authorized too many devices. Revoke one in Security & Access first."
	case errors.Is(err, model.ErrClientDeviceAuthorizationNotFound), errors.Is(err, model.ErrClientDeviceAuthorizationClosed):
		status, code, message = http.StatusNotFound, "CLIENT_DEVICE_CODE_NOT_FOUND", "This code is invalid or has expired."
	case errors.Is(err, model.ErrClientDeviceNotFound):
		status, code, message = http.StatusNotFound, "CLIENT_DEVICE_NOT_FOUND", "Client device not found."
	case errors.Is(err, service.ErrRefreshTokenInvalid), errors.Is(err, service.ErrLoginSessionRevoked),
		errors.Is(err, service.ErrLoginSessionMismatch), errors.Is(err, service.ErrRefreshRace),
		errors.Is(err, model.ErrUserSessionLimit), errors.Is(err, model.ErrUserSessionIssuanceLimit):
		writeAuthSessionError(c, err)
		return
	default:
		_ = c.Error(err)
	}
	common.ApiErrorStatus(c, status, common.NewMessage(message), gin.H{"code": code})
}
