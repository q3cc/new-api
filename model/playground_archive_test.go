package model

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// testPlaygroundArchive runs inside TestPlaygroundDatabaseMatrix, against
// each database, after the other playground cases.
func testPlaygroundArchive(t *testing.T) {
	const owner = 140
	old := time.Now().Add(-PlaygroundArchiveAfter - time.Hour).UnixMilli()
	text := strings.Repeat("压缩前的会话正文 archived conversation text ", 400)
	create := func(operation string) *PlaygroundConversationDetail {
		t.Helper()
		row, err := CreatePlaygroundConversation(owner, playgroundTestWrite(t, operation, text))
		require.NoError(t, err)
		return row
	}
	makeCold := func(id int64) {
		t.Helper()
		require.NoError(t, DB.Model(&PlaygroundConversation{}).Where("id = ?", id).
			Updates(map[string]any{"update_time": old, "open_time": 0}).Error)
	}
	stored := func(id int64) PlaygroundConversation {
		t.Helper()
		var row PlaygroundConversation
		require.NoError(t, DB.Unscoped().Where("id = ?", id).First(&row).Error)
		return row
	}
	archiveAll := func() int {
		t.Helper()
		archived, err := ArchiveColdPlaygroundConversations(time.Now(), 1000)
		require.NoError(t, err)
		return archived
	}

	cold := create("archive-cold-00001")
	makeCold(cold.Id)
	openedRecently := create("archive-opened-0001")
	require.NoError(t, DB.Model(&PlaygroundConversation{}).Where("id = ?", openedRecently.Id).
		Updates(map[string]any{"update_time": old, "open_time": time.Now().Add(-24 * time.Hour).UnixMilli()}).Error)
	changedRecently := create("archive-changed-0001")
	deleted := create("archive-deleted-0001")
	makeCold(deleted.Id)
	require.NoError(t, DeletePlaygroundConversation(owner, deleted.Id))

	t.Run("only conversations neither opened nor changed for the period are archived", func(t *testing.T) {
		assert.Equal(t, 1, archiveAll())
		row := stored(cold.Id)
		assert.NotZero(t, row.ArchivedAt)
		assert.Empty(t, string(row.Content))
		assert.EqualValues(t, len(cold.Document), row.ContentBytes)
		assert.Less(t, len(row.ArchivedContent), len(cold.Document)/4, "the document is stored compressed")
		assert.Equal(t, cold.Revision, row.Revision)
		assert.Equal(t, old, row.UpdateTime, "archiving does not reorder the list")
		for _, id := range []int64{openedRecently.Id, changedRecently.Id, deleted.Id} {
			other := stored(id)
			assert.Zero(t, other.ArchivedAt, id)
			assert.Nil(t, other.ArchivedContent, id)
		}
		assert.Zero(t, archiveAll(), "an archived conversation is not archived again")

		rows, total, err := ListPlaygroundConversations(owner, "archive-cold", &common.PageInfo{Page: 1, PageSize: 10})
		require.NoError(t, err)
		require.EqualValues(t, 1, total)
		assert.NotZero(t, rows[0].ArchivedAt)
		assert.EqualValues(t, len(cold.Document), rows[0].ContentBytes)
	})

	t.Run("opening restores the document unchanged and records the opening", func(t *testing.T) {
		before := time.Now().UnixMilli()
		opened, err := GetPlaygroundConversation(owner, cold.Id)
		require.NoError(t, err)
		assert.Equal(t, string(cold.Document), string(opened.Document))
		assert.Zero(t, opened.ArchivedAt)
		assert.Equal(t, cold.Revision, opened.Revision)
		row := stored(cold.Id)
		assert.Equal(t, string(cold.Document), string(row.Content))
		assert.Zero(t, row.ArchivedAt)
		assert.Nil(t, row.ArchivedContent)
		assert.Equal(t, cold.Revision, row.Revision)
		assert.Equal(t, old, row.UpdateTime)
		assert.GreaterOrEqual(t, row.OpenTime, before)
		assert.Zero(t, archiveAll(), "a conversation just opened stays uncompressed")
	})

	t.Run("an opening is recorded at most hourly", func(t *testing.T) {
		recent := time.Now().Add(-30 * time.Minute).UnixMilli()
		require.NoError(t, DB.Model(&PlaygroundConversation{}).Where("id = ?", changedRecently.Id).Update("open_time", recent).Error)
		_, err := GetPlaygroundConversation(owner, changedRecently.Id)
		require.NoError(t, err)
		assert.Equal(t, recent, stored(changedRecently.Id).OpenTime)
		earlier := time.Now().Add(-2 * time.Hour).UnixMilli()
		require.NoError(t, DB.Model(&PlaygroundConversation{}).Where("id = ?", changedRecently.Id).Update("open_time", earlier).Error)
		_, err = GetPlaygroundConversation(owner, changedRecently.Id)
		require.NoError(t, err)
		assert.Greater(t, stored(changedRecently.Id).OpenTime, earlier)
	})

	t.Run("writes to an archived conversation store it uncompressed", func(t *testing.T) {
		patched := create("archive-patch-00001")
		saved := create("archive-save-000001")
		removed := create("archive-delete-0001")
		for _, row := range []*PlaygroundConversationDetail{patched, saved, removed} {
			makeCold(row.Id)
		}
		assert.Equal(t, 3, archiveAll())

		draft := `"patched draft"`
		result, err := PatchPlaygroundConversation(owner, patched.Id, PlaygroundPatch{OperationId: "archive-patch-00002", Revision: patched.Revision, Patch: map[string]json.RawMessage{"draft": json.RawMessage(draft)}})
		require.NoError(t, err)
		assert.Contains(t, string(result.Document), "patched draft")
		assert.Contains(t, string(result.Document), "archived conversation text")
		row := stored(patched.Id)
		assert.Zero(t, row.ArchivedAt)
		assert.Nil(t, row.ArchivedContent)
		assert.Equal(t, string(result.Document), string(row.Content))
		assert.EqualValues(t, len(result.Document), row.ContentBytes)

		write := playgroundTestWrite(t, "archive-save-000002", "replaced text")
		write.Revision = saved.Revision
		_, err = SavePlaygroundConversation(owner, saved.Id, write)
		require.NoError(t, err)
		row = stored(saved.Id)
		assert.Zero(t, row.ArchivedAt)
		assert.Nil(t, row.ArchivedContent)
		assert.Equal(t, string(write.Document), string(row.Content))
		assert.EqualValues(t, len(write.Document), row.ContentBytes)

		require.NoError(t, DeletePlaygroundConversation(owner, removed.Id))
		row = stored(removed.Id)
		assert.True(t, row.DeletedAt.Valid)
		assert.Nil(t, row.ArchivedContent, "a deleted conversation keeps no copy of its messages")
		assert.Equal(t, "{}", string(row.Content))
	})

	t.Run("a conversation saved while it is being archived stays uncompressed", func(t *testing.T) {
		raced := create("archive-race-000001")
		makeCold(raced.Id)
		var snapshot PlaygroundConversation
		require.NoError(t, DB.Select("id", "revision", "content").Where("id = ?", raced.Id).Take(&snapshot).Error)
		write := playgroundTestWrite(t, "archive-race-000002", "saved meanwhile")
		write.Revision = raced.Revision
		_, err := SavePlaygroundConversation(owner, raced.Id, write)
		require.NoError(t, err)
		done, err := archivePlaygroundConversation(snapshot, time.Now().Add(-PlaygroundArchiveAfter).UnixMilli(), time.Now().UnixMilli())
		require.NoError(t, err)
		assert.False(t, done)
		row := stored(raced.Id)
		assert.Zero(t, row.ArchivedAt)
		assert.Equal(t, string(write.Document), string(row.Content))
	})

	t.Run("a round examines at most its limit", func(t *testing.T) {
		for _, operation := range []string{"archive-limit-00001", "archive-limit-00002", "archive-limit-00003"} {
			makeCold(create(operation).Id)
		}
		archived, err := ArchiveColdPlaygroundConversations(time.Now(), 2)
		require.NoError(t, err)
		assert.Equal(t, 2, archived)
		assert.Equal(t, 1, archiveAll())
	})

	t.Run("a document that would not restore is left uncompressed", func(t *testing.T) {
		broken := create("archive-broken-0001")
		makeCold(broken.Id)
		require.NoError(t, DB.Model(&PlaygroundConversation{}).Where("id = ?", broken.Id).Update("content", "not json").Error)
		assert.Zero(t, archiveAll())
		row := stored(broken.Id)
		assert.Zero(t, row.ArchivedAt)
		assert.Equal(t, "not json", string(row.Content))
		require.NoError(t, DeletePlaygroundConversation(owner, broken.Id))
	})

	t.Run("a damaged archive is reported instead of returned", func(t *testing.T) {
		damaged := create("archive-damage-0001")
		require.NoError(t, DB.Model(&PlaygroundConversation{}).Where("id = ?", damaged.Id).
			Updates(map[string]any{"content": "", "archived_at": time.Now().UnixMilli(), "archived_content": LongBlob("not zstd")}).Error)
		_, err := GetPlaygroundConversation(owner, damaged.Id)
		assert.ErrorIs(t, err, ErrPlaygroundDamaged)
		_, err = GetPlaygroundConversation(owner+1, damaged.Id)
		assert.ErrorIs(t, err, gorm.ErrRecordNotFound, "ownership is checked first")
	})
}
