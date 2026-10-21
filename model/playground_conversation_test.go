package model

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

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
	_, err = CompletePlaygroundUpload(601, strings.Repeat("0", 64), size)
	require.ErrorIs(t, err, ErrPlaygroundInvalid)
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
}
