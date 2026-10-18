package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The mapi endpoint answers with the payment code itself; the console renders
// it in place instead of opening the gateway checkout page.
func TestRequestEpayMapiReturnsThePaymentCode(t *testing.T) {
	service.InitHttpClient()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/mapi.php", r.URL.Path)
		require.NoError(t, r.ParseForm())
		for _, field := range []string{"pid", "type", "out_trade_no", "notify_url", "name", "money", "clientip", "sign", "sign_type"} {
			assert.NotEmpty(t, r.PostForm.Get(field), field)
		}
		assert.Equal(t, "MD5", r.PostForm.Get("sign_type"))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":     1,
			"qrcode":   "weixin://wxpay/bizpayurl?pr=test",
			"payurl":   "https://pay.example.com/qr/1",
			"trade_no": "GATEWAY1",
		})
	}))
	defer upstream.Close()

	version := &model.EpayEndpointVersion{
		Address:    upstream.URL,
		MerchantId: "1001",
		SecretKey:  "secret",
		Mapi:       true,
	}
	code, err := requestEpayMapi(context.Background(), version, "wxpay", "USR1NOabc",
		"TUC100", "7.00", "https://api.example.com/api/user/epay/x/notify", "https://api.example.com/usage-logs", "203.0.113.9")
	require.NoError(t, err)
	assert.Equal(t, "weixin://wxpay/bizpayurl?pr=test", code.QRCode)
	assert.Equal(t, "https://pay.example.com/qr/1", code.PayURL)
}

func TestRequestEpayMapiReportsGatewayRejections(t *testing.T) {
	service.InitHttpClient()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":-1,"msg":"channel disabled"}`))
	}))
	defer upstream.Close()

	version := &model.EpayEndpointVersion{Address: upstream.URL, MerchantId: "1001", SecretKey: "secret", Mapi: true}
	_, err := requestEpayMapi(context.Background(), version, "wxpay", "USR1NOabc",
		"TUC100", "7.00", "https://api.example.com/notify", "https://api.example.com/return", "203.0.113.9")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "channel disabled")
}

func TestRequestEpayMapiRejectsAnAnswerWithoutAPaymentCode(t *testing.T) {
	service.InitHttpClient()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":1}`))
	}))
	defer upstream.Close()

	version := &model.EpayEndpointVersion{Address: upstream.URL, MerchantId: "1001", SecretKey: "secret", Mapi: true}
	_, err := requestEpayMapi(context.Background(), version, "wxpay", "USR1NOabc",
		"TUC100", "7.00", "https://api.example.com/notify", "https://api.example.com/return", "203.0.113.9")
	require.Error(t, err)
}
