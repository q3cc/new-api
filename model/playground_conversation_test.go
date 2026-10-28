package model

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPlaygroundDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "playground.db"))
			case "mysql":
				dsn := os.Getenv("TEST_PLAYGROUND_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_PLAYGROUND_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_PLAYGROUND_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_PLAYGROUND_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			previous := DB
			DB = db
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(5)
			t.Cleanup(func() { DB = previous; require.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%v", upgrade), func(t *testing.T) {
					require.NoError(t, db.Migrator().DropTable(&PlaygroundPreference{}, &PlaygroundUploadChunk{}, &PlaygroundImport{}, &PlaygroundConversation{}, &Option{}))
					// A release upgrade starts with fresh connections, without cached plans
					// for the schema removed by the previous test case.
					sqlDB.SetMaxIdleConns(0)
					sqlDB.SetMaxIdleConns(2)
					if upgrade {
						legacyPreference := struct {
							UserId        int    `gorm:"primaryKey;autoIncrement:false"`
							Model         string `gorm:"size:255;not null"`
							Automatic     bool   `gorm:"not null"`
							Revision      int64  `gorm:"not null"`
							LastOperation string `gorm:"size:64;not null"`
						}{UserId: 903, Model: "gpt-4o", Automatic: true, Revision: 3, LastOperation: "legacy-preference-01"}
						require.NoError(t, db.Table("playground_preferences").AutoMigrate(&legacyPreference))
						require.NoError(t, db.Table("playground_preferences").Create(&legacyPreference).Error)
						require.NoError(t, db.AutoMigrate(&PlaygroundConversation{}, &PlaygroundImport{}))
						_, err := CreatePlaygroundConversation(903, playgroundTestWrite(t, "migration-survivor-01", "existing conversation"))
						require.NoError(t, err)
						require.NoError(t, db.AutoMigrate(&Option{}))
						require.NoError(t, db.Create(&Option{Key: "PlaygroundMigrationSentinel", Value: "unchanged"}).Error)
					}
					for range 2 {
						sqlDB.SetMaxIdleConns(0)
						sqlDB.SetMaxIdleConns(2)
						require.NoError(t, db.AutoMigrate(&PlaygroundPreference{}, &PlaygroundConversation{}, &PlaygroundImport{}, &PlaygroundUploadChunk{}))
					}
					if upgrade {
						preference, err := GetPlaygroundPreference(903)
						require.NoError(t, err)
						assert.Equal(t, "gpt-4o", preference.Model)
						assert.True(t, preference.Automatic)
						assert.EqualValues(t, 3, preference.Revision)
						assert.Empty(t, preference.CompressionGroup)
						var preserved PlaygroundConversation
						require.NoError(t, db.Where("user_id = ?", 903).First(&preserved).Error)
						assert.Contains(t, string(preserved.Content), "existing conversation")
						var option Option
						require.NoError(t, db.Where("value = ?", "unchanged").First(&option).Error)
						assert.Equal(t, "PlaygroundMigrationSentinel", option.Key)
					}
					t.Run("ownership_search_and_retry", testPlaygroundOwnership)
					t.Run("atomic_revision_updates", testPlaygroundConcurrentSave)
					t.Run("legacy_import_and_deletion", testPlaygroundImport)
					t.Run("resumable_verified_upload", testPlaygroundUpload)
					t.Run("compression_preferences_and_document", testPlaygroundCompression)
					t.Run("per_user_limits", testPlaygroundLimits)
					t.Run("metadata_patch", testPlaygroundPatch)
				})
			}
		})
	}
}

func testPlaygroundCompression(t *testing.T) {
	empty, err := GetPlaygroundPreference(110)
	require.NoError(t, err)
	assert.Zero(t, empty.Revision)
	write := PlaygroundPreferenceWrite{PlaygroundCompressionSettings: PlaygroundCompressionSettings{Model: "gpt-4o", Group: "DSS", Automatic: true}, OperationId: "preference-create-01"}
	saved, err := SavePlaygroundPreference(110, write)
	require.NoError(t, err)
	assert.EqualValues(t, 1, saved.Revision)
	assert.Equal(t, "DSS", saved.CompressionGroup)
	repeated, err := SavePlaygroundPreference(110, write)
	require.NoError(t, err)
	assert.Equal(t, saved, repeated)
	changedGroup := write
	changedGroup.Group = "default"
	_, err = SavePlaygroundPreference(110, changedGroup)
	assert.ErrorIs(t, err, ErrPlaygroundConflict)
	other, err := GetPlaygroundPreference(111)
	require.NoError(t, err)
	assert.Empty(t, other.Model)
	write.OperationId = "preference-stale-01"
	_, err = SavePlaygroundPreference(110, write)
	assert.ErrorIs(t, err, ErrPlaygroundConflict)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, name := range []string{"gpt-4o-mini", "deepseek-v3.2"} {
		go func() {
			<-start
			_, e := SavePlaygroundPreference(110, PlaygroundPreferenceWrite{PlaygroundCompressionSettings: PlaygroundCompressionSettings{Model: name}, Revision: 1, OperationId: "preference-race-" + name})
			results <- e
		}()
	}
	close(start)
	err1, err2 := <-results, <-results
	if err1 != nil {
		err1, err2 = err2, err1
	}
	require.NoError(t, err1)
	assert.ErrorIs(t, err2, ErrPlaygroundConflict)
	for _, bad := range []PlaygroundCompressionSettings{{Model: "gpt-image-2.5", Automatic: true}, {Model: "unknown"}, {Automatic: true}} {
		assert.ErrorIs(t, bad.Validate(), ErrPlaygroundSettingsInvalid)
	}
	documentWrite := playgroundTestWrite(t, "compressed-create-01", "original conversation must survive")
	var document map[string]any
	require.NoError(t, common.Unmarshal(documentWrite.Document, &document))
	document["compressionSettings"] = PlaygroundCompressionSettings{Model: "gpt-4o", Group: "DSS", Automatic: true}
	document["contextLimits"] = map[string]int{"gpt-4o": 32000}
	document["compression"] = PlaygroundCompression{Summary: "summary", Boundary: "user-1", SourceHash: strings.Repeat("a", 64), Model: "gpt-4o", CreatedAt: 1}
	documentWrite.Document, err = common.Marshal(document)
	require.NoError(t, err)
	row, err := CreatePlaygroundConversation(110, documentWrite)
	require.NoError(t, err)
	assert.Contains(t, string(row.Document), "original conversation must survive")
	assert.Contains(t, string(row.Document), `"summary":"summary"`)
	assert.Contains(t, string(row.Document), `"group":"DSS"`)
	document["contextLimits"] = map[string]int{"gpt-4o": 128001}
	documentWrite.Document, err = common.Marshal(document)
	require.NoError(t, err)
	assert.ErrorIs(t, documentWrite.Validate(), ErrPlaygroundSettingsInvalid, "a known model stays within its window")

	// A model outside the capability table can carry a learned limit and may
	// have produced the summary itself.
	document["contextLimits"] = map[string]int{"self-hosted-llm": 32768}
	document["compression"] = PlaygroundCompression{Summary: "summary", Boundary: "user-1", SourceHash: strings.Repeat("a", 64), Model: "self-hosted-llm", CreatedAt: 1}
	documentWrite.Document, err = common.Marshal(document)
	require.NoError(t, err)
	assert.NoError(t, documentWrite.Validate())
	for _, limits := range []map[string]int{{"self-hosted-llm": 0}, {"self-hosted-llm": 10_000_001}, {" padded": 4096}} {
		document["contextLimits"] = limits
		documentWrite.Document, err = common.Marshal(document)
		require.NoError(t, err)
		assert.ErrorIs(t, documentWrite.Validate(), ErrPlaygroundSettingsInvalid, limits)
	}
	document["contextLimits"] = map[string]int{}
	document["compression"] = PlaygroundCompression{Summary: "summary", Boundary: "user-1", SourceHash: strings.Repeat("a", 64), Model: " ", CreatedAt: 1}
	documentWrite.Document, err = common.Marshal(document)
	require.NoError(t, err)
	assert.ErrorIs(t, documentWrite.Validate(), ErrPlaygroundSettingsInvalid, "a blank compression model is refused")
}

func TestPlaygroundModelCapabilities(t *testing.T) {
	for _, tc := range []struct {
		names                 []string
		window, input, output int
		warning               bool
	}{
		{[]string{"claude-opus-4-6", "claude-opus-4-6-thinking", "claude-opus-5-5"}, 1000000, 0, 128000, false},
		{[]string{"deepseek-v3.1", "deepseek.v3.1", "DeepSeek-V3.1"}, 128000, 0, 8000, true},
		{[]string{"deepseek-v3.2", "deepseek.v3.2"}, 163840, 0, 8000, true},
		{[]string{"deepseek-v4-pro-preview", "deepseek/deepseek-v4-pro"}, 1000000, 0, 0, false},
		{[]string{"gemini-3.1-pro", "gemini-3.1-pro-preview", "gemini-3.8-flash"}, 0, 1048576, 65536, false},
		{[]string{"gemma-4-31b", "google.gemma-4-31b"}, 256000, 0, 0, false},
		{[]string{"gpt-4o", "gpt-4o-mini"}, 128000, 0, 16384, false},
		{[]string{"grok-4.3", "xai.grok-4.3"}, 1000000, 0, 0, false},
		{[]string{"grok-4.6", "xai.grok-4.6"}, 500000, 0, 0, false},
		{[]string{"gpt-image-2.5", "grok-imagine-image-2.0", "unknown", "deepseek-r1", "custom-gpt-4o"}, 0, 0, 0, false},
	} {
		for _, name := range tc.names {
			t.Run(name, func(t *testing.T) {
				assert.Equal(t, PlaygroundModelCapability{Model: name, ContextWindow: tc.window, InputLimit: tc.input, OutputLimit: tc.output, TextGeneration: tc.window > 0 || tc.input > 0, CompressionWarning: tc.warning}, GetPlaygroundModelCapability(name))
			})
		}
	}
}

func playgroundTestWrite(t *testing.T, operation, content string) PlaygroundWrite {
	t.Helper()
	doc := map[string]any{
		"messages":         []any{map[string]any{"key": "user-1", "from": "user", "versions": []any{map[string]any{"id": "v1", "content": content}}}},
		"config":           map[string]any{"model": "test-model", "group": "default", "stream": true},
		"parameterEnabled": map[string]bool{"temperature": true}, "draft": "draft",
	}
	raw, err := common.Marshal(doc)
	require.NoError(t, err)
	return PlaygroundWrite{OperationId: operation, Document: raw, Title: operation}
}

func testPlaygroundOwnership(t *testing.T) {
	write := playgroundTestWrite(t, "ownership-create-1", strings.Repeat("保留所有正文", 16000))
	write.Title = "100%_match"
	originalCreate := write
	row, err := CreatePlaygroundConversation(7, write)
	require.NoError(t, err)
	assert.Equal(t, int64(1), row.Revision)
	repeated, err := CreatePlaygroundConversation(7, write)
	require.NoError(t, err)
	assert.Equal(t, row.Id, repeated.Id)
	_, err = GetPlaygroundConversation(8, row.Id)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	write.Revision = 1
	write.OperationId = "ownership-save-01"
	_, err = SavePlaygroundConversation(8, row.Id, write)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.ErrorIs(t, DeletePlaygroundConversation(8, row.Id), gorm.ErrRecordNotFound)
	saved, err := SavePlaygroundConversation(7, row.Id, write)
	require.NoError(t, err)
	assert.JSONEq(t, string(write.Document), string(saved.Document))
	replay, err := SavePlaygroundConversation(7, row.Id, write)
	require.NoError(t, err)
	assert.Equal(t, saved.Revision, replay.Revision)
	_, err = CreatePlaygroundConversation(7, originalCreate)
	require.ErrorIs(t, err, ErrPlaygroundConflict)
	write.Title = "changed using the same operation"
	_, err = SavePlaygroundConversation(7, row.Id, write)
	require.ErrorIs(t, err, ErrPlaygroundConflict)
	page := &common.PageInfo{Page: 1, PageSize: 1}
	items, count, err := ListPlaygroundConversations(7, "%_", page)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)
	require.Len(t, items, 1)
	assert.Equal(t, row.Id, items[0].Id)
	_, _, err = ListPlaygroundConversations(7, strings.Repeat("k", 201), page)
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	items, _, err = ListPlaygroundConversations(7, "", &common.PageInfo{Page: -3, PageSize: -1})
	require.NoError(t, err, "a negative page size is clamped instead of removing the limit")
	require.Len(t, items, 1)
	for name, document := range map[string]string{
		"unknown config key":       `{"messages":[],"config":{"model":"m","other":1},"parameterEnabled":{},"draft":""}`,
		"stream is not a boolean":  `{"messages":[],"config":{"stream":"yes"},"parameterEnabled":{},"draft":""}`,
		"selected version missing": `{"messages":[{"key":"a","from":"user","selectedVersionId":"missing","versions":[{"id":"v","content":"x"}]}],"config":{},"parameterEnabled":{},"draft":""}`,
		"duplicate message key":    `{"messages":[{"key":"a","from":"user","versions":[{"id":"v","content":"x"}]},{"key":"a","from":"assistant","versions":[{"id":"v","content":"y"}]}],"config":{},"parameterEnabled":{},"draft":""}`,
	} {
		_, err = CreatePlaygroundConversation(7, PlaygroundWrite{OperationId: "invalid-" + strings.ReplaceAll(name, " ", "-"), Title: name, Document: json.RawMessage(document)})
		assert.ErrorIs(t, err, ErrPlaygroundInvalid, name)
	}
	_, count, err = ListPlaygroundConversations(8, "", page)
	require.NoError(t, err)
	assert.Zero(t, count)
	require.NoError(t, DeletePlaygroundConversation(7, row.Id))
	_, err = SavePlaygroundConversation(7, row.Id, write)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	write.OperationId = "ownership-create-1"
	_, err = CreatePlaygroundConversation(7, write)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	var tombstone PlaygroundConversation
	require.NoError(t, DB.Unscoped().First(&tombstone, row.Id).Error)
	assert.Equal(t, LongText("{}"), tombstone.Content)
}

func testPlaygroundConcurrentSave(t *testing.T) {
	row, err := CreatePlaygroundConversation(10, playgroundTestWrite(t, "concurrency-create", "original"))
	require.NoError(t, err)
	start := make(chan struct{})
	failures := make(chan error, 2)
	var wg sync.WaitGroup
	for i := range 2 {
		write := playgroundTestWrite(t, fmt.Sprintf("concurrency-save-%d", i), fmt.Sprintf("reply %d", i))
		write.Revision = row.Revision
		wg.Go(func() { <-start; _, failure := SavePlaygroundConversation(10, row.Id, write); failures <- failure })
	}
	close(start)
	wg.Wait()
	close(failures)
	succeeded, conflicted := 0, 0
	for failure := range failures {
		if failure == nil {
			succeeded++
		} else if errors.Is(failure, ErrPlaygroundConflict) {
			conflicted++
		} else {
			require.NoError(t, failure)
		}
	}
	assert.Equal(t, 1, succeeded)
	assert.Equal(t, 1, conflicted)
	saved, err := GetPlaygroundConversation(10, row.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(2), saved.Revision)

	// A save that landed is a success even when another writer lands right
	// after it: the answer comes from the update itself, not from a re-read.
	interleaved := false
	require.NoError(t, DB.Callback().Update().After("gorm:update").Register("playground:interleave", func(tx *gorm.DB) {
		if interleaved || tx.Statement.Table != "playground_conversations" || tx.Error != nil || tx.RowsAffected != 1 {
			return
		}
		interleaved = true
		later := playgroundTestWrite(t, "concurrency-later", "later writer")
		later.Revision = 3
		_, err := SavePlaygroundConversation(10, row.Id, later)
		require.NoError(t, err)
	}))
	t.Cleanup(func() { DB.Callback().Update().Remove("playground:interleave") })
	first := playgroundTestWrite(t, "concurrency-first", "first writer")
	first.Revision = 2
	result, err := SavePlaygroundConversation(10, row.Id, first)
	require.NoError(t, err)
	assert.True(t, interleaved)
	assert.Equal(t, int64(3), result.Revision)
	assert.JSONEq(t, string(first.Document), string(result.Document), "the writer keeps the document it sent")
	latest, err := GetPlaygroundConversation(10, row.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(4), latest.Revision)
	assert.Contains(t, string(latest.Document), "later writer")
}

func testPlaygroundLimits(t *testing.T) {
	previousConversations, previousUploads := PlaygroundMaxConversationsPerUser, PlaygroundMaxUploadsPerUser
	PlaygroundMaxConversationsPerUser, PlaygroundMaxUploadsPerUser = 2, 1
	t.Cleanup(func() {
		PlaygroundMaxConversationsPerUser, PlaygroundMaxUploadsPerUser = previousConversations, previousUploads
	})
	first, err := CreatePlaygroundConversation(30, playgroundTestWrite(t, "limit-create-0001", "one"))
	require.NoError(t, err)
	_, err = CreatePlaygroundConversation(30, playgroundTestWrite(t, "limit-create-0002", "two"))
	require.NoError(t, err)
	_, err = CreatePlaygroundConversation(30, playgroundTestWrite(t, "limit-create-0003", "three"))
	require.ErrorIs(t, err, ErrPlaygroundLimit)
	messages := `[{"key":"limit-import","from":"user","versions":[{"id":"v1","content":"imported"}]}]`
	_, err = ImportPlaygroundConversation(30, PlaygroundLegacySource{Messages: &messages})
	require.ErrorIs(t, err, ErrPlaygroundLimit, "imports count against the same limit")
	_, err = CreatePlaygroundConversation(31, playgroundTestWrite(t, "limit-create-other", "other user"))
	require.NoError(t, err, "the limit is per user")
	require.NoError(t, DeletePlaygroundConversation(30, first.Id))
	_, err = CreatePlaygroundConversation(30, playgroundTestWrite(t, "limit-create-0004", "after delete"))
	require.NoError(t, err, "deleted conversations do not count")

	raw := []byte(`{"messages":"[]"}`)
	chunk := base64.StdEncoding.EncodeToString(raw)
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	require.NoError(t, SavePlaygroundUploadChunk(30, strings.Repeat("a", 64), len(raw), 0, hash, chunk))
	require.NoError(t, SavePlaygroundUploadChunk(30, strings.Repeat("a", 64), len(raw), 0, hash, chunk), "the same upload may be resumed")
	require.ErrorIs(t, SavePlaygroundUploadChunk(30, strings.Repeat("b", 64), len(raw), 0, hash, chunk), ErrPlaygroundLimit, "a second upload in flight is refused")
	require.NoError(t, SavePlaygroundUploadChunk(31, strings.Repeat("b", 64), len(raw), 0, hash, chunk), "another user has their own allowance")
}

func testPlaygroundPatch(t *testing.T) {
	row, err := CreatePlaygroundConversation(40, playgroundTestWrite(t, "patch-create-0001", "patched body"))
	require.NoError(t, err)
	patch := PlaygroundPatch{OperationId: "patch-draft-0001", Revision: row.Revision, Patch: map[string]json.RawMessage{"draft": json.RawMessage(`"typed later"`)}}
	patched, err := PatchPlaygroundConversation(40, row.Id, patch)
	require.NoError(t, err)
	assert.Equal(t, row.Revision+1, patched.Revision)
	assert.Equal(t, row.Title, patched.Title)
	var document PlaygroundDocument
	require.NoError(t, common.Unmarshal(patched.Document, &document))
	assert.Equal(t, "typed later", document.Draft)
	require.Len(t, document.Messages, 1)
	assert.Contains(t, string(document.Messages[0]), "patched body")
	assert.Equal(t, "test-model", document.Config["model"])

	replay, err := PatchPlaygroundConversation(40, row.Id, patch)
	require.NoError(t, err)
	assert.Equal(t, patched.Revision, replay.Revision, "the same operation is applied once")
	_, err = PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-stale-0001", Revision: row.Revision, Patch: map[string]json.RawMessage{"draft": json.RawMessage(`"stale"`)}})
	require.ErrorIs(t, err, ErrPlaygroundConflict)
	_, err = PatchPlaygroundConversation(41, row.Id, PlaygroundPatch{OperationId: "patch-other-user", Revision: patched.Revision, Patch: map[string]json.RawMessage{"draft": json.RawMessage(`"mine"`)}})
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	for name, invalid := range map[string]map[string]json.RawMessage{
		"messages":       {"messages": json.RawMessage(`[]`)},
		"unknown key":    {"title": json.RawMessage(`"x"`)},
		"invalid config": {"config": json.RawMessage(`{"model":"m","unknown":1}`)},
		"empty":          {},
	} {
		_, err = PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-invalid-" + name, Revision: patched.Revision, Patch: invalid})
		assert.ErrorIs(t, err, ErrPlaygroundInvalid, name)
	}
	_, err = PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-invalid-compression", Revision: patched.Revision, Patch: map[string]json.RawMessage{"compressionAttempt": json.RawMessage(`"maybe"`)}})
	assert.ErrorIs(t, err, ErrPlaygroundSettingsInvalid, "the merged document goes through the same compression validation")
	oversized := PlaygroundPatch{OperationId: "patch-oversized-01", Revision: patched.Revision, Patch: map[string]json.RawMessage{"draft": json.RawMessage(`"` + strings.Repeat("x", PlaygroundDocumentLimit) + `"`)}}
	_, err = PatchPlaygroundConversation(40, row.Id, oversized)
	require.ErrorIs(t, err, ErrPlaygroundTooLarge)
	title := "renamed by patch"
	renamed, err := PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-title-0001", Revision: patched.Revision, Title: &title, Patch: map[string]json.RawMessage{"contextLimits": json.RawMessage(`{"test-model":4096}`), "draft": json.RawMessage(`null`)}})
	require.NoError(t, err)
	assert.Equal(t, "renamed by patch", renamed.Title)
	var renamedDocument PlaygroundDocument
	require.NoError(t, common.Unmarshal(renamed.Document, &renamedDocument))
	assert.Equal(t, map[string]int{"test-model": 4096}, renamedDocument.ContextLimits)
	assert.Empty(t, renamedDocument.Draft, "a null value removes the key")
	assert.Contains(t, string(renamedDocument.Messages[0]), "patched body")

	// Messages change by keeping the stored prefix and replacing the rest, so a
	// turn uploads only what it added and the other fields stay as stored.
	message := func(key, content string) json.RawMessage {
		return json.RawMessage(`{"key":"` + key + `","from":"assistant","status":"complete","versions":[{"id":"` + key + `-v","content":"` + content + `"}]}`)
	}
	stored := func(id int64) PlaygroundDocument {
		detail, err := GetPlaygroundConversation(40, id)
		require.NoError(t, err)
		var document PlaygroundDocument
		require.NoError(t, common.Unmarshal(detail.Document, &document))
		return document
	}
	keys := func(document PlaygroundDocument) []string {
		result := make([]string, 0, len(document.Messages))
		for _, raw := range document.Messages {
			var item struct {
				Key string `json:"key"`
			}
			require.NoError(t, common.Unmarshal(raw, &item))
			result = append(result, item.Key)
		}
		return result
	}
	appendPatch := PlaygroundPatch{OperationId: "patch-append-0001", Revision: renamed.Revision, Messages: &PlaygroundMessagesPatch{Keep: 1, Append: []json.RawMessage{message("reply-1", "thinking")}}}
	appended, err := PatchPlaygroundConversation(40, row.Id, appendPatch)
	require.NoError(t, err)
	assert.Equal(t, renamed.Revision+1, appended.Revision)
	assert.Equal(t, "renamed by patch", appended.Title)
	document = stored(row.Id)
	assert.Equal(t, []string{"user-1", "reply-1"}, keys(document))
	assert.Contains(t, string(document.Messages[0]), "patched body", "the kept prefix is the stored message")
	assert.Equal(t, map[string]int{"test-model": 4096}, document.ContextLimits)
	assert.Equal(t, "test-model", document.Config["model"])

	replayed, err := PatchPlaygroundConversation(40, row.Id, appendPatch)
	require.NoError(t, err)
	assert.Equal(t, appended.Revision, replayed.Revision, "a replayed message patch is applied once")
	assert.Equal(t, []string{"user-1", "reply-1"}, keys(stored(row.Id)))

	completed, err := PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-complete-01", Revision: appended.Revision, Messages: &PlaygroundMessagesPatch{Keep: 1, Append: []json.RawMessage{message("reply-1", "final answer")}}})
	require.NoError(t, err)
	document = stored(row.Id)
	assert.Equal(t, []string{"user-1", "reply-1"}, keys(document))
	assert.Contains(t, string(document.Messages[1]), "final answer", "the tail after the kept prefix is replaced")

	replacedAll, err := PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-replace-all", Revision: completed.Revision, Messages: &PlaygroundMessagesPatch{Keep: 0, Append: []json.RawMessage{message("edited-1", "edited")}}})
	require.NoError(t, err)
	assert.Equal(t, []string{"edited-1"}, keys(stored(row.Id)))

	for name, invalid := range map[string]*PlaygroundMessagesPatch{
		"keep beyond the stored messages": {Keep: 2, Append: []json.RawMessage{}},
		"negative keep":                   {Keep: -1, Append: []json.RawMessage{}},
		"missing append":                  {Keep: 1},
		"duplicate key across the prefix": {Keep: 1, Append: []json.RawMessage{message("edited-1", "again")}},
		"malformed message":               {Keep: 0, Append: []json.RawMessage{json.RawMessage(`{"key":"x"}`)}},
	} {
		_, err = PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-bad-" + strings.ReplaceAll(name, " ", "-"), Revision: replacedAll.Revision, Messages: invalid})
		assert.ErrorIs(t, err, ErrPlaygroundInvalid, name)
	}
	_, err = PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-big-messages", Revision: replacedAll.Revision, Messages: &PlaygroundMessagesPatch{Keep: 1, Append: []json.RawMessage{message("huge", strings.Repeat("x", PlaygroundDocumentLimit))}}})
	require.ErrorIs(t, err, ErrPlaygroundTooLarge)
	_, err = PatchPlaygroundConversation(40, row.Id, PlaygroundPatch{OperationId: "patch-stale-messages", Revision: completed.Revision, Messages: &PlaygroundMessagesPatch{Keep: 1, Append: []json.RawMessage{}}})
	require.ErrorIs(t, err, ErrPlaygroundConflict, "a message patch against an older revision is a conflict")
	assert.Equal(t, []string{"edited-1"}, keys(stored(row.Id)))
}

func testPlaygroundImport(t *testing.T) {
	messages := make([]any, 105)
	for i := range messages {
		messages[i] = map[string]any{"key": fmt.Sprint(i), "from": "assistant", "status": "streaming", "versions": []any{map[string]any{"id": "v1", "content": strings.Repeat("a", 501)}}}
	}
	raw, err := common.Marshal(map[string]any{"version": 1, "data": messages})
	require.NoError(t, err)
	messageText := string(raw)
	config := "{\"model\":\"changed-model\"}"
	source := PlaygroundLegacySource{Messages: &messageText, Config: &config}
	start := make(chan struct{})
	ids := make(chan int64, 2)
	failures := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			<-start
			result, failure := ImportPlaygroundConversation(20, source)
			failures <- failure
			if failure == nil {
				ids <- result.ConversationId
			}
		})
	}
	close(start)
	wg.Wait()
	close(ids)
	close(failures)
	for failure := range failures {
		require.NoError(t, failure)
	}
	var id int64
	for value := range ids {
		if id != 0 {
			assert.Equal(t, id, value)
		}
		id = value
	}
	row, err := GetPlaygroundConversation(20, id)
	require.NoError(t, err)
	var doc PlaygroundDocument
	require.NoError(t, common.Unmarshal(row.Document, &doc))
	assert.Len(t, doc.Messages, 105)
	assert.Equal(t, "changed-model", doc.Config["model"])
	require.NoError(t, DeletePlaygroundConversation(20, id))
	result, err := ImportPlaygroundConversation(20, source)
	require.NoError(t, err)
	assert.True(t, result.Deleted)
	assert.Equal(t, id, result.ConversationId)
	other, err := ImportPlaygroundConversation(21, source)
	require.NoError(t, err)
	assert.NotEqual(t, id, other.ConversationId)
	broken := "{broken"
	_, err = ImportPlaygroundConversation(22, PlaygroundLegacySource{Messages: &broken})
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	var count int64
	require.NoError(t, DB.Model(&PlaygroundImport{}).Where("user_id = ?", 22).Count(&count).Error)
	assert.Zero(t, count)
	// Force the second write of the import transaction to fail; the receipt must roll back.
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register("playground_import_failure", func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PlaygroundConversation" {
			tx.AddError(errors.New("forced rollback"))
		}
	}))
	_, err = ImportPlaygroundConversation(23, source)
	require.Error(t, err)
	require.NoError(t, DB.Callback().Create().Remove("playground_import_failure"))
	require.NoError(t, DB.Model(&PlaygroundImport{}).Where("user_id = ?", 23).Count(&count).Error)
	assert.Zero(t, count)
}

func testPlaygroundUpload(t *testing.T) {
	messages := `[ {"key":"upload-message","from":"user","versions":[{"id":"v1","content":"` + strings.Repeat("中", 120000) + `"}]} ]`
	source := PlaygroundLegacySource{Messages: &messages}
	raw, err := common.Marshal(source)
	require.NoError(t, err)
	digest := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(digest[:])
	size := len(raw)
	status, err := GetPlaygroundUpload(601, fingerprint, size)
	require.NoError(t, err)
	assert.Empty(t, status.Chunks)
	_, err = CompletePlaygroundUpload(601, fingerprint, size)
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	for index := range (size + PlaygroundChunkSize - 1) / PlaygroundChunkSize {
		data := raw[index*PlaygroundChunkSize : min((index+1)*PlaygroundChunkSize, size)]
		digest := sha256.Sum256(data)
		hash := hex.EncodeToString(digest[:])
		encoded := base64.StdEncoding.EncodeToString(data)
		require.ErrorIs(t, SavePlaygroundUploadChunk(601, fingerprint, size, index, strings.Repeat("0", 64), encoded), ErrPlaygroundInvalid)
		require.NoError(t, SavePlaygroundUploadChunk(601, fingerprint, size, index, hash, encoded))
		require.NoError(t, SavePlaygroundUploadChunk(601, strings.Repeat("0", 64), size, index, hash, encoded))
		errors := make(chan error, 3)
		var group sync.WaitGroup
		for range 3 {
			group.Go(func() { errors <- SavePlaygroundUploadChunk(601, fingerprint, size, index, hash, encoded) })
		}
		group.Wait()
		close(errors)
		for err := range errors {
			require.NoError(t, err)
		}
		status, err = GetPlaygroundUpload(601, fingerprint, size)
		require.NoError(t, err)
		assert.Len(t, status.Chunks, index+1)
	}
	other, err := GetPlaygroundUpload(602, fingerprint, size)
	require.NoError(t, err)
	assert.Empty(t, other.Chunks)
	_, err = CompletePlaygroundUpload(602, fingerprint, size)
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	// Every chunk arrived under the wrong fingerprint, so the whole upload is
	// unusable and is dropped rather than left for the next attempt to hit again.
	_, err = CompletePlaygroundUpload(601, strings.Repeat("0", 64), size)
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	mismatched, err := GetPlaygroundUpload(601, strings.Repeat("0", 64), size)
	require.NoError(t, err)
	assert.Empty(t, mismatched.Chunks)
	_, err = GetPlaygroundUpload(601, fingerprint, size+1)
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	result, err := CompletePlaygroundUpload(601, fingerprint, size)
	require.NoError(t, err)
	again, err := CompletePlaygroundUpload(601, fingerprint, size)
	require.NoError(t, err)
	assert.Equal(t, result.ConversationId, again.ConversationId)
	row, err := GetPlaygroundConversation(601, result.ConversationId)
	require.NoError(t, err)
	assert.Contains(t, string(row.Document), strings.Repeat("中", 120000))
	status, err = GetPlaygroundUpload(601, fingerprint, size)
	require.NoError(t, err)
	assert.Empty(t, status.Chunks)
	require.NoError(t, DeletePlaygroundConversation(601, result.ConversationId))
	again, err = CompletePlaygroundUpload(601, fingerprint, size)
	require.NoError(t, err)
	assert.True(t, again.Deleted)

	// A completed upload whose content the server rejects is discarded so the
	// next attempt starts clean instead of replaying the same failure forever.
	broken := "{not json"
	brokenRaw, err := common.Marshal(PlaygroundLegacySource{Messages: &broken})
	require.NoError(t, err)
	brokenDigest := sha256.Sum256(brokenRaw)
	brokenFingerprint := hex.EncodeToString(brokenDigest[:])
	brokenChunk := sha256.Sum256(brokenRaw)
	require.NoError(t, SavePlaygroundUploadChunk(601, brokenFingerprint, len(brokenRaw), 0, hex.EncodeToString(brokenChunk[:]), base64.StdEncoding.EncodeToString(brokenRaw)))
	_, err = CompletePlaygroundUpload(601, brokenFingerprint, len(brokenRaw))
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
	status, err = GetPlaygroundUpload(601, brokenFingerprint, len(brokenRaw))
	require.NoError(t, err)
	assert.Empty(t, status.Chunks, "rejected chunks must not survive completion")

	// Chunks and receipts older than the retention period are purged for every
	// user, whether or not that user ever asks about the upload again.
	stale := strings.Repeat("c", 64)
	fresh := strings.Repeat("d", 64)
	data := []byte(`{"messages":"[]"}`)
	chunkDigest := sha256.Sum256(data)
	require.NoError(t, SavePlaygroundUploadChunk(603, stale, len(data), 0, hex.EncodeToString(chunkDigest[:]), base64.StdEncoding.EncodeToString(data)))
	require.NoError(t, SavePlaygroundUploadChunk(603, fresh, len(data), 0, hex.EncodeToString(chunkDigest[:]), base64.StdEncoding.EncodeToString(data)))
	require.NoError(t, DB.Model(&PlaygroundUploadChunk{}).Where("user_id = ? AND fingerprint = ?", 603, stale).Update("create_time", time.Now().Add(-8*24*time.Hour).Unix()).Error)
	require.NoError(t, DB.Model(&PlaygroundUploadChunk{}).Where("user_id = ? AND fingerprint = ? AND chunk_index = -1", 601, fingerprint).Update("create_time", time.Now().Add(-8*24*time.Hour).Unix()).Error)
	purged, err := PurgeExpiredPlaygroundUploads(time.Now().Add(-7 * 24 * time.Hour).Unix())
	require.NoError(t, err)
	assert.EqualValues(t, 2, purged)
	var remaining int64
	require.NoError(t, DB.Model(&PlaygroundUploadChunk{}).Where("fingerprint IN ?", []string{stale, fingerprint}).Count(&remaining).Error)
	assert.Zero(t, remaining)
	require.NoError(t, DB.Model(&PlaygroundUploadChunk{}).Where("user_id = ? AND fingerprint = ?", 603, fresh).Count(&remaining).Error)
	assert.NotZero(t, remaining, "an upload still within the retention period stays resumable")
}
