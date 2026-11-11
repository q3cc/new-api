package controller

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func confirmPaymentComplianceForTest(t *testing.T) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
}

func TestStripeWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalAPISecret := setting.StripeApiSecret
	originalWebhookSecret := setting.StripeWebhookSecret
	originalPriceID := setting.StripePriceId
	t.Cleanup(func() {
		setting.StripeApiSecret = originalAPISecret
		setting.StripeWebhookSecret = originalWebhookSecret
		setting.StripePriceId = originalPriceID
	})

	setting.StripeWebhookSecret = ""
	setting.StripeApiSecret = "sk_test_123"
	setting.StripePriceId = "price_123"
	require.False(t, isStripeWebhookEnabled())

	setting.StripeWebhookSecret = "whsec_test"
	require.True(t, isStripeWebhookEnabled())

	setting.StripePriceId = ""
	require.False(t, isStripeWebhookEnabled())
}

func TestCreemWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalAPIKey := setting.CreemApiKey
	originalProducts := setting.CreemProducts
	originalWebhookSecret := setting.CreemWebhookSecret
	t.Cleanup(func() {
		setting.CreemApiKey = originalAPIKey
		setting.CreemProducts = originalProducts
		setting.CreemWebhookSecret = originalWebhookSecret
	})

	setting.CreemWebhookSecret = ""
	setting.CreemApiKey = "creem_api_key"
	setting.CreemProducts = `[{"productId":"prod_123"}]`
	require.False(t, isCreemWebhookEnabled())

	setting.CreemWebhookSecret = "creem_secret"
	require.True(t, isCreemWebhookEnabled())

	setting.CreemProducts = "[]"
	require.False(t, isCreemWebhookEnabled())
}

func TestWaffoWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalEnabled := setting.WaffoEnabled
	originalSandbox := setting.WaffoSandbox
	originalAPIKey := setting.WaffoApiKey
	originalPrivateKey := setting.WaffoPrivateKey
	originalPublicCert := setting.WaffoPublicCert
	originalSandboxAPIKey := setting.WaffoSandboxApiKey
	originalSandboxPrivateKey := setting.WaffoSandboxPrivateKey
	originalSandboxPublicCert := setting.WaffoSandboxPublicCert
	t.Cleanup(func() {
		setting.WaffoEnabled = originalEnabled
		setting.WaffoSandbox = originalSandbox
		setting.WaffoApiKey = originalAPIKey
		setting.WaffoPrivateKey = originalPrivateKey
		setting.WaffoPublicCert = originalPublicCert
		setting.WaffoSandboxApiKey = originalSandboxAPIKey
		setting.WaffoSandboxPrivateKey = originalSandboxPrivateKey
		setting.WaffoSandboxPublicCert = originalSandboxPublicCert
	})

	setting.WaffoEnabled = true
	setting.WaffoSandbox = false
	setting.WaffoApiKey = ""
	setting.WaffoPrivateKey = "private"
	setting.WaffoPublicCert = "public"
	require.False(t, isWaffoWebhookEnabled())

	setting.WaffoApiKey = "api"
	require.True(t, isWaffoWebhookEnabled())

	setting.WaffoEnabled = false
	require.False(t, isWaffoWebhookEnabled())

	setting.WaffoEnabled = true
	setting.WaffoSandbox = true
	setting.WaffoSandboxApiKey = ""
	setting.WaffoSandboxPrivateKey = "sandbox_private"
	setting.WaffoSandboxPublicCert = "sandbox_public"
	require.False(t, isWaffoWebhookEnabled())

	setting.WaffoSandboxApiKey = "sandbox_api"
	require.True(t, isWaffoWebhookEnabled())
}

func TestWaffoPancakeWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalMerchantID := setting.WaffoPancakeMerchantID
	originalPrivateKey := setting.WaffoPancakePrivateKey
	originalProductID := setting.WaffoPancakeProductID
	t.Cleanup(func() {
		setting.WaffoPancakeMerchantID = originalMerchantID
		setting.WaffoPancakePrivateKey = originalPrivateKey
		setting.WaffoPancakeProductID = originalProductID
	})

	// Presence of all three credentials enables the gateway. Webhook public
	// keys are bundled in the SDK and there is no separate Enabled toggle —
	// clear any of the three fields to disable.
	setting.WaffoPancakeMerchantID = ""
	setting.WaffoPancakePrivateKey = "private"
	setting.WaffoPancakeProductID = "product"
	require.False(t, isWaffoPancakeWebhookEnabled())

	setting.WaffoPancakeMerchantID = "merchant"
	require.True(t, isWaffoPancakeWebhookEnabled())

	setting.WaffoPancakeProductID = ""
	require.False(t, isWaffoPancakeWebhookEnabled())

	setting.WaffoPancakeProductID = "product"
	setting.WaffoPancakePrivateKey = ""
	require.False(t, isWaffoPancakeWebhookEnabled())
}

func TestEpayWebhookRemainsAvailableForExistingOrders(t *testing.T) {
	original := operation_setting.PayMethods
	operation_setting.PayMethods = nil
	t.Cleanup(func() { operation_setting.PayMethods = original })
	require.True(t, isEpayWebhookEnabled())
}

func TestEpayCallbacksVerifyBeforeSettlement(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalPayAddress := operation_setting.PayAddress
	originalEpayID := operation_setting.EpayId
	originalEpayKey := operation_setting.EpayKey
	originalPayMethods := operation_setting.PayMethods
	originalServerAddress := system_setting.ServerAddress
	t.Cleanup(func() {
		operation_setting.PayAddress = originalPayAddress
		operation_setting.EpayId = originalEpayID
		operation_setting.EpayKey = originalEpayKey
		operation_setting.PayMethods = originalPayMethods
		system_setting.ServerAddress = originalServerAddress
	})
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.EpayKey = "test-key"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	system_setting.ServerAddress = "https://dashboard.example.com"
	// Verification uses each persisted order's immutable endpoint version.
	version, _ := setupEpayCallbackTest(t)
	require.NoError(t, model.DB.Model(version).Updates(map[string]any{"endpoint_id": "legacy", "merchant_id": "epay_id", "secret_key": "test-key"}).Error)
	for _, tradeNo := range []string{"order", "other&out_trade_no=order"} {
		require.NoError(t, (&model.TopUp{UserId: 900, Amount: 1, Money: 1, TradeNo: tradeNo, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, EpayVersionId: version.Id, EpayMoney: "1.00", LegacyEpayCallback: true, Status: common.TopUpStatusPending}).Insert())
	}
	require.True(t, isEpayWebhookEnabled())

	// Both ambiguous maps below had this same valid signing string in v0.0.4.
	// This must fail because of parameter ambiguity, not a mismatched signature.
	ambiguousSign := epay.MD5String("money=1.00&name=item&out_trade_no=other&out_trade_no=order&pid=epay_id&trade_status=TRADE_SUCCESS&type=alipay", "test-key")
	pendingSign := epay.MD5String("money=1.00&name=item%26other&out_trade_no=order&pid=epay_id&trade_status=WAIT_BUYER_PAY&type=alipay", "test-key")
	cases := []struct {
		name         string
		productName  string
		tradeNo      string
		status       string
		sign         string
		validPending bool
	}{
		{"separator in product name", "item&out_trade_no=other", "order", epay.StatusTradeSuccess, ambiguousSign, false},
		{"separator in order number", "item", "other&out_trade_no=order", epay.StatusTradeSuccess, ambiguousSign, false},
		{"invalid signature", "item", "order", epay.StatusTradeSuccess, "invalid", false},
		{"missing signature", "item", "order", epay.StatusTradeSuccess, "", false},
		{"valid pending with literal percent escape", "item%26other", "order", "WAIT_BUYER_PAY", pendingSign, true},
	}
	endpoints := []struct {
		name             string
		path             string
		handler          gin.HandlerFunc
		status           int
		rejectedBody     string
		pendingBody      string
		rejectedLocation string
		pendingLocation  string
	}{
		{
			name: "topup notify", path: "/api/user/epay/notify", handler: EpayNotify,
			status: http.StatusOK, rejectedBody: "fail", pendingBody: "fail",
		},
		{
			name: "subscription notify", path: "/api/subscription/epay/notify", handler: SubscriptionEpayNotify,
			status: http.StatusOK, rejectedBody: "fail", pendingBody: "fail",
		},
		{
			name: "subscription return", path: "/api/subscription/epay/return", handler: SubscriptionEpayReturn,
			status:           http.StatusFound,
			rejectedLocation: "https://dashboard.example.com/wallet?pay=fail",
			pendingLocation:  "https://dashboard.example.com/wallet?pay=pending",
		},
	}
	router := gin.New()
	for _, endpoint := range endpoints {
		router.Any(endpoint.path, endpoint.handler)
	}
	for _, endpoint := range endpoints {
		if endpoint.name == "subscription notify" {
			for _, tradeNo := range []string{"order", "other&out_trade_no=order"} {
				require.NoError(t, (&model.SubscriptionOrder{UserId: 900, PlanId: 900, Money: 1, TradeNo: tradeNo, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, EpayVersionId: version.Id, EpayMoney: "1.00", LegacyEpayCallback: true, Status: common.TopUpStatusPending}).Insert())
			}
		}
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			for _, tc := range cases {
				t.Run(endpoint.name+"/"+method+"/"+tc.name, func(t *testing.T) {
					params := url.Values{
						"pid": {"epay_id"}, "type": {"alipay"}, "money": {"1.00"},
						"name": {tc.productName}, "out_trade_no": {tc.tradeNo},
						"trade_status": {tc.status}, "sign_type": {"MD5"},
					}
					if tc.sign != "" {
						params.Set("sign", tc.sign)
					}
					request := httptest.NewRequest(method, endpoint.path+"?"+params.Encode(), nil)
					if method == http.MethodPost {
						request = httptest.NewRequest(method, endpoint.path, strings.NewReader(params.Encode()))
						request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
					}
					recorder := httptest.NewRecorder()
					require.NotPanics(t, func() { router.ServeHTTP(recorder, request) })
					assert.Equal(t, endpoint.status, recorder.Code)
					wantBody, wantLocation := endpoint.rejectedBody, endpoint.rejectedLocation
					if tc.validPending {
						wantBody, wantLocation = endpoint.pendingBody, endpoint.pendingLocation
					}
					if wantBody != "" {
						assert.Equal(t, wantBody, recorder.Body.String())
					}
					assert.Equal(t, wantLocation, recorder.Header().Get("Location"))
					assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo(tc.tradeNo).Status)
					if endpoint.name != "topup notify" {
						assert.Equal(t, common.TopUpStatusPending, model.GetSubscriptionOrderByTradeNo(tc.tradeNo).Status)
					}
				})
			}
		}
	}
}

// newEpayRSAKeyPairForTest returns a throwaway key pair as single-line Base64
// text, the format Epay merchant consoles show.
func newEpayRSAKeyPairForTest(t *testing.T) (string, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	privateDER, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	return base64.StdEncoding.EncodeToString(privateDER), base64.StdEncoding.EncodeToString(publicDER)
}

func TestUpdateOptionValidatesEpaySignSettings(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	originalOptionMap := common.OptionMap
	paymentSetting := operation_setting.GetPaymentSetting()
	originalSignType := paymentSetting.EpaySignType
	originalMerchantPrivateKey := paymentSetting.EpayMerchantPrivateKey
	originalPlatformPublicKey := paymentSetting.EpayPlatformPublicKey
	t.Cleanup(func() {
		common.OptionMap = originalOptionMap
		paymentSetting.EpaySignType = originalSignType
		paymentSetting.EpayMerchantPrivateKey = originalMerchantPrivateKey
		paymentSetting.EpayPlatformPublicKey = originalPlatformPublicKey
	})
	// A site upgraded from an MD5-only release has no saved RSA settings.
	common.OptionMap = map[string]string{
		operation_setting.EpaySignTypeOptionKey:           operation_setting.EpaySignTypeMD5,
		operation_setting.EpayMerchantPrivateKeyOptionKey: "",
		operation_setting.EpayPlatformPublicKeyOptionKey:  "",
	}
	paymentSetting.EpaySignType = operation_setting.EpaySignTypeMD5
	paymentSetting.EpayMerchantPrivateKey = ""
	paymentSetting.EpayPlatformPublicKey = ""
	signTypeKey := operation_setting.EpaySignTypeOptionKey
	privateKeyKey := operation_setting.EpayMerchantPrivateKeyOptionKey
	publicKeyKey := operation_setting.EpayPlatformPublicKeyOptionKey
	merchantPrivateKey, _ := newEpayRSAKeyPairForTest(t)
	_, platformPublicKey := newEpayRSAKeyPairForTest(t)
	const privateKeyError = "The Epay merchant private key is missing or invalid"
	const publicKeyError = "The Epay platform public key is missing or invalid"

	steps := []struct {
		name      string
		key       string
		value     string
		wantError string
	}{
		{"unknown signature type", signTypeKey, "SHA1", "Epay signature type must be MD5 or RSA"},
		{"RSA before keys are saved", signTypeKey, "RSA", privateKeyError},
		{"malformed private key", privateKeyKey, "not a key", privateKeyError},
		{"public key in the private key field", privateKeyKey, platformPublicKey, privateKeyError},
		{"save private key", privateKeyKey, merchantPrivateKey, ""},
		{"RSA before the public key is saved", signTypeKey, "RSA", publicKeyError},
		{"private key in the public key field", publicKeyKey, merchantPrivateKey, publicKeyError},
		{"save public key", publicKeyKey, platformPublicKey, ""},
		{"switch to RSA", signTypeKey, "RSA", ""},
		{"clear private key while RSA is active", privateKeyKey, "", privateKeyError},
		{"switch back to MD5", signTypeKey, "MD5", ""},
	}
	for _, step := range steps {
		err := model.UpdateOption(step.key, step.value)
		if step.wantError == "" {
			require.NoError(t, err, step.name)
			continue
		}
		require.Error(t, err, step.name)
		assert.Equal(t, step.wantError, err.Error(), step.name)
	}
	assert.Equal(t, operation_setting.EpaySignTypeMD5, paymentSetting.EpaySignType)
	assert.Equal(t, merchantPrivateKey, paymentSetting.EpayMerchantPrivateKey)
	assert.Equal(t, platformPublicKey, paymentSetting.EpayPlatformPublicKey)

	// The private key is never sent back to the settings page; the public key may be.
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
	GetOptions(context)
	var response struct {
		Success bool           `json:"success"`
		Data    []model.Option `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	returned := make(map[string]string, len(response.Data))
	for _, option := range response.Data {
		returned[option.Key] = option.Value
	}
	assert.Equal(t, operation_setting.EpaySignTypeMD5, returned[signTypeKey])
	assert.Equal(t, platformPublicKey, returned[publicKeyKey])
	assert.NotContains(t, returned, privateKeyKey)
}
