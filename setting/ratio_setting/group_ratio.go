package ratio_setting

import (
	"errors"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{
	"vip": {
		"edit_this": 0.9,
	},
}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
	GroupOrder              []string                                 `json:"group_order"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
		GroupOrder:              []string{},
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

func GetGroupOrder() []string {
	return append([]string(nil), GetGroupRatioSetting().GroupOrder...)
}

func OrderGroupNames(names []string) []string {
	available := make(map[string]struct{}, len(names))
	for _, name := range names {
		if name != "" {
			available[name] = struct{}{}
		}
	}

	ordered := make([]string, 0, len(available))
	seen := make(map[string]struct{}, len(available))
	for _, name := range GetGroupOrder() {
		if _, ok := available[name]; !ok {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		ordered = append(ordered, name)
		seen[name] = struct{}{}
	}

	remaining := make([]string, 0, len(available)-len(ordered))
	for name := range available {
		if _, ok := seen[name]; !ok {
			remaining = append(remaining, name)
		}
	}
	sort.Strings(remaining)

	return append(ordered, remaining...)
}

func GetOrderedGroupNames() []string {
	groups := GetGroupRatioCopy()
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	return OrderGroupNames(names)
}

func ContainsGroupRatio(name string) bool {
	_, ok := groupRatioMap.Get(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := groupRatioMap.Get(name)
	if !ok {
		common.SysLog("group ratio not found: " + name)
		return 1
	}
	return ratio
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	gp, ok := groupGroupRatioMap.Get(userGroup)
	if !ok {
		return -1, false
	}
	ratio, ok := gp[usingGroup]
	if !ok {
		return -1, false
	}
	return ratio, true
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := common.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}

func CheckGroupOrder(jsonStr string) error {
	var order []string
	if err := common.Unmarshal([]byte(jsonStr), &order); err != nil {
		return err
	}
	if order == nil {
		return errors.New("group order must be a JSON array")
	}

	seen := make(map[string]struct{}, len(order))
	for _, name := range order {
		if strings.TrimSpace(name) == "" {
			return errors.New("group order contains an empty group name")
		}
		if _, ok := seen[name]; ok {
			return errors.New("group order contains a duplicate group: " + name)
		}
		seen[name] = struct{}{}
	}
	return nil
}
