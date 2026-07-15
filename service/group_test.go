package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
)

func TestOrderUserUsableGroupNamesAppendsExtrasAndAuto(t *testing.T) {
	previousOrder := ratio_setting.GetGroupOrder()
	ratio_setting.GetGroupRatioSetting().GroupOrder = []string{"vip", "default"}
	t.Cleanup(func() {
		ratio_setting.GetGroupRatioSetting().GroupOrder = previousOrder
	})

	actual := OrderUserUsableGroupNames(map[string]string{
		"default": "Default",
		"vip":     "VIP",
		"special": "Special",
		"auto":    "Auto",
	})

	assert.Equal(t, []string{"vip", "default", "special", "auto"}, actual)
}
