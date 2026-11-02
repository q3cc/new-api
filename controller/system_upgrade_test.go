package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSystemUpgradeVerificationIsRootOnly(t *testing.T) {
	operator, identity := setupSecurityEnrollmentTest(t)

	_, err := service.GetVerificationRequirements(identity, service.VerificationScopeSystemUpgrade)
	assert.ErrorIs(t, err, service.ErrVerificationForbidden, "an administrator below root cannot verify an upgrade")

	require.NoError(t, model.DB.Model(operator).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	requirements, err := service.GetVerificationRequirements(identity, service.VerificationScopeSystemUpgrade)
	require.NoError(t, err)
	require.NotEmpty(t, requirements.Methods)
	assert.Equal(t, service.VerificationMethodPassword, requirements.Methods[0].Method, "root without 2FA or passkey verifies with the password")
}

func TestSystemUpgradeOutsideSupervisorRefusesBeforeVerification(t *testing.T) {
	_, identity, _ := setupAdminUserTest(t)
	for _, test := range []struct {
		name, path, body string
		handler          func(*gin.Context)
	}{
		{"apply", "/api/system-upgrade/apply", `{"version":"main-20261102-abcdef0"}`, ApplySystemUpgrade},
		{"rollback", "/api/system-upgrade/rollback", `{}`, RollbackSystemUpgrade},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := adminUserRequest(http.MethodPost, test.path, test.body, "", identity, common.RoleRootUser, nil, test.handler)

			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, http.StatusOK, response.Code, "no verification is asked for an upgrade that cannot run")
			assert.False(t, result.Success)
			assert.Contains(t, result.Message, "HOT_UPGRADE_ENABLED=true")
		})
	}
}

func TestSystemUpgradeStatusReportsRunningVersion(t *testing.T) {
	_, identity, _ := setupAdminUserTest(t)

	response := adminUserRequest(http.MethodGet, "/api/system-upgrade/status", "", "", identity, common.RoleRootUser, nil, GetSystemUpgradeStatus)

	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Supervised     bool   `json:"supervised"`
			CurrentVersion string `json:"current_version"`
			DrainTimeout   int64  `json:"drain_timeout"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success)
	assert.False(t, result.Data.Supervised)
	assert.Equal(t, common.Version, result.Data.CurrentVersion)
	assert.EqualValues(t, 7200, result.Data.DrainTimeout)
}
