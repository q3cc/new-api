package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const PlaygroundDocumentLimit = 8 * 1024 * 1024

// Caps on what one user may keep; variables so tests can lower them.
var (
	PlaygroundMaxConversationsPerUser = 500
	PlaygroundMaxUploadsPerUser       = 5
)

// playgroundPacketHeadroom leaves room in a MySQL packet for the rest of the
// statement around a document at the size limit.
const playgroundPacketHeadroom = 1024 * 1024

// playgroundPacketWarning says whether a MySQL max_allowed_packet value is too
// small to store the largest playground conversation, and how to report it.
func playgroundPacketWarning(packet int64) (string, bool) {
	needed := int64(PlaygroundDocumentLimit + playgroundPacketHeadroom)
	if packet <= 0 || packet >= needed {
		return "", false
	}
	return common.LogText("MySQL max_allowed_packet is %d bytes, below the %d bytes a playground conversation may need; raise it in the MySQL server configuration", packet, needed), true
}

// warnMySQLPacketLimit logs once at startup when the server would reject the
// largest conversation the playground accepts. The setting is not changed.
func warnMySQLPacketLimit(db *gorm.DB) {
	var packet int64
	if err := db.Raw("SELECT @@max_allowed_packet").Scan(&packet).Error; err != nil {
		return
	}
	if text, warn := playgroundPacketWarning(packet); warn {
		common.SysLog(text)
	}
}

var (
	ErrPlaygroundInvalid  = errors.New("Invalid conversation data")
	ErrPlaygroundConflict = errors.New("This conversation has changed. Load the latest version or save a copy.")
	ErrPlaygroundTooLarge = errors.New("Conversation exceeds the size limit")
	ErrPlaygroundLimit    = errors.New("Playground limit reached")
)

// Deleted conversations retain only their identifiers, so delayed creation or
// import retries cannot resurrect messages the owner has removed.
type PlaygroundConversation struct {
	Id            int64          `json:"id"`
	UserId        int            `json:"-" gorm:"not null;uniqueIndex:uk_playground_create,priority:1;index:idx_playground_owner_time,priority:1"`
	CreationId    string         `json:"-" gorm:"size:64;not null;uniqueIndex:uk_playground_create,priority:2"`
	CreationHash  string         `json:"-" gorm:"size:64;not null"`
	Title         string         `json:"title" gorm:"size:200;not null"`
	Revision      int64          `json:"revision" gorm:"not null"`
	Content       LongText       `json:"-" gorm:"not null"`
	LastOperation string         `json:"-" gorm:"size:64;not null"`
	LastHash      string         `json:"-" gorm:"size:64;not null"`
	CreateTime    int64          `json:"create_time" gorm:"not null"`
	UpdateTime    int64          `json:"update_time" gorm:"not null;index:idx_playground_owner_time,priority:2"`
	DeletedAt     gorm.DeletedAt `json:"-" gorm:"index"`
}

type PlaygroundImport struct {
	Id             int64
	UserId         int    `gorm:"not null;uniqueIndex:uk_playground_import,priority:1"`
	Fingerprint    string `gorm:"size:64;not null;uniqueIndex:uk_playground_import,priority:2"`
	ConversationId int64  `gorm:"not null"`
}

type PlaygroundDocument struct {
	Messages            []json.RawMessage              `json:"messages"`
	Config              map[string]any                 `json:"config"`
	ParameterEnabled    map[string]bool                `json:"parameterEnabled"`
	Draft               string                         `json:"draft"`
	CompressionSettings *PlaygroundCompressionSettings `json:"compressionSettings,omitempty"`
	ContextLimits       map[string]int                 `json:"contextLimits,omitempty"`
	Compression         *PlaygroundCompression         `json:"compression,omitempty"`
	CompressionAttempt  string                         `json:"compressionAttempt,omitempty"`
}

type PlaygroundConversationDetail struct {
	PlaygroundConversation
	Document json.RawMessage `json:"document"`
}

type PlaygroundWrite struct {
	OperationId string          `json:"operation_id"`
	Revision    int64           `json:"revision"`
	Title       string          `json:"title"`
	Document    json.RawMessage `json:"document"`
}

// SQL trace output must never include a user's conversation document.
func playgroundDB() *gorm.DB {
	return DB.Session(&gorm.Session{Logger: logger.Discard})
}

func (write *PlaygroundWrite) Validate() error {
	write.Title = strings.TrimSpace(write.Title)
	if len(write.Document) > PlaygroundDocumentLimit {
		return ErrPlaygroundTooLarge
	}
	if len(write.OperationId) < 16 || len(write.OperationId) > 64 || utf8.RuneCountInString(write.Title) > 200 || write.Revision < 0 {
		return ErrPlaygroundInvalid
	}
	var doc PlaygroundDocument
	if common.Unmarshal(write.Document, &doc) != nil || doc.Messages == nil || doc.Config == nil || doc.ParameterEnabled == nil {
		return ErrPlaygroundInvalid
	}
	for key, value := range doc.Config {
		switch key {
		case "model", "group":
			if _, ok := value.(string); !ok {
				return ErrPlaygroundInvalid
			}
		case "stream":
			if _, ok := value.(bool); !ok {
				return ErrPlaygroundInvalid
			}
		case "temperature", "top_p", "max_tokens", "frequency_penalty", "presence_penalty", "seed":
			if value == nil && key == "seed" {
				continue
			}
			if _, ok := value.(float64); !ok {
				return ErrPlaygroundInvalid
			}
		default:
			return ErrPlaygroundInvalid
		}
	}
	for key := range doc.ParameterEnabled {
		switch key {
		case "temperature", "top_p", "max_tokens", "frequency_penalty", "presence_penalty", "seed":
		default:
			return ErrPlaygroundInvalid
		}
	}
	keys := make(map[string]bool, len(doc.Messages))
	for _, raw := range doc.Messages {
		var message struct {
			SelectedVersionId string `json:"selectedVersionId"`
			Key               string `json:"key"`
			From              string `json:"from"`
			Status            string `json:"status"`
			Versions          []struct {
				Id      string `json:"id"`
				Content string `json:"content"`
			} `json:"versions"`
		}
		if common.Unmarshal(raw, &message) != nil || message.Key == "" || keys[message.Key] || len(message.Versions) == 0 {
			return ErrPlaygroundInvalid
		}
		keys[message.Key] = true
		switch message.From {
		case "user", "assistant", "system":
		default:
			return ErrPlaygroundInvalid
		}
		switch message.Status {
		case "", "loading", "streaming", "complete", "error", "interrupted":
		default:
			return ErrPlaygroundInvalid
		}
		selectedFound := message.SelectedVersionId == ""
		for _, version := range message.Versions {
			if version.Id == "" {
				return ErrPlaygroundInvalid
			}
			selectedFound = selectedFound || version.Id == message.SelectedVersionId
		}
		if !selectedFound {
			return ErrPlaygroundInvalid
		}
	}
	if doc.CompressionSettings != nil {
		if err := doc.CompressionSettings.Validate(); err != nil {
			return err
		}
	}
	if doc.CompressionAttempt != "" && doc.CompressionAttempt != "requested" && doc.CompressionAttempt != "failed" {
		return ErrPlaygroundSettingsInvalid
	}
	for name, limit := range doc.ContextLimits {
		capability := GetPlaygroundModelCapability(name)
		// Models outside the capability table get their limit from the user or
		// from a provider's context-length error, within a plausible bound.
		ceiling := maxPlaygroundCustomContextLimit
		if capability.TextGeneration {
			ceiling = max(capability.ContextWindow, capability.InputLimit)
		}
		if !validPlaygroundModelName(name) || limit < 1 || limit > ceiling {
			return ErrPlaygroundSettingsInvalid
		}
	}
	if c := doc.Compression; c != nil {
		// Any chat model may have produced the summary: without a configured
		// compression model the conversation's own model compresses.
		if strings.TrimSpace(c.Summary) == "" || !keys[c.Boundary] || len(c.SourceHash) != 64 || !validPlaygroundModelName(c.Model) || c.CreatedAt <= 0 {
			return ErrPlaygroundSettingsInvalid
		}
	}
	return nil
}

func playgroundWriteHash(write PlaygroundWrite) string {
	value := sha256.Sum256(append(append([]byte(write.Title), 0), write.Document...))
	return hex.EncodeToString(value[:])
}

func GetPlaygroundConversation(userId int, id int64) (*PlaygroundConversationDetail, error) {
	var row PlaygroundConversation
	if err := playgroundDB().Where("user_id = ? AND id = ?", userId, id).First(&row).Error; err != nil {
		return nil, err
	}
	return &PlaygroundConversationDetail{PlaygroundConversation: row, Document: json.RawMessage(row.Content)}, nil
}

func ListPlaygroundConversations(userId int, keyword string, page *common.PageInfo) ([]PlaygroundConversation, int64, error) {
	rows := make([]PlaygroundConversation, 0)
	var count int64
	query := playgroundDB().Model(&PlaygroundConversation{}).Where("user_id = ?", userId)
	keyword = strings.TrimSpace(keyword)
	if utf8.RuneCountInString(keyword) > 200 {
		return nil, 0, ErrPlaygroundInvalid
	}
	if keyword != "" {
		query = query.Where("title LIKE ? ESCAPE '!'", containsSearchPattern(keyword))
	}
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	// Out-of-range paging falls back to the first page of a bounded size.
	size := max(1, min(page.GetPageSize(), 100))
	err := query.Select("id", "title", "revision", "create_time", "update_time").Order("update_time DESC, id DESC").Offset(max(page.GetPage()-1, 0) * size).Limit(size).Find(&rows).Error
	return rows, count, err
}

// requirePlaygroundConversationRoom refuses a new conversation once the user
// keeps the maximum; deleted conversations do not count.
func requirePlaygroundConversationRoom(tx *gorm.DB, userId int) error {
	var count int64
	if err := tx.Model(&PlaygroundConversation{}).Where("user_id = ?", userId).Count(&count).Error; err != nil {
		return err
	}
	if count >= int64(PlaygroundMaxConversationsPerUser) {
		return ErrPlaygroundLimit
	}
	return nil
}

func CreatePlaygroundConversation(userId int, write PlaygroundWrite) (*PlaygroundConversationDetail, error) {
	if err := write.Validate(); err != nil {
		return nil, err
	}
	hash := playgroundWriteHash(write)
	now := time.Now().UnixMilli()
	row := PlaygroundConversation{UserId: userId, CreationId: write.OperationId, CreationHash: hash, Title: write.Title, Revision: 1, Content: LongText(write.Document), LastOperation: write.OperationId, LastHash: hash, CreateTime: now, UpdateTime: now}
	err := playgroundDB().Transaction(func(tx *gorm.DB) error {
		// A replay of a known creation must succeed even when the user is at
		// the limit, so the room check only guards an actual insert.
		var existing int64
		if err := tx.Model(&PlaygroundConversation{}).Unscoped().Where("user_id = ? AND creation_id = ?", userId, write.OperationId).Count(&existing).Error; err != nil {
			return err
		}
		if existing == 0 {
			if err := requirePlaygroundConversationRoom(tx, userId); err != nil {
				return err
			}
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
	})
	if err != nil {
		return nil, err
	}
	if err := playgroundDB().Unscoped().Where("user_id = ? AND creation_id = ?", userId, write.OperationId).First(&row).Error; err != nil {
		return nil, err
	}
	if row.DeletedAt.Valid {
		return nil, gorm.ErrRecordNotFound
	}
	if row.CreationHash != hash || row.Revision != 1 {
		return nil, ErrPlaygroundConflict
	}
	return &PlaygroundConversationDetail{PlaygroundConversation: row, Document: json.RawMessage(row.Content)}, nil
}

// playgroundSavedRow answers a write without reading the document back: the
// caller already holds the document it sent, so only the metadata is read.
func playgroundSavedRow(userId int, id int64, document json.RawMessage) (*PlaygroundConversationDetail, error) {
	var row PlaygroundConversation
	if err := playgroundDB().Select("id", "user_id", "title", "revision", "last_operation", "last_hash", "create_time", "update_time").
		Where("user_id = ? AND id = ?", userId, id).First(&row).Error; err != nil {
		return nil, err
	}
	return &PlaygroundConversationDetail{PlaygroundConversation: row, Document: document}, nil
}

func SavePlaygroundConversation(userId int, id int64, write PlaygroundWrite) (*PlaygroundConversationDetail, error) {
	if err := write.Validate(); err != nil {
		return nil, err
	}
	hash := playgroundWriteHash(write)
	now := time.Now().UnixMilli()
	result := playgroundDB().Model(&PlaygroundConversation{}).Where("user_id = ? AND id = ? AND revision = ? AND last_operation <> ?", userId, id, write.Revision, write.OperationId).Updates(map[string]any{
		"title": write.Title, "content": LongText(write.Document), "revision": write.Revision + 1,
		"last_operation": write.OperationId, "last_hash": hash, "update_time": now,
	})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 1 {
		// The update itself is the answer; a writer that lands right after it
		// must not turn this success into a conflict.
		var row PlaygroundConversation
		if err := playgroundDB().Select("id", "user_id", "create_time").Where("user_id = ? AND id = ?", userId, id).First(&row).Error; err != nil {
			return nil, err
		}
		row.Title, row.Revision, row.LastOperation, row.LastHash, row.UpdateTime = write.Title, write.Revision+1, write.OperationId, hash, now
		return &PlaygroundConversationDetail{PlaygroundConversation: row, Document: write.Document}, nil
	}
	// Nothing changed: the same operation was applied before, the revision is
	// stale, or the conversation is gone.
	row, err := playgroundSavedRow(userId, id, write.Document)
	if err != nil {
		return nil, err
	}
	if row.LastOperation != write.OperationId || row.LastHash != hash {
		return nil, ErrPlaygroundConflict
	}
	return row, nil
}

// PlaygroundPatch changes a conversation's title or some document fields
// other than its messages, so settings and drafts do not re-upload the whole
// document.
type PlaygroundPatch struct {
	OperationId string                     `json:"operation_id"`
	Revision    int64                      `json:"revision"`
	Title       *string                    `json:"title"`
	Patch       map[string]json.RawMessage `json:"patch"`
}

var playgroundPatchableKeys = []string{"config", "parameterEnabled", "draft", "compressionSettings", "contextLimits", "compression", "compressionAttempt", "titleGeneration"}

func PatchPlaygroundConversation(userId int, id int64, patch PlaygroundPatch) (*PlaygroundConversationDetail, error) {
	if len(patch.Patch) == 0 && patch.Title == nil {
		return nil, ErrPlaygroundInvalid
	}
	for key := range patch.Patch {
		if !slices.Contains(playgroundPatchableKeys, key) {
			return nil, ErrPlaygroundInvalid
		}
	}
	var saved *PlaygroundConversationDetail
	err := playgroundDB().Transaction(func(tx *gorm.DB) error {
		var current PlaygroundConversation
		if err := lockForUpdate(tx).Where("user_id = ? AND id = ?", userId, id).First(&current).Error; err != nil {
			return err
		}
		if current.LastOperation == patch.OperationId {
			saved = &PlaygroundConversationDetail{PlaygroundConversation: current, Document: json.RawMessage(current.Content)}
			return nil
		}
		if current.Revision != patch.Revision {
			return ErrPlaygroundConflict
		}
		fields := map[string]json.RawMessage{}
		if err := common.UnmarshalJsonStr(string(current.Content), &fields); err != nil {
			return ErrPlaygroundInvalid
		}
		for key, value := range patch.Patch {
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				delete(fields, key)
			} else {
				fields[key] = value
			}
		}
		merged, err := common.Marshal(fields)
		if err != nil {
			return ErrPlaygroundInvalid
		}
		write := PlaygroundWrite{OperationId: patch.OperationId, Revision: patch.Revision, Title: current.Title, Document: merged}
		if patch.Title != nil {
			write.Title = *patch.Title
		}
		if err := write.Validate(); err != nil {
			return err
		}
		hash := playgroundWriteHash(write)
		now := time.Now().UnixMilli()
		result := tx.Model(&PlaygroundConversation{}).Where("id = ? AND revision = ?", current.Id, current.Revision).Updates(map[string]any{
			"title": write.Title, "content": LongText(merged), "revision": current.Revision + 1,
			"last_operation": write.OperationId, "last_hash": hash, "update_time": now,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPlaygroundConflict
		}
		current.Title, current.Content, current.Revision, current.LastOperation, current.LastHash, current.UpdateTime = write.Title, LongText(merged), current.Revision+1, write.OperationId, hash, now
		saved = &PlaygroundConversationDetail{PlaygroundConversation: current, Document: merged}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return saved, nil
}

func DeletePlaygroundConversation(userId int, id int64) error {
	result := playgroundDB().Model(&PlaygroundConversation{}).Where("user_id = ? AND id = ?", userId, id).Updates(map[string]any{
		"content": "{}", "title": "", "last_hash": "", "deleted_at": time.Now(), "revision": gorm.Expr("revision + 1"),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// Raw legacy strings are hashed before normalization. The import receipt stays
// after deletion, and a failed transaction leaves neither receipt nor content.
type PlaygroundLegacySource struct {
	Messages         *string `json:"messages"`
	Config           *string `json:"config"`
	ParameterEnabled *string `json:"parameter_enabled"`
}

type PlaygroundImportResult struct {
	ConversationId int64 `json:"conversation_id"`
	Deleted        bool  `json:"deleted"`
}

func ImportPlaygroundConversation(userId int, source PlaygroundLegacySource) (*PlaygroundImportResult, error) {
	if source.Messages == nil && source.Config == nil && source.ParameterEnabled == nil {
		return nil, ErrPlaygroundInvalid
	}
	raw, err := common.Marshal(source)
	if err != nil {
		return nil, ErrPlaygroundInvalid
	}
	if len(raw) > PlaygroundDocumentLimit {
		return nil, ErrPlaygroundTooLarge
	}
	digest := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(digest[:])
	doc := PlaygroundDocument{Messages: []json.RawMessage{}, Config: map[string]any{}, ParameterEnabled: map[string]bool{}}
	for _, part := range []struct {
		raw    *string
		target any
	}{{source.Messages, &doc.Messages}, {source.Config, &doc.Config}, {source.ParameterEnabled, &doc.ParameterEnabled}} {
		if part.raw == nil {
			continue
		}
		value := []byte(*part.raw)
		var envelope struct {
			Version *int            `json:"version"`
			Data    json.RawMessage `json:"data"`
		}
		if common.Unmarshal(value, &envelope) == nil && envelope.Version != nil {
			if *envelope.Version != 1 {
				return nil, ErrPlaygroundInvalid
			}
			value = envelope.Data
		}
		if common.Unmarshal(value, part.target) != nil {
			return nil, ErrPlaygroundInvalid
		}
	}
	content, err := common.Marshal(doc)
	if err != nil {
		return nil, ErrPlaygroundInvalid
	}
	write := PlaygroundWrite{OperationId: fingerprint, Title: "Imported conversation", Document: content}
	if err := write.Validate(); err != nil {
		return nil, err
	}
	var result PlaygroundImportResult
	err = playgroundDB().Transaction(func(tx *gorm.DB) error {
		receipt := PlaygroundImport{UserId: userId, Fingerprint: fingerprint}
		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&receipt)
		if insert.Error != nil {
			return insert.Error
		}
		if err := tx.Where("user_id = ? AND fingerprint = ?", userId, fingerprint).First(&receipt).Error; err != nil {
			return err
		}
		if receipt.ConversationId == 0 {
			if err := requirePlaygroundConversationRoom(tx, userId); err != nil {
				return err
			}
			now := time.Now().UnixMilli()
			hash := playgroundWriteHash(write)
			row := PlaygroundConversation{UserId: userId, CreationId: "import:" + fingerprint[:56], CreationHash: hash, Title: write.Title, Revision: 1, Content: LongText(content), LastOperation: fingerprint, LastHash: hash, CreateTime: now, UpdateTime: now}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			receipt.ConversationId = row.Id
			if err := tx.Model(&receipt).Update("conversation_id", row.Id).Error; err != nil {
				return err
			}
		}
		var row PlaygroundConversation
		if err := tx.Unscoped().Where("user_id = ? AND id = ?", userId, receipt.ConversationId).First(&row).Error; err != nil {
			return err
		}
		result = PlaygroundImportResult{ConversationId: row.Id, Deleted: row.DeletedAt.Valid}
		return nil
	})
	return &result, err
}
