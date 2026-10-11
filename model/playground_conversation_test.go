package model

import (
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
					require.NoError(t, db.Migrator().DropTable(&PlaygroundImport{}, &PlaygroundConversation{}, &Option{}))
					if upgrade {
						require.NoError(t, db.AutoMigrate(&Option{}))
						require.NoError(t, db.Create(&Option{Key: "PlaygroundMigrationSentinel", Value: "unchanged"}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(&PlaygroundConversation{}, &PlaygroundImport{}))
					}
					if upgrade {
						var option Option
						require.NoError(t, db.Where("value = ?", "unchanged").First(&option).Error)
						assert.Equal(t, "PlaygroundMigrationSentinel", option.Key)
					}
					t.Run("ownership_search_and_retry", testPlaygroundOwnership)
					t.Run("atomic_revision_updates", testPlaygroundConcurrentSave)
					t.Run("legacy_import_and_deletion", testPlaygroundImport)
				})
			}
		})
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
