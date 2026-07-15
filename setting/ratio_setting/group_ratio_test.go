package ratio_setting

import (
	"testing"

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
