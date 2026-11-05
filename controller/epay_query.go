package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// epayField accepts a gateway value sent either as a JSON string or a number;
// gateways built on the same protocol disagree on which they send.
type epayField string

func (f *epayField) UnmarshalJSON(data []byte) error {
	var text string
	if err := common.Unmarshal(data, &text); err == nil {
		*f = epayField(text)
		return nil
	}
	var number json.Number
	if err := common.Unmarshal(data, &number); err != nil {
		return err
	}
	*f = epayField(number.String())
	return nil
}

// epayOrderAnswer is the gateway's answer to api.php?act=order.
type epayOrderAnswer struct {
	Code       epayField `json:"code"`
	Msg        string    `json:"msg"`
	Pid        epayField `json:"pid"`
	OutTradeNo epayField `json:"out_trade_no"`
	Type       string    `json:"type"`
	Money      epayField `json:"money"`
	Status     epayField `json:"status"`
}

// queryEpayOrder asks the gateway whether it has received the payment for an
// order. It returns paid=false while the order is unpaid. The query carries
// the merchant key, so no error it returns includes the request URL.
func queryEpayOrder(ctx context.Context, version *model.EpayEndpointVersion, tradeNo string) (answer epayOrderAnswer, paid bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, epayMapiTimeout)
	defer cancel()
	endpoint, err := url.Parse(strings.TrimRight(version.Address, "/") + "/api.php")
	if err != nil {
		return answer, false, errors.New("invalid gateway address")
	}
	endpoint.RawQuery = url.Values{
		"act":          {"order"},
		"pid":          {version.MerchantId},
		"key":          {version.SecretKey},
		"out_trade_no": {tradeNo},
	}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return answer, false, errors.New("invalid gateway request")
	}
	resp, err := service.GetHttpClient().Do(req)
	if err != nil {
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return answer, false, fmt.Errorf("gateway request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return answer, false, fmt.Errorf("gateway status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxEpayMapiBytes+1))
	if err != nil {
		return answer, false, err
	}
	if len(body) > maxEpayMapiBytes {
		return answer, false, errors.New("gateway answer is too large")
	}
	if err := common.Unmarshal(body, &answer); err != nil {
		return answer, false, errors.New("gateway answer is not JSON")
	}
	if answer.Code != "1" {
		// Gateways answer an order they have not recorded yet as an error.
		return answer, false, nil
	}
	if string(answer.OutTradeNo) != tradeNo || (answer.Pid != "" && string(answer.Pid) != version.MerchantId) {
		return answer, false, errors.New("gateway answered for another order")
	}
	return answer, answer.Status == "1", nil
}

type epayQueryRequest struct {
	TradeNo string `json:"trade_no"`
}

// QueryEpayOrder asks the payment gateway about one of the user's own pending
// epay orders and settles it when the gateway reports it paid. It covers a
// gateway notification that never arrived.
func QueryEpayOrder(c *gin.Context) {
	var req epayQueryRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	tradeNo := strings.TrimSpace(req.TradeNo)
	if tradeNo == "" || len(tradeNo) > 255 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var userId, versionId int
	var status, provider, method string
	var createTime int64
	subscription := model.GetSubscriptionOrderByTradeNo(tradeNo)
	if subscription != nil {
		userId, versionId, status, provider, method, createTime = subscription.UserId, subscription.EpayVersionId, subscription.Status, subscription.PaymentProvider, subscription.PaymentMethod, subscription.CreateTime
	} else if topUp := model.GetTopUpByTradeNo(tradeNo); topUp != nil {
		userId, versionId, status, provider, method, createTime = topUp.UserId, topUp.EpayVersionId, topUp.Status, topUp.PaymentProvider, topUp.PaymentMethod, topUp.CreateTime
	}
	if userId == 0 || userId != c.GetInt("id") {
		common.ApiErrorT(c, "Order not found")
		return
	}
	if provider != model.PaymentProviderEpay || versionId <= 0 {
		common.ApiErrorT(c, "This order cannot be checked with the payment gateway")
		return
	}
	if status != common.TopUpStatusPending {
		common.ApiSuccess(c, gin.H{"trade_no": tradeNo, "status": status})
		return
	}
	var version model.EpayEndpointVersion
	if err := model.DB.First(&version, versionId).Error; err != nil {
		common.ApiErrorT(c, "This order cannot be checked with the payment gateway")
		return
	}
	answer, paid, err := queryEpayOrder(c.Request.Context(), &version, tradeNo)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Epay order query failed trade_no=%s error=%q", tradeNo, err.Error()))
		common.ApiErrorT(c, "Could not reach the payment gateway. Please try again later.")
		return
	}
	if !paid {
		common.ApiSuccess(c, gin.H{"trade_no": tradeNo, "status": model.EpayOrderDisplayStatus(status, provider, createTime)})
		return
	}
	paidMethod := answer.Type
	if paidMethod == "" {
		paidMethod = method
	}
	verification := model.EpayVerification{VersionId: version.Id, Method: paidMethod, Money: string(answer.Money)}
	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)
	if subscription != nil {
		err = model.CompleteSubscriptionOrder(tradeNo, "", model.PaymentProviderEpay, paidMethod, verification)
	} else {
		_, err = model.RechargeEpay(tradeNo, paidMethod, c.ClientIP(), verification)
	}
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Epay order query found a payment that could not be settled trade_no=%s error=%q", tradeNo, err.Error()))
		common.ApiErrorT(c, "The payment was found but could not be credited. Please contact support.")
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("Epay order settled by active query trade_no=%s", tradeNo))
	common.ApiSuccess(c, gin.H{"trade_no": tradeNo, "status": common.TopUpStatusSuccess})
}
