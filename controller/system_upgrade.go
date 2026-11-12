package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/pkg/hotupgrade"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/systemupgrade"
	"github.com/gin-gonic/gin"
)

type systemUpgradeStatus struct {
	Supervised     bool                      `json:"supervised"`
	CurrentVersion string                    `json:"current_version"`
	DrainTimeout   int64                     `json:"drain_timeout"`
	Check          systemupgrade.CheckResult `json:"check"`
	// CanUpgrade tells the console whether this user may install or roll back.
	CanUpgrade bool                   `json:"can_upgrade"`
	Progress   systemupgrade.Progress `json:"progress"`
	Supervisor *hotupgrade.Status     `json:"supervisor,omitempty"`
}

// GetSystemUpgradeStatus reports the running and latest versions and, for
// root, the progress of an online upgrade.
func GetSystemUpgradeStatus(c *gin.Context) {
	status := systemUpgradeStatus{
		Supervised:     systemupgrade.Supervised(),
		CurrentVersion: common.Version,
		DrainTimeout:   int64(hotupgrade.DrainTimeout().Seconds()),
		Check:          systemupgrade.LastCheck(),
		CanUpgrade:     c.GetInt("role") >= common.RoleRootUser,
	}
	if !status.CanUpgrade {
		// Administrators only learn whether a new version exists; worker
		// processes and download progress stay with root.
		common.ApiSuccess(c, status)
		return
	}
	status.Progress = systemupgrade.CurrentProgress()
	if status.Supervised {
		if supervisor, err := hotupgrade.ReadStatus(); err == nil {
			status.Supervisor = &supervisor
		}
	}
	common.ApiSuccess(c, status)
}

// CheckSystemUpgrade looks for a new release right away.
func CheckSystemUpgrade(c *gin.Context) {
	common.ApiSuccess(c, systemupgrade.CheckNow(c.Request.Context()))
}

// ApplySystemUpgrade installs a published version after step-up verification.
func ApplySystemUpgrade(c *gin.Context) {
	var request struct {
		Version string `json:"version"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Version == "" {
		common.ApiErrorT(c, "Choose a version to install.")
		return
	}
	if !systemupgrade.Supervised() {
		common.ApiError(c, systemupgrade.ErrNotSupervised)
		return
	}
	if !requireSystemUpgradeProof(c, service.SystemUpgradeContext{Action: service.SystemUpgradeActionApply, Version: request.Version}) {
		return
	}
	if err := systemupgrade.Apply(request.Version); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "system.upgrade_apply", map[string]any{"from": common.Version, "to": request.Version})
	common.ApiSuccess(c, nil)
}

// RollbackSystemUpgrade switches back to the version that ran before the
// latest upgrade, after step-up verification.
func RollbackSystemUpgrade(c *gin.Context) {
	if !systemupgrade.Supervised() {
		common.ApiError(c, systemupgrade.ErrNotSupervised)
		return
	}
	supervisor, err := hotupgrade.ReadStatus()
	if err != nil || supervisor.Previous == nil {
		common.ApiErrorT(c, "There is no previous version to roll back to.")
		return
	}
	if !requireSystemUpgradeProof(c, service.SystemUpgradeContext{Action: service.SystemUpgradeActionRollback}) {
		return
	}
	if err := systemupgrade.Rollback(c.Request.Context()); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "system.upgrade_rollback", map[string]any{"from": common.Version, "to": supervisor.Previous.Version})
	common.ApiSuccess(c, nil)
}

func requireSystemUpgradeProof(c *gin.Context, context service.SystemUpgradeContext) bool {
	payload, err := common.Marshal(context)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	operation := service.VerificationOperation{Scope: service.VerificationScopeSystemUpgrade, Context: payload}
	return middleware.RequireSecurityProof(c, operation) != nil
}
