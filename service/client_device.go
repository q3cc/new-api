package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// Browser authorization for native clients. See model/client_device.go for the
// flow. Every request a client makes with its device key is signed over a
// newline-joined message whose first line names its purpose, so a signature
// made for one purpose is never accepted for another, plus a timestamp and a
// single-use nonce, so a captured request cannot be replayed.

const (
	ClientDeviceAuthorizationTTL = 10 * time.Minute
	// ClientDevicePollInterval is the minimum time between two polls of one
	// device code (RFC 8628 §3.5).
	ClientDevicePollInterval = 5 * time.Second
	// clientDeviceSignatureWindow is how far a signed timestamp may be from the
	// server clock. Nonces are remembered for twice this long.
	clientDeviceSignatureWindow = 5 * time.Minute

	clientDeviceUserCodeAlphabet = "BCDFGHJKLMNPQRSTVWXZ"
	clientDeviceUserCodeLength   = 8
)

var ClientDevicePlatforms = []string{"ios", "android", "macos", "windows", "linux", "web"}

var (
	ErrClientDeviceDisabled         = errors.New("client device authorization is disabled")
	ErrClientDeviceRequestInvalid   = errors.New("client device request is invalid")
	ErrClientDeviceSignatureInvalid = errors.New("client device signature is invalid")
	ErrClientDeviceReplay           = errors.New("client device request was already used")
	ErrClientDeviceLimit            = errors.New("client device limit reached")
	ErrClientDevicePending          = errors.New("authorization_pending")
	ErrClientDeviceSlowDown         = errors.New("slow_down")
	ErrClientDeviceExpired          = errors.New("expired_token")
	ErrClientDeviceDenied           = errors.New("access_denied")
)

// ClientDeviceSignedFields are the proof fields every device-signed request
// carries.
type ClientDeviceSignedFields struct {
	Timestamp int64  `json:"timestamp"`
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
}

type ClientDeviceStartRequest struct {
	ClientDeviceSignedFields
	ClientName string `json:"client_name"`
	Platform   string `json:"platform"`
	AppVersion string `json:"app_version"`
	// PublicKey is the device's P-256 public key, SPKI DER, base64url.
	PublicKey string `json:"public_key"`
	// BuildSignature is an HMAC-SHA256 of the same message made with the build
	// key of an official client, base64url. Optional: without a valid one the
	// device can still sign in but is not verified.
	BuildSignature string `json:"build_signature"`
}

type ClientDeviceStartResult struct {
	DeviceCode string `json:"device_code"`
	UserCode   string `json:"user_code"`
	ExpiresIn  int    `json:"expires_in"`
	Interval   int    `json:"interval"`
}

type ClientDeviceTokenRequest struct {
	ClientDeviceSignedFields
	DeviceCode string `json:"device_code"`
}

type ClientDeviceRefreshRequest struct {
	ClientDeviceSignedFields
	DeviceID     string `json:"device_id"`
	RefreshToken string `json:"refresh_token"`
}

// ClientDeviceLogin is what a device receives when it signs in or refreshes.
// Unlike a browser, it keeps the refresh token itself; the token is useless
// without the device key, which never leaves the device.
type ClientDeviceLogin struct {
	Bundle *AuthBundle
	Device *model.ClientDevice
	User   *model.User
}

// ClientDeviceAuthorizationView is what the approving user sees.
type ClientDeviceAuthorizationView struct {
	UserCode   string `json:"user_code"`
	ClientName string `json:"client_name"`
	Platform   string `json:"platform"`
	AppVersion string `json:"app_version"`
	Verified   bool   `json:"verified"`
	RequestIP  string `json:"request_ip"`
	CreatedAt  int64  `json:"created_at"`
	ExpiresAt  int64  `json:"expires_at"`
}

func StartClientDeviceAuthorization(request ClientDeviceStartRequest, ip, userAgent string) (*ClientDeviceStartResult, error) {
	if !operation_setting.GetClientDeviceSetting().Enabled {
		return nil, ErrClientDeviceDisabled
	}
	request.ClientName = truncateRunes(strings.TrimSpace(request.ClientName), 128)
	request.Platform = strings.ToLower(strings.TrimSpace(request.Platform))
	request.AppVersion = strings.TrimSpace(request.AppVersion)
	if request.ClientName == "" || !slices.Contains(ClientDevicePlatforms, request.Platform) ||
		request.AppVersion == "" || len(request.AppVersion) > 32 {
		return nil, ErrClientDeviceRequestInvalid
	}
	message := clientDeviceMessage("client-device-authorize", request.ClientDeviceSignedFields,
		request.Platform, request.AppVersion, request.ClientName, request.PublicKey)
	if err := verifyClientDeviceProof(request.PublicKey, request.ClientDeviceSignedFields, message); err != nil {
		return nil, err
	}
	now := time.Now()
	_ = model.DeleteExpiredClientDeviceAuthorizations(now.Unix())

	deviceCode, err := randomToken(32)
	if err != nil {
		return nil, err
	}
	authorization := &model.ClientDeviceAuthorization{
		DeviceCodeHash: sha256Hex(deviceCode),
		Status:         model.ClientDeviceAuthorizationPending,
		ClientName:     request.ClientName,
		Platform:       request.Platform,
		AppVersion:     request.AppVersion,
		PublicKey:      request.PublicKey,
		Verified:       verifyClientBuildSignature(request.BuildSignature, message),
		RequestIP:      truncateAuthMetadata(ip, 64),
		UserAgent:      truncateAuthMetadata(userAgent, 512),
		CreatedAt:      now.Unix(),
		ExpiresAt:      now.Add(ClientDeviceAuthorizationTTL).Unix(),
	}
	// A clash with a live user code is unlikely (20^8 codes); retry a few times.
	for range 5 {
		authorization.UserCode, err = randomUserCode()
		if err != nil {
			return nil, err
		}
		if err = model.CreateClientDeviceAuthorization(authorization); err == nil {
			break
		}
	}
	if err != nil {
		return nil, err
	}
	return &ClientDeviceStartResult{
		DeviceCode: deviceCode,
		UserCode:   FormatClientDeviceUserCode(authorization.UserCode),
		ExpiresIn:  int(ClientDeviceAuthorizationTTL / time.Second),
		Interval:   int(ClientDevicePollInterval / time.Second),
	}, nil
}

// GetPendingClientDeviceAuthorization looks up a request the user is about to
// approve or deny.
func GetPendingClientDeviceAuthorization(userCode string) (*ClientDeviceAuthorizationView, error) {
	authorization, err := model.GetPendingClientDeviceAuthorization(NormalizeClientDeviceUserCode(userCode), time.Now().Unix())
	if err != nil {
		return nil, err
	}
	return &ClientDeviceAuthorizationView{
		UserCode:   FormatClientDeviceUserCode(authorization.UserCode),
		ClientName: authorization.ClientName,
		Platform:   authorization.Platform,
		AppVersion: authorization.AppVersion,
		Verified:   authorization.Verified,
		RequestIP:  authorization.RequestIP,
		CreatedAt:  authorization.CreatedAt,
		ExpiresAt:  authorization.ExpiresAt,
	}, nil
}

// DecideClientDeviceAuthorization approves or denies a pending request for
// the signed-in user. Approval is refused once the user has as many active
// devices as allowed.
func DecideClientDeviceAuthorization(userID int, userCode string, approve bool) (*model.ClientDeviceAuthorization, error) {
	if approve {
		count, err := model.CountActiveClientDevices(userID)
		if err != nil {
			return nil, err
		}
		if count >= int64(operation_setting.GetClientDeviceSetting().MaxDevicesPerUser) {
			return nil, ErrClientDeviceLimit
		}
	}
	return model.DecideClientDeviceAuthorization(NormalizeClientDeviceUserCode(userCode), userID, approve, time.Now().Unix())
}

// ExchangeClientDeviceCode answers a device's poll. Until the user decides it
// returns ErrClientDevicePending (or ErrClientDeviceSlowDown when polled too
// often); after approval it signs the device in, exactly once.
func ExchangeClientDeviceCode(request ClientDeviceTokenRequest, ip string) (*ClientDeviceLogin, error) {
	if !operation_setting.GetClientDeviceSetting().Enabled {
		return nil, ErrClientDeviceDisabled
	}
	if request.DeviceCode == "" || len(request.DeviceCode) > 128 {
		return nil, ErrClientDeviceRequestInvalid
	}
	now := time.Now()
	authorization, err := model.FindClientDeviceAuthorization(sha256Hex(request.DeviceCode))
	if err != nil {
		if errors.Is(err, model.ErrClientDeviceAuthorizationNotFound) {
			return nil, ErrClientDeviceExpired
		}
		return nil, err
	}
	message := clientDeviceMessage("client-device-token", request.ClientDeviceSignedFields, request.DeviceCode)
	if err := verifyClientDeviceProof(authorization.PublicKey, request.ClientDeviceSignedFields, message); err != nil {
		return nil, err
	}
	if authorization.ExpiresAt <= now.Unix() || authorization.Status == model.ClientDeviceAuthorizationConsumed {
		return nil, ErrClientDeviceExpired
	}
	switch authorization.Status {
	case model.ClientDeviceAuthorizationDenied:
		return nil, ErrClientDeviceDenied
	case model.ClientDeviceAuthorizationPending:
		if err := model.MarkClientDeviceAuthorizationPolled(authorization.Id, now.Unix()); err != nil {
			return nil, err
		}
		if authorization.LastPolledAt > 0 && now.Unix()-authorization.LastPolledAt < int64(ClientDevicePollInterval/time.Second) {
			return nil, ErrClientDeviceSlowDown
		}
		return nil, ErrClientDevicePending
	}
	if err := model.ConsumeClientDeviceAuthorization(authorization.Id); err != nil {
		return nil, ErrClientDeviceExpired
	}

	deviceID, err := randomToken(16)
	if err != nil {
		return nil, err
	}
	device := &model.ClientDevice{
		UserId:     authorization.UserId,
		DeviceId:   deviceID,
		Name:       authorization.ClientName,
		Platform:   authorization.Platform,
		AppVersion: authorization.AppVersion,
		PublicKey:  authorization.PublicKey,
		Verified:   authorization.Verified,
		Status:     model.ClientDeviceStatusActive,
		CreatedAt:  now.Unix(),
		LastUsedAt: now.Unix(),
		LastIP:     truncateAuthMetadata(ip, 64),
	}
	bundle, err := CreateLoginSession(authorization.UserId, "client_device", ip, clientDeviceUserAgent(device))
	if err != nil {
		return nil, err
	}
	device.SessionSID = bundle.Session.SID
	if err := model.CreateClientDevice(device); err != nil {
		_, _ = model.RevokeUserSession(authorization.UserId, bundle.Session.SID, "client_device_failed")
		return nil, err
	}
	user, err := model.GetSelfUserById(authorization.UserId)
	if err != nil {
		return nil, err
	}
	return &ClientDeviceLogin{Bundle: bundle, Device: device, User: user}, nil
}

// RefreshClientDeviceSession rotates a device's refresh token. The request must
// be signed by the device key and the token must belong to the device's login
// session, so a refresh token copied off the device is not enough.
func RefreshClientDeviceSession(request ClientDeviceRefreshRequest, ip string) (*ClientDeviceLogin, error) {
	device, err := model.GetActiveClientDevice(strings.TrimSpace(request.DeviceID))
	if err != nil {
		if errors.Is(err, model.ErrClientDeviceNotFound) {
			return nil, ErrLoginSessionRevoked
		}
		return nil, err
	}
	message := clientDeviceMessage("client-device-refresh", request.ClientDeviceSignedFields, device.DeviceId, sha256Hex(request.RefreshToken))
	if err := verifyClientDeviceProof(device.PublicKey, request.ClientDeviceSignedFields, message); err != nil {
		return nil, err
	}
	if sid, ok := RefreshTokenSID(request.RefreshToken); !ok || sid != device.SessionSID {
		return nil, ErrRefreshTokenInvalid
	}
	bundle, user, err := RefreshLoginSession(request.RefreshToken, device.SessionSID, ip, clientDeviceUserAgent(device))
	if err != nil {
		return nil, err
	}
	model.TouchClientDevice(device, truncateAuthMetadata(ip, 64), time.Now().Unix())
	return &ClientDeviceLogin{Bundle: bundle, Device: device, User: user}, nil
}

// ListClientDevices returns the user's active devices.
func ListClientDevices(userID int) ([]model.ClientDevice, error) {
	devices, err := model.ListActiveClientDevices(userID)
	if devices == nil {
		devices = []model.ClientDevice{}
	}
	return devices, err
}

// RevokeClientDevice revokes a device and signs it out.
func RevokeClientDevice(userID, id int) (*model.ClientDevice, error) {
	device, err := model.RevokeClientDevice(userID, id, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	if device.SessionSID != "" {
		if _, err := model.RevokeUserSession(userID, device.SessionSID, "client_device_revoked"); err != nil {
			return device, err
		}
	}
	return device, nil
}

// clientDeviceUserAgent labels the device's login session so the security page
// can show it as a Lyra Box client rather than an unknown browser.
func clientDeviceUserAgent(device *model.ClientDevice) string {
	return fmt.Sprintf("LyraBox/%s (%s; %s)", device.AppVersion, device.Platform, device.Name)
}

func NormalizeClientDeviceUserCode(code string) string {
	var builder strings.Builder
	for _, r := range strings.ToUpper(code) {
		if r >= 'A' && r <= 'Z' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func FormatClientDeviceUserCode(code string) string {
	if len(code) != clientDeviceUserCodeLength {
		return code
	}
	return code[:4] + "-" + code[4:]
}

func clientDeviceMessage(purpose string, fields ClientDeviceSignedFields, parts ...string) string {
	return strings.Join(append([]string{purpose, strconv.FormatInt(fields.Timestamp, 10), fields.Nonce}, parts...), "\n")
}

// verifyClientDeviceProof checks the timestamp window, the signature over
// message with publicKey, and finally claims the nonce, so an invalid request
// never burns a nonce.
func verifyClientDeviceProof(publicKey string, fields ClientDeviceSignedFields, message string) error {
	if len(fields.Nonce) < 16 || len(fields.Nonce) > 64 {
		return ErrClientDeviceRequestInvalid
	}
	skew := time.Since(time.Unix(fields.Timestamp, 0))
	if skew > clientDeviceSignatureWindow || skew < -clientDeviceSignatureWindow {
		return ErrClientDeviceSignatureInvalid
	}
	if err := VerifyClientDeviceSignature(publicKey, message, fields.Signature); err != nil {
		return err
	}
	return claimClientDeviceNonce(sha256Hex(publicKey) + ":" + fields.Nonce)
}

// VerifyClientDeviceSignature checks a WebCrypto ECDSA P-256 / SHA-256
// signature: the raw 64-byte r||s form, base64url, over message.
func VerifyClientDeviceSignature(publicKey, message, signature string) error {
	der, err := base64.RawURLEncoding.DecodeString(publicKey)
	if err != nil || len(publicKey) > 255 {
		return ErrClientDeviceRequestInvalid
	}
	parsed, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return ErrClientDeviceRequestInvalid
	}
	key, ok := parsed.(*ecdsa.PublicKey)
	if !ok || key.Curve != elliptic.P256() {
		return ErrClientDeviceRequestInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || len(raw) != 64 {
		return ErrClientDeviceSignatureInvalid
	}
	digest := sha256.Sum256([]byte(message))
	r := new(big.Int).SetBytes(raw[:32])
	s := new(big.Int).SetBytes(raw[32:])
	if !ecdsa.Verify(key, digest[:], r, s) {
		return ErrClientDeviceSignatureInvalid
	}
	return nil
}

// verifyClientBuildSignature reports whether signature is the HMAC-SHA256 of
// message under one of the configured build keys.
func verifyClientBuildSignature(signature, message string) bool {
	given, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || len(given) != sha256.Size {
		return false
	}
	for _, key := range operation_setting.ClientBuildKeys() {
		mac := hmac.New(sha256.New, []byte(key))
		mac.Write([]byte(message))
		if hmac.Equal(mac.Sum(nil), given) {
			return true
		}
	}
	return false
}

var clientDeviceNonces = struct {
	sync.Mutex
	expires map[string]int64
}{expires: map[string]int64{}}

// claimClientDeviceNonce records a nonce and fails if it was seen within the
// replay window. Redis is shared by every instance; without it the guard is
// per process.
func claimClientDeviceNonce(key string) error {
	ttl := 2 * clientDeviceSignatureWindow
	if common.RedisEnabled {
		claimed, err := common.RDB.SetNX(context.Background(), "client_device_nonce:"+key, 1, ttl).Result()
		if err != nil {
			return err
		}
		if !claimed {
			return ErrClientDeviceReplay
		}
		return nil
	}
	now := time.Now().Unix()
	clientDeviceNonces.Lock()
	defer clientDeviceNonces.Unlock()
	if expiresAt, seen := clientDeviceNonces.expires[key]; seen && expiresAt > now {
		return ErrClientDeviceReplay
	}
	if len(clientDeviceNonces.expires) > 100_000 {
		for k, expiresAt := range clientDeviceNonces.expires {
			if expiresAt <= now {
				delete(clientDeviceNonces.expires, k)
			}
		}
	}
	clientDeviceNonces.expires[key] = now + int64(ttl/time.Second)
	return nil
}

func randomToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func randomUserCode() (string, error) {
	alphabet := big.NewInt(int64(len(clientDeviceUserCodeAlphabet)))
	var builder strings.Builder
	for range clientDeviceUserCodeLength {
		n, err := rand.Int(rand.Reader, alphabet)
		if err != nil {
			return "", err
		}
		builder.WriteByte(clientDeviceUserCodeAlphabet[n.Int64()])
	}
	return builder.String(), nil
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func truncateRunes(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return string([]rune(value)[:max])
}
