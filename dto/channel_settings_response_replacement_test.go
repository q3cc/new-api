package dto

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelSettingsValidateResponseTextReplacements(t *testing.T) {
	t.Run("accepts valid scoped rules", func(t *testing.T) {
		settings := ChannelSettings{ResponseTextReplacements: []ResponseTextReplacementRule{
			{Pattern: `quota (\d+)`, Replacement: `limit $1`, Scope: ResponseTextReplacementScopeError},
			{Pattern: `old-model`, Replacement: `new-model`, Scope: ResponseTextReplacementScopeResponse},
			{Pattern: `internal`, Replacement: `public`, Scope: ResponseTextReplacementScopeAll},
		}}

		require.NoError(t, settings.Validate())
	})

	tests := []struct {
		name string
		rule ResponseTextReplacementRule
	}{
		{
			name: "empty pattern",
			rule: ResponseTextReplacementRule{Replacement: "value", Scope: ResponseTextReplacementScopeAll},
		},
		{
			name: "invalid regular expression",
			rule: ResponseTextReplacementRule{Pattern: "[", Scope: ResponseTextReplacementScopeAll},
		},
		{
			name: "invalid scope",
			rule: ResponseTextReplacementRule{Pattern: "value", Scope: "unknown"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			settings := ChannelSettings{ResponseTextReplacements: []ResponseTextReplacementRule{tt.rule}}
			assert.Error(t, settings.Validate())
		})
	}
}
