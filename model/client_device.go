package model

import (
	"errors"

	"gorm.io/gorm"
)

// Native chat clients (Lyra Box) sign in by browser authorization, a variant of
// the OAuth 2.0 Device Authorization Grant (RFC 8628): the client starts a
// request with its device public key, the signed-in user approves the short
// user code in the web console, and the client exchanges its secret device
// code for a login session bound to that key.

const (
	ClientDeviceAuthorizationPending  = "pending"
	ClientDeviceAuthorizationApproved = "approved"
	ClientDeviceAuthorizationDenied   = "denied"
	ClientDeviceAuthorizationConsumed = "consumed"

	ClientDeviceStatusActive  = "active"
	ClientDeviceStatusRevoked = "revoked"
)

var (
	ErrClientDeviceAuthorizationNotFound = errors.New("client device authorization not found")
	ErrClientDeviceAuthorizationClosed   = errors.New("client device authorization is no longer pending")
	ErrClientDeviceNotFound              = errors.New("client device not found")
)

// ClientDeviceAuthorization is one browser authorization request. Only the
// SHA-256 of the device code is stored; the code itself is a bearer secret
// held by the client until it is exchanged once.
type ClientDeviceAuthorization struct {
	Id             int    `json:"id"`
	DeviceCodeHash string `json:"-" gorm:"type:char(64);not null;uniqueIndex"`
	UserCode       string `json:"user_code" gorm:"type:varchar(16);not null;uniqueIndex"`
	Status         string `json:"status" gorm:"type:varchar(16);not null"`
	ClientName     string `json:"client_name" gorm:"type:varchar(128);not null;default:''"`
	Platform       string `json:"platform" gorm:"type:varchar(16);not null;default:''"`
	AppVersion     string `json:"app_version" gorm:"type:varchar(32);not null;default:''"`
	PublicKey      string `json:"-" gorm:"type:varchar(255);not null"`
	Verified       bool   `json:"verified" gorm:"not null"`
	UserId         int    `json:"-" gorm:"not null;default:0"`
	RequestIP      string `json:"request_ip" gorm:"type:varchar(64);not null;default:''"`
	UserAgent      string `json:"-" gorm:"type:varchar(512);not null;default:''"`
	CreatedAt      int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime:false"`
	ExpiresAt      int64  `json:"expires_at" gorm:"type:bigint;not null;index"`
	ApprovedAt     int64  `json:"-" gorm:"type:bigint;not null;default:0"`
	LastPolledAt   int64  `json:"-" gorm:"type:bigint;not null;default:0"`
}

// ClientDevice is an authorized device. Requests it signs with the private key
// matching PublicKey are attributed to UserId while the device is active and
// its login session is alive.
type ClientDevice struct {
	Id         int    `json:"id"`
	UserId     int    `json:"-" gorm:"not null;index:idx_client_device_user_status,priority:1"`
	DeviceId   string `json:"device_id" gorm:"type:varchar(64);not null;uniqueIndex"`
	Name       string `json:"name" gorm:"type:varchar(128);not null;default:''"`
	Platform   string `json:"platform" gorm:"type:varchar(16);not null;default:''"`
	AppVersion string `json:"app_version" gorm:"type:varchar(32);not null;default:''"`
	PublicKey  string `json:"-" gorm:"type:varchar(255);not null"`
	Verified   bool   `json:"verified" gorm:"not null"`
	SessionSID string `json:"-" gorm:"column:session_sid;type:varchar(64);not null;default:''"`
	Status     string `json:"status" gorm:"type:varchar(16);not null;index:idx_client_device_user_status,priority:2"`
	CreatedAt  int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime:false"`
	LastUsedAt int64  `json:"last_used_at" gorm:"type:bigint;not null;default:0"`
	LastIP     string `json:"last_ip" gorm:"type:varchar(64);not null;default:''"`
	RevokedAt  int64  `json:"revoked_at" gorm:"type:bigint;not null;default:0"`
}

func CreateClientDeviceAuthorization(authorization *ClientDeviceAuthorization) error {
	return DB.Create(authorization).Error
}

// DeleteExpiredClientDeviceAuthorizations removes requests that expired before
// cutoff, so user codes can be reused and the table stays small.
func DeleteExpiredClientDeviceAuthorizations(cutoff int64) error {
	return DB.Where("expires_at < ?", cutoff).Delete(&ClientDeviceAuthorization{}).Error
}

// GetPendingClientDeviceAuthorization finds an unexpired pending request by
// its normalized user code.
func GetPendingClientDeviceAuthorization(userCode string, now int64) (*ClientDeviceAuthorization, error) {
	var authorization ClientDeviceAuthorization
	err := DB.Where("user_code = ? AND status = ? AND expires_at > ?", userCode, ClientDeviceAuthorizationPending, now).
		First(&authorization).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrClientDeviceAuthorizationNotFound
	}
	if err != nil {
		return nil, err
	}
	return &authorization, nil
}

// DecideClientDeviceAuthorization moves a pending request to approved (for
// userID) or denied. Only one decision can win.
func DecideClientDeviceAuthorization(userCode string, userID int, approve bool, now int64) (*ClientDeviceAuthorization, error) {
	var decided ClientDeviceAuthorization
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("user_code = ?", userCode).First(&decided).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrClientDeviceAuthorizationNotFound
			}
			return err
		}
		if decided.Status != ClientDeviceAuthorizationPending || decided.ExpiresAt <= now {
			return ErrClientDeviceAuthorizationClosed
		}
		decided.UserId = userID
		decided.ApprovedAt = now
		decided.Status = ClientDeviceAuthorizationDenied
		if approve {
			decided.Status = ClientDeviceAuthorizationApproved
		}
		result := tx.Model(&ClientDeviceAuthorization{}).
			Where("id = ? AND status = ?", decided.Id, ClientDeviceAuthorizationPending).
			Updates(map[string]any{"status": decided.Status, "user_id": userID, "approved_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrClientDeviceAuthorizationClosed
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &decided, nil
}

// FindClientDeviceAuthorization finds a request by the hash of its device code.
func FindClientDeviceAuthorization(deviceCodeHash string) (*ClientDeviceAuthorization, error) {
	var authorization ClientDeviceAuthorization
	err := DB.Where("device_code_hash = ?", deviceCodeHash).First(&authorization).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrClientDeviceAuthorizationNotFound
	}
	if err != nil {
		return nil, err
	}
	return &authorization, nil
}

// MarkClientDeviceAuthorizationPolled records the time of an authenticated
// poll, which paces the next one.
func MarkClientDeviceAuthorizationPolled(id int, now int64) error {
	return DB.Model(&ClientDeviceAuthorization{}).Where("id = ?", id).Update("last_polled_at", now).Error
}

// ConsumeClientDeviceAuthorization marks an approved request as used. It
// succeeds once, so a device code yields at most one login session.
func ConsumeClientDeviceAuthorization(id int) error {
	result := DB.Model(&ClientDeviceAuthorization{}).
		Where("id = ? AND status = ?", id, ClientDeviceAuthorizationApproved).
		Update("status", ClientDeviceAuthorizationConsumed)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrClientDeviceAuthorizationClosed
	}
	return nil
}

func CreateClientDevice(device *ClientDevice) error {
	return DB.Create(device).Error
}

func CountActiveClientDevices(userID int) (int64, error) {
	var count int64
	err := DB.Model(&ClientDevice{}).Where("user_id = ? AND status = ?", userID, ClientDeviceStatusActive).Count(&count).Error
	return count, err
}

// ListActiveClientDevices returns a user's active devices, most recently used
// first.
func ListActiveClientDevices(userID int) ([]ClientDevice, error) {
	var devices []ClientDevice
	err := DB.Where("user_id = ? AND status = ?", userID, ClientDeviceStatusActive).
		Order("last_used_at desc").Order("id desc").
		Find(&devices).Error
	return devices, err
}

// GetActiveClientDevice finds an active device by its public device id.
func GetActiveClientDevice(deviceID string) (*ClientDevice, error) {
	var device ClientDevice
	err := DB.Where("device_id = ? AND status = ?", deviceID, ClientDeviceStatusActive).First(&device).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrClientDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	return &device, nil
}

// RevokeClientDevice revokes one of userID's active devices and returns it.
func RevokeClientDevice(userID, id int, now int64) (*ClientDevice, error) {
	var device ClientDevice
	if err := DB.Where("id = ? AND user_id = ? AND status = ?", id, userID, ClientDeviceStatusActive).First(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrClientDeviceNotFound
		}
		return nil, err
	}
	result := DB.Model(&ClientDevice{}).
		Where("id = ? AND status = ?", id, ClientDeviceStatusActive).
		Updates(map[string]any{"status": ClientDeviceStatusRevoked, "revoked_at": now})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrClientDeviceNotFound
	}
	device.Status = ClientDeviceStatusRevoked
	device.RevokedAt = now
	return &device, nil
}

// TouchClientDevice records that the device was used, at most once a minute so
// signed requests do not each write a row.
func TouchClientDevice(device *ClientDevice, ip string, now int64) {
	if now-device.LastUsedAt < 60 && device.LastIP == ip {
		return
	}
	DB.Model(&ClientDevice{}).Where("id = ?", device.Id).Updates(map[string]any{"last_used_at": now, "last_ip": ip})
	device.LastUsedAt = now
	device.LastIP = ip
}
