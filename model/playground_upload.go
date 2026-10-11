package model

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm/clause"
)

const PlaygroundChunkSize = 256 * 1024

// Index -1 is the durable completion receipt; chunk bodies are removed after import.
type PlaygroundUploadChunk struct {
	Id          int64
	UserId      int      `gorm:"not null;uniqueIndex:uk_playground_chunk,priority:1"`
	Fingerprint string   `gorm:"size:64;not null;uniqueIndex:uk_playground_chunk,priority:2"`
	ChunkIndex  int      `gorm:"not null;uniqueIndex:uk_playground_chunk,priority:3"`
	TotalSize   int      `gorm:"not null"`
	Hash        string   `gorm:"size:64;not null"`
	Content     LongText `gorm:"not null"`
	CreateTime  int64    `gorm:"not null"`
}
type PlaygroundUploadStatus struct {
	Chunks map[int]string          `json:"chunks"`
	Result *PlaygroundImportResult `json:"result,omitempty"`
}

func validatePlaygroundUpload(fingerprint string, size int) error {
	digest, err := hex.DecodeString(fingerprint)
	if err != nil || len(digest) != sha256.Size || fingerprint != hex.EncodeToString(digest) || size <= 0 || size > PlaygroundDocumentLimit {
		return ErrPlaygroundInvalid
	}
	return nil
}
func GetPlaygroundUpload(userId int, fingerprint string, size int) (*PlaygroundUploadStatus, error) {
	if err := validatePlaygroundUpload(fingerprint, size); err != nil {
		return nil, err
	}
	query := playgroundDB().Where("user_id = ? AND fingerprint = ?", userId, fingerprint)
	if err := playgroundDB().Where("user_id = ? AND chunk_index >= 0 AND create_time < ?", userId, time.Now().Add(-7*24*time.Hour).Unix()).Delete(&PlaygroundUploadChunk{}).Error; err != nil {
		return nil, err
	}
	var rows []PlaygroundUploadChunk
	if err := query.Select("chunk_index", "total_size", "hash", "content").Find(&rows).Error; err != nil {
		return nil, err
	}
	status := &PlaygroundUploadStatus{Chunks: make(map[int]string)}
	for _, row := range rows {
		if row.TotalSize != size {
			return nil, ErrPlaygroundInvalid
		}
		if row.ChunkIndex >= 0 {
			status.Chunks[row.ChunkIndex] = row.Hash
			continue
		}
		var result PlaygroundImportResult
		if common.UnmarshalJsonStr(string(row.Content), &result) != nil {
			return nil, ErrPlaygroundInvalid
		}
		// Preserve deletion semantics when retrying an already completed upload.
		var conversation PlaygroundConversation
		if err := playgroundDB().Unscoped().Where("user_id = ? AND id = ?", userId, result.ConversationId).First(&conversation).Error; err != nil {
			return nil, err
		}
		result.Deleted = conversation.DeletedAt.Valid
		status.Result = &result
	}
	return status, nil
}
func SavePlaygroundUploadChunk(userId int, fingerprint string, size, index int, hash, content string) error {
	if err := validatePlaygroundUpload(fingerprint, size); err != nil {
		return err
	}
	count := (size + PlaygroundChunkSize - 1) / PlaygroundChunkSize
	if index < 0 || index >= count || len(content) > base64.StdEncoding.EncodedLen(PlaygroundChunkSize) {
		return ErrPlaygroundInvalid
	}
	data, err := base64.StdEncoding.Strict().DecodeString(content)
	expectedSize := min(PlaygroundChunkSize, size-index*PlaygroundChunkSize)
	digest := sha256.Sum256(data)
	if err != nil || len(data) != expectedSize || hash != hex.EncodeToString(digest[:]) {
		return ErrPlaygroundInvalid
	}
	row := PlaygroundUploadChunk{UserId: userId, Fingerprint: fingerprint, ChunkIndex: index, TotalSize: size, Hash: hash, Content: LongText(content), CreateTime: time.Now().Unix()}
	if err := playgroundDB().Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return err
	}
	var saved PlaygroundUploadChunk
	if err := playgroundDB().Where("user_id = ? AND fingerprint = ? AND chunk_index = ?", userId, fingerprint, index).First(&saved).Error; err != nil {
		return err
	}
	if saved.TotalSize != size || saved.Hash != hash {
		return ErrPlaygroundInvalid
	}
	return nil
}
func CompletePlaygroundUpload(userId int, fingerprint string, size int) (*PlaygroundImportResult, error) {
	status, err := GetPlaygroundUpload(userId, fingerprint, size)
	if err != nil {
		return nil, err
	}
	if status.Result != nil {
		return status.Result, nil
	}
	var rows []PlaygroundUploadChunk
	if err := playgroundDB().Where("user_id = ? AND fingerprint = ? AND chunk_index >= 0", userId, fingerprint).Order("chunk_index ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	count := (size + PlaygroundChunkSize - 1) / PlaygroundChunkSize
	if len(rows) != count {
		latest, err := GetPlaygroundUpload(userId, fingerprint, size)
		if err != nil {
			return nil, err
		}
		if latest.Result != nil {
			return latest.Result, nil
		}
		return nil, ErrPlaygroundInvalid
	}
	data := make([]byte, 0, size)
	for index, row := range rows {
		if row.ChunkIndex != index || row.TotalSize != size {
			return nil, ErrPlaygroundInvalid
		}
		chunk, err := base64.StdEncoding.Strict().DecodeString(string(row.Content))
		digest := sha256.Sum256(chunk)
		if err != nil || row.Hash != hex.EncodeToString(digest[:]) {
			return nil, ErrPlaygroundInvalid
		}
		data = append(data, chunk...)
	}
	digest := sha256.Sum256(data)
	if len(data) != size || hex.EncodeToString(digest[:]) != fingerprint {
		return nil, ErrPlaygroundInvalid
	}
	var source PlaygroundLegacySource
	if common.Unmarshal(data, &source) != nil {
		return nil, ErrPlaygroundInvalid
	}
	result, err := ImportPlaygroundConversation(userId, source)
	if err != nil {
		return nil, err
	}
	receipt, err := common.Marshal(result)
	if err != nil {
		return nil, err
	}
	row := PlaygroundUploadChunk{UserId: userId, Fingerprint: fingerprint, ChunkIndex: -1, TotalSize: size, Hash: fingerprint, Content: LongText(receipt), CreateTime: time.Now().Unix()}
	if err := playgroundDB().Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return nil, err
	}
	// A concurrent completer may still be reading. It either succeeds idempotently
	// or retries against the receipt; it can never create another conversation.
	if err := playgroundDB().Where("user_id = ? AND fingerprint = ? AND chunk_index >= 0", userId, fingerprint).Delete(&PlaygroundUploadChunk{}).Error; err != nil {
		return nil, err
	}
	return result, nil
}
