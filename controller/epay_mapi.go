package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

// The mapi endpoint answers a server-to-server call with the payment code
// itself, so the console can render it in place instead of sending the reader
// to the gateway's hosted checkout page.
const (
	epayMapiTimeout  = 15 * time.Second
	maxEpayMapiBytes = 64 << 10
)

// epayMapiCode is what the gateway returns for a successful order. The three
// payload fields are mutually exclusive: a QR code, a redirect URL, or a
// scheme that opens a payment app.
type epayMapiCode struct {
	Code    int    `json:"code"`
	Msg     string `json:"msg"`
	TradeNo string `json:"trade_no"`
	QRCode  string `json:"qrcode"`
	PayURL  string `json:"payurl"`
	Scheme  string `json:"urlscheme"`
}

// requestEpayMapi asks the gateway for a payment code and returns it in the
// shape the console renders. The money value stays a string: the gateway
// compares the signed amount, and a float round trip can change it.
func requestEpayMapi(
	ctx context.Context,
	version *model.EpayEndpointVersion,
	paymentType string,
	tradeNo string,
	name string,
	money string,
	notifyURL string,
	returnURL string,
	clientIP string,
) (epayMapiCode, error) {
	ctx, cancel := context.WithTimeout(ctx, epayMapiTimeout)
	defer cancel()

	// The mapi signature is the same ASCII-sorted MD5 rule the gateway uses for
	// the hosted page, which go-epay already implements.
	signed, err := epay.GenerateParamsWithError(map[string]string{
		"pid":          version.MerchantId,
		"type":         paymentType,
		"out_trade_no": tradeNo,
		"notify_url":   notifyURL,
		"return_url":   returnURL,
		"name":         name,
		"money":        money,
		"clientip":     clientIP,
	}, version.SecretKey)
	if err != nil {
		return epayMapiCode{}, err
	}
	endpoint, err := url.Parse(strings.TrimRight(version.Address, "/") + "/mapi.php")
	if err != nil {
		return epayMapiCode{}, err
	}
	form := url.Values{}
	for key, value := range signed {
		form.Set(key, value)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return epayMapiCode{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := service.GetHttpClient().Do(req)
	if err != nil {
		return epayMapiCode{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return epayMapiCode{}, fmt.Errorf("gateway status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxEpayMapiBytes+1))
	if err != nil {
		return epayMapiCode{}, err
	}
	if len(body) > maxEpayMapiBytes {
		return epayMapiCode{}, errors.New("gateway answer is too large")
	}
	var code epayMapiCode
	if err := common.Unmarshal(body, &code); err != nil {
		return epayMapiCode{}, fmt.Errorf("gateway answer is not JSON: %w", err)
	}
	if code.Code != 1 {
		if code.Msg != "" {
			return epayMapiCode{}, errors.New(code.Msg)
		}
		return epayMapiCode{}, fmt.Errorf("gateway rejected the order (code %d)", code.Code)
	}
	if code.QRCode == "" && code.PayURL == "" && code.Scheme == "" {
		return epayMapiCode{}, errors.New("gateway returned no payment code")
	}
	return code, nil
}
