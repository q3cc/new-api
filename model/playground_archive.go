package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/klauspost/compress/zstd"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// A conversation neither opened nor changed for PlaygroundArchiveAfter is
// archived: its document is stored compressed until it is opened again.
const PlaygroundArchiveAfter = 7 * 24 * time.Hour

// Opening a conversation records the time at most this often, so reading it
// repeatedly does not write on every request.
const playgroundOpenTouchInterval = time.Hour

const playgroundArchiveBatchSize = 100

// ErrPlaygroundDamaged reports an archived document that does not decompress.
var ErrPlaygroundDamaged = errors.New("archived playground conversation is damaged")

var (
	playgroundArchiveEncoder = mustPlaygroundArchiveEncoder()
	playgroundArchiveDecoder = mustPlaygroundArchiveDecoder()
)

func mustPlaygroundArchiveEncoder() *zstd.Encoder {
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedBetterCompression))
	if err != nil {
		panic(err)
	}
	return encoder
}

// The decoder refuses output beyond the document limit, so a damaged or
// forged archive cannot make a read allocate without bound.
func mustPlaygroundArchiveDecoder() *zstd.Decoder {
	decoder, err := zstd.NewReader(nil, zstd.WithDecoderMaxMemory(PlaygroundDocumentLimit))
	if err != nil {
		panic(err)
	}
	return decoder
}

// LongBlob is binary column data: longblob on MySQL, bytea on PostgreSQL and
// blob on SQLite. Compressed bytes cannot go into a text column, where MySQL
// and PostgreSQL reject invalid UTF-8 and NUL bytes.
type LongBlob []byte

func (LongBlob) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	switch db.Dialector.Name() {
	case string(common.DatabaseTypeMySQL):
		return "longblob"
	case string(common.DatabaseTypePostgreSQL):
		return "bytea"
	}
	return "blob"
}

func (b LongBlob) Value() (driver.Value, error) {
	if b == nil {
		return nil, nil
	}
	return []byte(b), nil
}

// Scan copies the bytes: a driver may reuse its buffer for the next row.
func (b *LongBlob) Scan(src any) error {
	switch value := src.(type) {
	case nil:
		*b = nil
	case []byte:
		*b = append(LongBlob(nil), value...)
	case string:
		*b = LongBlob(value)
	default:
		return fmt.Errorf("unsupported LongBlob value %T", src)
	}
	return nil
}

// document returns the stored document, decompressing an archived one.
func (row *PlaygroundConversation) document() (json.RawMessage, error) {
	if row.ArchivedAt == 0 {
		return json.RawMessage(row.Content), nil
	}
	plain, err := playgroundArchiveDecoder.DecodeAll(row.ArchivedContent, nil)
	if err != nil || len(plain) > PlaygroundDocumentLimit || !json.Valid(plain) {
		return nil, ErrPlaygroundDamaged
	}
	return plain, nil
}

// playgroundPlainColumns stores a document uncompressed, replacing any
// archived copy.
func playgroundPlainColumns(document []byte) map[string]any {
	return map[string]any{
		"content":          LongText(document),
		"content_bytes":    len(document),
		"archived_at":      0,
		"archived_content": gorm.Expr("NULL"),
	}
}

// restorePlaygroundConversation stores an opened archived conversation
// uncompressed again. Revision and update time stay as they were: the
// content has not changed. A concurrent write already stored the document
// uncompressed, so the update applies only to the unchanged row.
func restorePlaygroundConversation(row *PlaygroundConversation, document []byte, now int64) {
	columns := playgroundPlainColumns(document)
	columns["open_time"] = now
	err := playgroundDB().Model(&PlaygroundConversation{}).
		Where("id = ? AND revision = ? AND archived_at = ?", row.Id, row.Revision, row.ArchivedAt).
		Updates(columns).Error
	if err != nil {
		common.SysLog(common.LogText("failed to restore archived playground conversation %d: %v", row.Id, err))
		return
	}
	row.Content, row.ContentBytes, row.ArchivedAt, row.ArchivedContent, row.OpenTime = LongText(document), int64(len(document)), 0, nil, now
}

// touchPlaygroundConversation records that a conversation was opened, at
// most once per playgroundOpenTouchInterval.
func touchPlaygroundConversation(row *PlaygroundConversation, now int64) {
	threshold := now - playgroundOpenTouchInterval.Milliseconds()
	if row.OpenTime >= threshold {
		return
	}
	err := playgroundDB().Model(&PlaygroundConversation{}).
		Where("id = ? AND open_time < ?", row.Id, threshold).
		Update("open_time", now).Error
	if err != nil {
		common.SysLog(common.LogText("failed to record the opening of playground conversation %d: %v", row.Id, err))
		return
	}
	row.OpenTime = now
}

// ArchiveColdPlaygroundConversations compresses the documents of
// conversations neither opened nor changed for PlaygroundArchiveAfter. It
// examines at most limit conversations and reports how many it archived.
// Each one is updated only if it is still unchanged and unopened, so a
// concurrent save or open keeps its conversation uncompressed.
func ArchiveColdPlaygroundConversations(now time.Time, limit int) (int, error) {
	cutoff := now.Add(-PlaygroundArchiveAfter).UnixMilli()
	archived, examined := 0, 0
	var lastId int64
	for examined < limit {
		var ids []int64
		err := playgroundDB().Model(&PlaygroundConversation{}).
			Where("id > ? AND "+playgroundColdCondition, lastId, cutoff, cutoff).
			Order("id").Limit(min(playgroundArchiveBatchSize, limit-examined)).
			Pluck("id", &ids).Error
		if err != nil {
			return archived, err
		}
		for _, id := range ids {
			lastId = id
			examined++
			// Documents load one at a time: a batch of them could reach
			// hundreds of megabytes.
			var row PlaygroundConversation
			err := playgroundDB().Select("id", "revision", "content").
				Where("id = ? AND "+playgroundColdCondition, id, cutoff, cutoff).Take(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			if err != nil {
				return archived, err
			}
			done, err := archivePlaygroundConversation(row, cutoff, now.UnixMilli())
			if err != nil {
				return archived, err
			}
			if done {
				archived++
			}
		}
		if len(ids) < playgroundArchiveBatchSize {
			break
		}
	}
	return archived, nil
}

// playgroundColdCondition selects conversations stored uncompressed and
// neither changed nor opened since a cutoff, given twice.
const playgroundColdCondition = "archived_at = 0 AND update_time < ? AND open_time < ?"

// archivePlaygroundConversation compresses the document of row, read
// earlier, unless the conversation has been saved or opened since.
func archivePlaygroundConversation(row PlaygroundConversation, cutoff, now int64) (bool, error) {
	packed := playgroundArchiveEncoder.EncodeAll([]byte(row.Content), nil)
	// The uncompressed document is dropped below, so the copy must restore
	// to exactly it. A document that would not, such as one that is not
	// valid JSON, stays as it is.
	check := PlaygroundConversation{ArchivedAt: now, ArchivedContent: packed}
	if restored, err := check.document(); err != nil || string(restored) != string(row.Content) {
		common.SysLog(common.LogText("playground conversation %d was left uncompressed: its archive copy does not restore to the original", row.Id))
		return false, nil
	}
	result := playgroundDB().Model(&PlaygroundConversation{}).
		Where("id = ? AND revision = ? AND "+playgroundColdCondition, row.Id, row.Revision, cutoff, cutoff).
		Updates(map[string]any{
			"content":          LongText(""),
			"content_bytes":    len(row.Content),
			"archived_at":      now,
			"archived_content": LongBlob(packed),
		})
	return result.RowsAffected == 1, result.Error
}
