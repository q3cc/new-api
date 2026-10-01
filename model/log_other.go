package model

import (
	"encoding/json"
	"maps"
	"slices"

	"github.com/QuantumNous/new-api/common"
)

const (
	logOtherAdminInfoKey = "admin_info"
	logOtherRootInfoKey  = "root_info"
	logOtherAuditInfoKey = "audit_info"
)

// legacySensitiveLogOtherKeys are historical top-level fields that must never
// be written via SetPublic and must be stripped from user-visible projections.
var legacySensitiveLogOtherKeys = []string{
	"channel_id",
	"channel_name",
	"channel_type",
	"reject_reason",
}

type logOtherVisibility int

const (
	logOtherVisibilityUser logOtherVisibility = iota
	logOtherVisibilityAdmin
	logOtherVisibilityRoot
)

// LogOther separates usage-log metadata by the audience allowed to see it.
// Its maps stay private so callers cannot accidentally place privileged fields
// in the user-visible top level.
type LogOther struct {
	public    map[string]any
	adminInfo map[string]any
	rootInfo  map[string]any
	auditInfo map[string]any
}

func NewLogOther() *LogOther {
	return &LogOther{}
}

func isReservedLogOtherKey(key string) bool {
	switch key {
	case logOtherAdminInfoKey, logOtherRootInfoKey, logOtherAuditInfoKey:
		return true
	default:
		return slices.Contains(legacySensitiveLogOtherKeys, key)
	}
}

// SetPublic records metadata that log owners may receive from self/token log APIs.
// It rejects role-scoped and legacy-sensitive keys so new writers cannot recreate
// the historical channel/reject-reason leak.
func (o *LogOther) SetPublic(key string, value any) bool {
	if o == nil || key == "" || isReservedLogOtherKey(key) {
		return false
	}
	if o.public == nil {
		o.public = make(map[string]any)
	}
	o.public[key] = value
	return true
}

func (o *LogOther) MergePublic(values map[string]any) {
	for key, value := range values {
		o.SetPublic(key, value)
	}
}

func (o *LogOther) SetAdmin(key string, value any) bool {
	if o == nil || key == "" {
		return false
	}
	if o.adminInfo == nil {
		o.adminInfo = make(map[string]any)
	}
	o.adminInfo[key] = value
	return true
}

func (o *LogOther) MergeAdmin(values map[string]any) {
	for key, value := range values {
		o.SetAdmin(key, value)
	}
}

func (o *LogOther) SetRoot(key string, value any) bool {
	if o == nil || key == "" {
		return false
	}
	if o.rootInfo == nil {
		o.rootInfo = make(map[string]any)
	}
	o.rootInfo[key] = value
	return true
}

func (o *LogOther) MergeRoot(values map[string]any) {
	for key, value := range values {
		o.SetRoot(key, value)
	}
}

func (o *LogOther) SetAudit(key string, value any) bool {
	if o == nil || key == "" {
		return false
	}
	if o.auditInfo == nil {
		o.auditInfo = make(map[string]any)
	}
	o.auditInfo[key] = value
	return true
}

func (o *LogOther) MergeAudit(values map[string]any) {
	for key, value := range values {
		o.SetAudit(key, value)
	}
}

func copyLogOtherMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	copyValues := make(map[string]any, len(values))
	maps.Copy(copyValues, values)
	return copyValues
}

func (o *LogOther) toMap() map[string]any {
	result := make(map[string]any)
	if o == nil {
		return result
	}

	maps.Copy(result, o.public)
	if adminInfo := copyLogOtherMap(o.adminInfo); len(adminInfo) > 0 {
		result[logOtherAdminInfoKey] = adminInfo
	}
	if auditInfo := copyLogOtherMap(o.auditInfo); len(auditInfo) > 0 {
		result[logOtherAuditInfoKey] = auditInfo
	}
	if rootInfo := copyLogOtherMap(o.rootInfo); len(rootInfo) > 0 {
		result[logOtherRootInfoKey] = rootInfo
	}
	return result
}

func (o *LogOther) jsonString() string {
	if o == nil {
		return ""
	}
	data, err := common.Marshal(o.toMap())
	if err != nil {
		common.SysError("failed to marshal log other: " + err.Error())
		return ""
	}
	return string(data)
}

// JSONString returns the complete stored representation, including all
// privileged scopes. API projections must use the role-specific formatter.
func (o *LogOther) JSONString() string {
	return o.jsonString()
}

// Snapshot returns a detached top-level view for tests and read-only
// inspection. Mutating it cannot add or replace fields in LogOther.
func (o *LogOther) Snapshot() map[string]any {
	if o == nil {
		return nil
	}
	return o.toMap()
}

func (o *LogOther) MarshalJSON() ([]byte, error) {
	return common.Marshal(o.toMap())
}

func normalizeLegacyRejectReason(values map[string]json.RawMessage) bool {
	rejectReason, ok := values["reject_reason"]
	if !ok {
		return false
	}

	adminInfo := make(map[string]json.RawMessage)
	if rawAdminInfo, exists := values[logOtherAdminInfoKey]; exists {
		_ = common.Unmarshal(rawAdminInfo, &adminInfo)
	}
	if adminInfo == nil {
		adminInfo = make(map[string]json.RawMessage)
	}
	if _, exists := adminInfo["reject_reason"]; !exists {
		adminInfo["reject_reason"] = rejectReason
	}
	encodedAdminInfo, err := common.Marshal(adminInfo)
	if err != nil {
		return false
	}
	values[logOtherAdminInfoKey] = encodedAdminInfo
	delete(values, "reject_reason")
	return true
}

// formatLogOtherJSON applies the role projection while keeping untouched JSON
// values as RawMessage. This preserves integers larger than JavaScript's safe
// range instead of round-tripping them through float64.
func formatLogOtherJSON(value string, visibility logOtherVisibility, modelName string) string {
	if value == "" {
		return ""
	}

	var values map[string]json.RawMessage
	if err := common.UnmarshalJsonStr(value, &values); err != nil {
		if visibility == logOtherVisibilityRoot {
			return value
		}
		return "{}"
	}

	changed := false
	if visibility == logOtherVisibilityUser {
		changed = projectUserMappedModelNames(values, modelName)
		for _, key := range []string{logOtherAdminInfoKey, logOtherRootInfoKey, logOtherAuditInfoKey} {
			if _, exists := values[key]; exists {
				delete(values, key)
				changed = true
			}
		}
		for _, key := range legacySensitiveLogOtherKeys {
			if _, exists := values[key]; exists {
				delete(values, key)
				changed = true
			}
		}
	} else {
		changed = normalizeLegacyRejectReason(values)
		if visibility == logOtherVisibilityAdmin {
			if _, exists := values[logOtherRootInfoKey]; exists {
				delete(values, logOtherRootInfoKey)
				changed = true
			}
		}
	}

	if !changed {
		return value
	}
	formatted, err := common.Marshal(values)
	if err != nil {
		if visibility == logOtherVisibilityRoot {
			return value
		}
		return "{}"
	}
	return string(formatted)
}

// projectUserMappedModelNames exposes only the requested alias for mapped
// requests. Apply on read so historical logs are protected without modifying
// the stored diagnostics returned to administrators.
func projectUserMappedModelNames(values map[string]json.RawMessage, modelName string) bool {
	var mapped bool
	_ = common.Unmarshal(values["is_model_mapped"], &mapped)
	var upstream string
	_ = common.Unmarshal(values["upstream_model_name"], &upstream)
	var response map[string]json.RawMessage
	_ = common.Unmarshal(values["response_model"], &response)
	var requested, responseUpstream string
	if response != nil {
		_ = common.Unmarshal(response["requested_model"], &requested)
		_ = common.Unmarshal(response["upstream_model"], &responseUpstream)
	}
	if requested != "" {
		modelName = requested
	}
	mapped = mapped || (modelName != "" && ((upstream != "" && upstream != modelName) ||
		(responseUpstream != "" && responseUpstream != modelName)))
	if !mapped {
		return false
	}
	if modelName == "" {
		delete(values, "upstream_model_name")
		delete(values, "response_model")
		return true
	}
	publicName, err := common.Marshal(modelName)
	if err != nil {
		delete(values, "upstream_model_name")
		delete(values, "response_model")
		return true
	}
	if _, exists := values["upstream_model_name"]; exists {
		values["upstream_model_name"] = publicName
	}
	if response == nil {
		delete(values, "response_model")
		return true
	}
	for _, field := range []string{"requested_model", "upstream_model", "returned_model"} {
		var name string
		if common.Unmarshal(response[field], &name) == nil && name != "" {
			response[field] = publicName
		}
	}
	encoded, err := common.Marshal(response)
	if err != nil {
		delete(values, "response_model")
	} else {
		values["response_model"] = encoded
	}
	return true
}
