package controller

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetEpayConfig(c *gin.Context) {
	config, err := model.GetEpayConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}

func UpdateEpayConfig(c *gin.Context) {
	var config model.EpayConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.SaveEpayConfig(config); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "generic", map[string]any{"action": "payment.epay_config_update", "endpoint_count": len(config.Endpoints), "payment_method_count": len(config.PayMethods)})
	GetEpayConfig(c)
}

func epayClientForVersion(version *model.EpayEndpointVersion) (*epay.Client, error) {
	return epay.NewClient(&epay.Config{PartnerID: version.MerchantId, Key: version.SecretKey}, version.Address)
}

// Only a persisted order selects the immutable verifier. Query/body endpoint
// identifiers and the current payment method bindings are never trusted here.
func verifyEpayCallback(c *gin.Context, subscription bool) (*epay.VerifyRes, model.EpayVerification, error) {
	var verification model.EpayVerification
	var values url.Values
	if c.Request.Method == http.MethodPost {
		if err := c.Request.ParseForm(); err != nil {
			return nil, verification, err
		}
		values = c.Request.PostForm
		// Reject ambiguous signed fields supplied in both query and body.
		for key := range c.Request.URL.Query() {
			if _, exists := values[key]; exists {
				return nil, verification, errors.New("重复支付参数")
			}
		}
	} else {
		values = c.Request.URL.Query()
	}
	params := make(map[string]string, len(values))
	for key, entries := range values {
		if len(entries) != 1 {
			return nil, verification, errors.New("重复支付参数")
		}
		params[key] = entries[0]
	}
	if params["sign"] == "" || params["out_trade_no"] == "" || len(params["out_trade_no"]) > 255 || (params["sign_type"] != "" && params["sign_type"] != "MD5") {
		return nil, verification, errors.New("支付参数无效")
	}
	version, err := model.GetEpayOrderVersion(params["out_trade_no"], c.Param("endpoint_id"), subscription)
	if err != nil {
		return nil, verification, err
	}
	if params["pid"] != version.MerchantId {
		return nil, verification, model.ErrPaymentMethodMismatch
	}
	providedSign := params["sign"]
	signed, err := epay.GenerateParamsWithError(params, version.SecretKey)
	if err != nil {
		return nil, verification, errors.New("支付参数无效")
	}
	expected := signed["sign"]
	params["sign"] = providedSign // GenerateParamsWithError mutates its input.
	if subtle.ConstantTimeCompare([]byte(expected), []byte(providedSign)) != 1 {
		return nil, verification, errors.New("支付签名无效")
	}
	client, err := epayClientForVersion(version)
	if err != nil {
		return nil, verification, err
	}
	info, err := client.Verify(params)
	if err != nil || !info.VerifyStatus {
		return nil, verification, errors.New("支付签名无效")
	}
	verification = model.EpayVerification{VersionId: version.Id, Method: info.Type, Money: info.Money}
	return info, verification, nil
}

func logEpayCallbackFailure(c *gin.Context, err error) {
	// Do not log raw request URIs, signatures, payloads or usable payment links.
	common.SysError("epay callback rejected: " + err.Error())
}

func enabledEpayMethods() []map[string]string {
	methods := make([]map[string]string, 0)
	for _, method := range operationPayMethods() {
		if model.IsEpayPaymentMethod(method["type"]) {
			if _, err := model.ResolveEpayPaymentMethod(model.EpayPaymentMethodKey(method)); err != nil {
				continue
			}
		}
		public := make(map[string]string, len(method))
		for key, value := range method {
			if key != "epay_endpoint_id" {
				public[key] = value
			}
		}
		public["id"] = model.EpayPaymentMethodKey(method)
		methods = append(methods, public)
	}
	return methods
}

func operationPayMethods() []map[string]string {
	config, err := model.GetEpayConfig()
	if err != nil {
		return nil
	}
	return config.PayMethods
}

func epayHasEnabledMethods() bool {
	for _, method := range operationPayMethods() {
		if !model.IsEpayPaymentMethod(method["type"]) {
			continue
		}
		if _, err := model.ResolveEpayPaymentMethod(model.EpayPaymentMethodKey(method)); err == nil {
			return true
		}
	}
	return false
}
