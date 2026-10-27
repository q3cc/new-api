package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// The models a group can use are read on every playground request. They come
// from a short-lived cache that any change to abilities clears.
func TestGroupEnabledModelsAreCachedUntilAbilitiesChange(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Ability{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&Ability{}).Error)
	InvalidateGroupEnabledModelsCache()
	queries := 0
	require.NoError(t, DB.Callback().Query().Before("gorm:query").Register("abilities:count", func(tx *gorm.DB) {
		if tx.Statement.Table == "abilities" {
			queries++
		}
	}))
	t.Cleanup(func() {
		DB.Callback().Query().Remove("abilities:count")
		InvalidateGroupEnabledModelsCache()
	})
	channel := &Channel{Id: 9001, Group: "cached", Models: "model-a", Status: 1}
	require.NoError(t, channel.AddAbilities(nil))

	assert.Equal(t, []string{"model-a"}, GetGroupEnabledModels("cached"))
	assert.Equal(t, []string{"model-a"}, GetGroupEnabledModels("cached"))
	assert.Equal(t, 1, queries, "a repeated read within the TTL does not query")

	require.NoError(t, UpdateAbilityStatus(9001, false))
	assert.Empty(t, GetGroupEnabledModels("cached"), "a status change is visible at once")
	channel.Models = "model-a,model-b"
	channel.Status = 1
	require.NoError(t, channel.UpdateAbilities(nil))
	assert.ElementsMatch(t, []string{"model-a", "model-b"}, GetGroupEnabledModels("cached"))
	models := GetGroupEnabledModels("cached")
	models[0] = "mutated"
	assert.NotContains(t, GetGroupEnabledModels("cached"), "mutated", "callers get their own copy")
}
