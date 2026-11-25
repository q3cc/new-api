package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ChatSyncSession is one chat session a native client (Lyra Box) stored in the
// cloud. Content is the client's own serialization and is opaque here; the
// server only hashes it so clients can tell which sessions changed. Clients
// pull every session; they upload only when the user asks them to.
type ChatSyncSession struct {
	Id              int      `json:"-"`
	UserId          int      `json:"-" gorm:"not null;uniqueIndex:uk_chat_sync_user_session,priority:1;index:idx_chat_sync_user_updated,priority:1"`
	SessionId       string   `json:"session_id" gorm:"type:varchar(64);not null;uniqueIndex:uk_chat_sync_user_session,priority:2"`
	Name            string   `json:"name" gorm:"type:varchar(255);not null;default:''"`
	Content         LongText `json:"-" gorm:"not null"`
	ContentHash     string   `json:"content_hash" gorm:"type:char(64);not null"`
	Size            int64    `json:"size" gorm:"type:bigint;not null"`
	MessageCount    int      `json:"message_count" gorm:"not null;default:0"`
	ClientUpdatedAt int64    `json:"client_updated_at" gorm:"type:bigint;not null;default:0"`
	DeviceName      string   `json:"device_name" gorm:"type:varchar(128);not null;default:''"`
	CreatedAt       int64    `json:"created_at" gorm:"type:bigint;not null;autoCreateTime:false"`
	UpdatedAt       int64    `json:"updated_at" gorm:"type:bigint;not null;autoUpdateTime:false;index:idx_chat_sync_user_updated,priority:2"`
}

// ChatSyncWrite is one session in an upload.
type ChatSyncWrite struct {
	SessionId       string `json:"session_id"`
	Name            string `json:"name"`
	Content         string `json:"content"`
	MessageCount    int    `json:"message_count"`
	ClientUpdatedAt int64  `json:"client_updated_at"`
	// BaseHash is the content hash the client last pulled or uploaded, or ""
	// for a session it has never synced. An upload over a session that changed
	// since then is refused unless Force is set.
	BaseHash string `json:"base_hash"`
	Force    bool   `json:"force"`
}

// ChatSyncLimits bound what one user may store.
type ChatSyncLimits struct {
	MaxSessions int64
	MaxBytes    int64
}

// Upload outcomes, reported per session.
const (
	ChatSyncSaved     = "saved"
	ChatSyncUnchanged = "unchanged"
	ChatSyncConflict  = "conflict"
	ChatSyncLimited   = "limit_reached"
)

// ChatSyncResult is the outcome of one session in an upload. ContentHash and
// UpdatedAt describe the copy now in the cloud; on a conflict that is the
// other device's copy.
type ChatSyncResult struct {
	SessionId   string `json:"session_id"`
	Status      string `json:"status"`
	ContentHash string `json:"content_hash,omitempty"`
	UpdatedAt   int64  `json:"updated_at,omitempty"`
}

// chatSyncDB keeps chat content out of SQL trace logs.
func chatSyncDB() *gorm.DB {
	return DB.Session(&gorm.Session{Logger: logger.Discard})
}

func chatSyncContentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// ListChatSyncSessions returns a user's sessions without their content, most
// recently uploaded first.
func ListChatSyncSessions(userID int) ([]ChatSyncSession, error) {
	sessions := []ChatSyncSession{}
	err := chatSyncDB().Omit("content").Where("user_id = ?", userID).
		Order("updated_at desc").Order("id desc").
		Find(&sessions).Error
	return sessions, err
}

// ChatSyncUsage returns how many sessions and content bytes a user stores.
func ChatSyncUsage(userID int) (sessions int64, bytes int64, err error) {
	return ChatSyncUsageWithTx(chatSyncDB(), userID)
}

// GetChatSyncSessions returns the named sessions of a user with content.
// Unknown ids are skipped.
func GetChatSyncSessions(userID int, sessionIDs []string) ([]ChatSyncSession, error) {
	sessions := []ChatSyncSession{}
	if len(sessionIDs) == 0 {
		return sessions, nil
	}
	err := chatSyncDB().Where("user_id = ? AND session_id IN ?", userID, sessionIDs).Find(&sessions).Error
	return sessions, err
}

// SaveChatSyncSession stores one uploaded session. It refuses to overwrite a
// session another device changed since this one last synced it, and keeps the
// user within limits; neither refusal is an error.
func SaveChatSyncSession(userID int, write ChatSyncWrite, deviceName string, limits ChatSyncLimits, now int64) (ChatSyncResult, error) {
	result := ChatSyncResult{SessionId: write.SessionId}
	hash := chatSyncContentHash(write.Content)
	size := int64(len(write.Content))
	err := chatSyncDB().Transaction(func(tx *gorm.DB) error {
		var existing ChatSyncSession
		err := lockForUpdate(tx).Omit("content").Where("user_id = ? AND session_id = ?", userID, write.SessionId).First(&existing).Error
		found := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if found && existing.ContentHash == hash && existing.Name == write.Name {
			result.Status, result.ContentHash, result.UpdatedAt = ChatSyncUnchanged, hash, existing.UpdatedAt
			return nil
		}
		if found && !write.Force && write.BaseHash != existing.ContentHash {
			result.Status, result.ContentHash, result.UpdatedAt = ChatSyncConflict, existing.ContentHash, existing.UpdatedAt
			return nil
		}

		count, bytes, err := ChatSyncUsageWithTx(tx, userID)
		if err != nil {
			return err
		}
		if found {
			count--
			bytes -= existing.Size
		}
		if count+1 > limits.MaxSessions || bytes+size > limits.MaxBytes {
			result.Status = ChatSyncLimited
			return nil
		}

		values := map[string]any{
			"name": write.Name, "content": LongText(write.Content), "content_hash": hash, "size": size,
			"message_count": write.MessageCount, "client_updated_at": write.ClientUpdatedAt,
			"device_name": deviceName, "updated_at": now,
		}
		if found {
			err = tx.Model(&ChatSyncSession{}).Where("id = ?", existing.Id).Updates(values).Error
		} else {
			err = tx.Create(&ChatSyncSession{
				UserId: userID, SessionId: write.SessionId, Name: write.Name, Content: LongText(write.Content),
				ContentHash: hash, Size: size, MessageCount: write.MessageCount, ClientUpdatedAt: write.ClientUpdatedAt,
				DeviceName: deviceName, CreatedAt: now, UpdatedAt: now,
			}).Error
		}
		if err != nil {
			return err
		}
		result.Status, result.ContentHash, result.UpdatedAt = ChatSyncSaved, hash, now
		return nil
	})
	return result, err
}

// ChatSyncUsageWithTx is ChatSyncUsage inside a transaction.
func ChatSyncUsageWithTx(tx *gorm.DB, userID int) (sessions int64, bytes int64, err error) {
	var usage struct {
		Sessions int64
		Bytes    int64
	}
	err = tx.Model(&ChatSyncSession{}).Where("user_id = ?", userID).
		Select("COUNT(*) AS sessions, COALESCE(SUM(size), 0) AS bytes").Scan(&usage).Error
	return usage.Sessions, usage.Bytes, err
}

// DeleteChatSyncSession removes one of a user's sessions from the cloud.
func DeleteChatSyncSession(userID int, sessionID string) (bool, error) {
	result := chatSyncDB().Where("user_id = ? AND session_id = ?", userID, sessionID).Delete(&ChatSyncSession{})
	return result.RowsAffected > 0, result.Error
}
