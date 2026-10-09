package controller

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type SubscriptionEpayPayRequest struct {
	PlanId        int    `json:"plan_id"`
	PaymentMethod string `json:"payment_method"`
}

func SubscriptionRequestEpay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req SubscriptionEpayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	version, err := model.ResolveEpayPaymentMethod(req.PaymentMethod)
	if err != nil {
		common.ApiErrorMsg(c, "支付服务不可用")
		return
	}
	callBackAddress := service.GetCallbackAddress()
	returnUrl, err := url.Parse(callBackAddress + model.EpayCallbackPath(version, true, "return"))
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}
	notifyUrl, err := url.Parse(callBackAddress + model.EpayCallbackPath(version, true, "notify"))
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}

	tradeNo := fmt.Sprintf("%s%d", common.GetRandomString(6), time.Now().Unix())
	tradeNo = fmt.Sprintf("SUBUSR%dNO%s", userId, tradeNo)

	client, clientErr := epayClientForVersion(version)
	if clientErr != nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return
	}

	order := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           plan.PriceAmount,
		TradeNo:         tradeNo,
		PaymentMethod:   req.PaymentMethod,
		PaymentProvider: model.PaymentProviderEpay,
		EpayVersionId:   version.Id,
		EpayMoney:       strconv.FormatFloat(plan.PriceAmount, 'f', 2, 64),
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           req.PaymentMethod,
		ServiceTradeNo: tradeNo,
		Name:           fmt.Sprintf("SUB:%s", plan.Title),
		Money:          order.EpayMoney,
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderEpay)
		common.ApiErrorMsg(c, "拉起支付失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": params, "url": uri})
}

func SubscriptionEpayNotify(c *gin.Context) {
	info, verification, err := verifyEpayCallback(c, true)
	if err != nil {
		logEpayCallbackFailure(c, err)
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	if info.TradeStatus != epay.StatusTradeSuccess {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	LockOrder(info.ServiceTradeNo)
	defer UnlockOrder(info.ServiceTradeNo)
	if err := model.CompleteSubscriptionOrder(info.ServiceTradeNo, "", model.PaymentProviderEpay, info.Type, verification); err != nil {
		logEpayCallbackFailure(c, err)
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	_, _ = c.Writer.Write([]byte("success"))
}

func SubscriptionEpayReturn(c *gin.Context) {
	info, verification, err := verifyEpayCallback(c, true)
	if err != nil {
		logEpayCallbackFailure(c, err)
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
		return
	}
	if info.TradeStatus != epay.StatusTradeSuccess {
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=pending"))
		return
	}
	LockOrder(info.ServiceTradeNo)
	defer UnlockOrder(info.ServiceTradeNo)
	if err := model.CompleteSubscriptionOrder(info.ServiceTradeNo, "", model.PaymentProviderEpay, info.Type, verification); err != nil {
		logEpayCallbackFailure(c, err)
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
		return
	}
	c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=success"))
}
