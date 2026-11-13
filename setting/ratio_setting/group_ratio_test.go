package ratio_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOrderGroupNamesReconcilesConfiguredOrder(t *testing.T) {
	previousOrder := GetGroupOrder()
	GetGroupRatioSetting().GroupOrder = []string{"vip", "removed", "default", "vip"}
	t.Cleanup(func() {
		GetGroupRatioSetting().GroupOrder = previousOrder
	})

	actual := OrderGroupNames([]string{"standard", "default", "vip", "special"})

	assert.Equal(t, []string{"vip", "default", "special", "standard"}, actual)
}

func TestCheckGroupOrder(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		wantError string
	}{
		{name: "valid", value: `["vip","default"]`},
		{name: "empty array", value: `[]`},
		{name: "not an array", value: `{}`, wantError: "cannot unmarshal"},
		{name: "null", value: `null`, wantError: "must be a JSON array"},
		{name: "empty name", value: `["vip",""]`, wantError: "empty group name"},
		{name: "duplicate", value: `["vip","vip"]`, wantError: "duplicate group: vip"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := CheckGroupOrder(test.value)
			if test.wantError == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.ErrorContains(t, err, test.wantError)
		})
	}
}

func TestGroupTagOption(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		wantError string
	}{
		{name: "valid", value: `{"Claude Max":"claude","all-in-one":"mixed"}`},
		{name: "empty object", value: `{}`},
		{name: "null", value: `null`, wantError: "must be a JSON object"},
		{name: "not an object", value: `["claude"]`, wantError: "cannot unmarshal"},
		{name: "empty group name", value: `{" ":"claude"}`, wantError: "empty group name"},
		{name: "empty tag", value: `{"vip":""}`, wantError: "invalid for group: vip"},
		{name: "tag with spaces", value: `{"vip":"Claude Code"}`, wantError: "invalid for group: vip"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := CheckGroupTag(test.value)
			if test.wantError == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.ErrorContains(t, err, test.wantError)
		})
	}

	// Saving the option replaces the assignments, including removed groups.
	t.Cleanup(func() { GetGroupRatioSetting().GroupTag.Clear() })
	require.NoError(t, config.UpdateConfigFromMap(GetGroupRatioSetting(), map[string]string{"group_tag": `{"vip":"claude","svip":"gemini"}`}))
	assert.Equal(t, "claude", GetGroupTag("vip"))
	require.NoError(t, config.UpdateConfigFromMap(GetGroupRatioSetting(), map[string]string{"group_tag": `{"svip":"mixed"}`}))
	assert.Equal(t, "", GetGroupTag("vip"))
	assert.Equal(t, "mixed", GetGroupTag("svip"))
	assert.Equal(t, "", GetGroupTag("untagged"))
}
