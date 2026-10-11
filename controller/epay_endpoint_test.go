package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupEpayCallbackTest(t *testing.T) (*model.EpayEndpointVersion, *model.EpayEndpointVersion) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	priorRedis := common.RedisEnabled
	common.RedisEnabled = false
	prior, priorLog := model.DB, model.LOG_DB
	mainType, logType := common.MainDatabaseType(), common.LogDatabaseType()
	t.Setenv("LOG_SQL_DSN", "")
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.EpayEndpoint{}, &model.EpayEndpointVersion{}, &model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.User{}, &model.UserSubscription{}, &model.Log{}))
	require.NoError(t, model.InitLogDB())
	t.Cleanup(func() {
		common.RedisEnabled = priorRedis
		model.DB, model.LOG_DB = prior, priorLog
		common.SetDatabaseTypes(mainType, logType)
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	a := &model.EpayEndpointVersion{EndpointId: "a", Address: "https://a.example.com", MerchantId: "101", SecretKey: "a-secret"}
	b := &model.EpayEndpointVersion{EndpointId: "b", Address: "https://b.example.com", MerchantId: "102", SecretKey: "b-secret"}
	require.NoError(t, db.Create(a).Error)
	require.NoError(t, db.Create(b).Error)
	require.NoError(t, db.Create(&model.User{Id: 900, Username: "callback_user", AffCode: "callback", Group: "default", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&model.SubscriptionPlan{Id: 900, Title: "Callback Plan", PriceAmount: 9.99, DurationUnit: model.SubscriptionDurationMonth, DurationValue: 1, Enabled: true}).Error)
	model.InvalidateSubscriptionPlanCache(900)
	return a, b
}

func TestEpayCallbacksRejectCrossEndpointAndTamperedPayments(t *testing.T) {
	a, b := setupEpayCallbackTest(t)
	gin.SetMode(gin.TestMode)
	oldQuota := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuota })
	router := gin.New()
	router.GET("/wallet/:endpoint_id", EpayNotify)
	router.POST("/wallet/:endpoint_id", EpayNotify)
	router.GET("/wallet", EpayNotify)
	router.GET("/subscription/:endpoint_id", SubscriptionEpayNotify)
	router.GET("/return/:endpoint_id", SubscriptionEpayReturn)
	cases := []struct {
		name, kind, endpoint, pid, money, method string
		signer                                   *model.EpayEndpointVersion
		repeated                                 bool
	}{
		{name: "foreign endpoint signature", endpoint: "b", pid: "102", money: "10.00", method: "alipay", signer: b},
		{name: "foreign signature at correct endpoint", endpoint: "a", pid: "101", money: "10.00", method: "alipay", signer: b},
		{name: "merchant mismatch", endpoint: "a", pid: "102", money: "10.00", method: "alipay", signer: a},
		{name: "amount mismatch", endpoint: "a", pid: "101", money: "0.01", method: "alipay", signer: a},
		{name: "method mismatch", endpoint: "a", pid: "101", money: "10.00", method: "wxpay", signer: a},
		{name: "new order at legacy path", pid: "101", money: "10.00", method: "alipay", signer: a},
		{name: "duplicate signed parameter", endpoint: "a", pid: "101", money: "10.00", method: "alipay", signer: a, repeated: true},
		{name: "subscription foreign endpoint", kind: "subscription", endpoint: "b", pid: "102", money: "9.99", method: "alipay", signer: b},
		{name: "subscription browser return amount", kind: "return", endpoint: "a", pid: "101", money: "0.01", method: "alipay", signer: a},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			trade := "callback-" + strings.ReplaceAll(test.name, " ", "-")
			if test.kind == "" {
				require.NoError(t, (&model.TopUp{UserId: 900, Amount: 2, Money: 10, TradeNo: trade, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, EpayVersionId: a.Id, EpayMoney: "10.00", Status: common.TopUpStatusPending}).Insert())
			} else {
				require.NoError(t, (&model.SubscriptionOrder{UserId: 900, PlanId: 900, Money: 9.99, TradeNo: trade, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, EpayVersionId: a.Id, EpayMoney: "9.99", Status: common.TopUpStatusPending}).Insert())
			}
			params := epay.GenerateParams(map[string]string{"pid": test.pid, "out_trade_no": trade, "money": test.money, "type": test.method, "trade_status": epay.StatusTradeSuccess, "sign_type": "MD5"}, test.signer.SecretKey)
			values := url.Values{}
			for key, value := range params {
				values.Set(key, value)
			}
			if test.repeated {
				values.Add("money", "0.01")
			}
			path := "/wallet"
			if test.kind != "" {
				path = "/" + test.kind
			}
			if test.endpoint != "" {
				path += "/" + test.endpoint
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path+"?"+values.Encode(), nil))
			if test.kind == "return" {
				assert.Contains(t, recorder.Header().Get("Location"), "pay=fail")
			} else {
				assert.Equal(t, "fail", recorder.Body.String())
			}
			if test.kind == "" {
				assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo(trade).Status)
			} else {
				assert.Equal(t, common.TopUpStatusPending, model.GetSubscriptionOrderByTradeNo(trade).Status)
			}
		})
	}
	var user model.User
	require.NoError(t, model.DB.First(&user, 900).Error)
	assert.Zero(t, user.Quota)
	var subscriptions int64
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).Count(&subscriptions).Error)
	assert.Zero(t, subscriptions)

	// Correct callbacks remain valid after current configuration is absent.
	order := &model.TopUp{UserId: 900, Amount: 2, Money: 10, TradeNo: "callback-success", PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, EpayVersionId: a.Id, EpayMoney: "10.00", Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())
	values := url.Values{}
	for key, value := range epay.GenerateParams(map[string]string{"pid": "101", "out_trade_no": order.TradeNo, "money": "10.00", "type": "alipay", "trade_status": epay.StatusTradeSuccess}, a.SecretKey) {
		values.Set(key, value)
	}
	for range 2 {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/wallet/a", strings.NewReader(values.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		router.ServeHTTP(recorder, request)
		assert.Equal(t, "success", recorder.Body.String())
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/wallet/b?"+values.Encode(), nil))
	assert.Equal(t, "fail", recorder.Body.String())
	require.NoError(t, model.DB.First(&user, 900).Error)
	assert.Equal(t, 1_000_000, user.Quota)
	// Browser return and notify share the same verified, idempotent settlement.
	subOrder := &model.SubscriptionOrder{UserId: 900, PlanId: 900, Money: 9.99, TradeNo: "subscription-callback-success", PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, EpayVersionId: a.Id, EpayMoney: "9.99", Status: common.TopUpStatusPending}
	require.NoError(t, subOrder.Insert())
	subValues := url.Values{}
	for key, value := range epay.GenerateParams(map[string]string{"pid": "101", "out_trade_no": subOrder.TradeNo, "money": "9.99", "type": "alipay", "trade_status": epay.StatusTradeSuccess}, a.SecretKey) {
		subValues.Set(key, value)
	}
	returned := httptest.NewRecorder()
	router.ServeHTTP(returned, httptest.NewRequest(http.MethodGet, "/return/a?"+subValues.Encode(), nil))
	assert.Contains(t, returned.Header().Get("Location"), "pay=success")
	for range 2 {
		notified := httptest.NewRecorder()
		router.ServeHTTP(notified, httptest.NewRequest(http.MethodGet, "/subscription/a?"+subValues.Encode(), nil))
		assert.Equal(t, "success", notified.Body.String())
	}
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).Where("user_id = ?", 900).Count(&subscriptions).Error)
	assert.Equal(t, int64(1), subscriptions)
	require.NoError(t, model.DB.First(&user, 900).Error)
	assert.Equal(t, 1_000_000, user.Quota)
	foreign := httptest.NewRecorder()
	router.ServeHTTP(foreign, httptest.NewRequest(http.MethodGet, "/subscription/b?"+subValues.Encode(), nil))
	assert.Equal(t, "fail", foreign.Body.String())
}

func TestEpaySubscriptionCreationPersistsHistoryAndServerSelectedService(t *testing.T) {
	a, b := setupEpayCallbackTest(t)
	confirmPaymentComplianceForTest(t)
	previousAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://api.example.com"
	t.Cleanup(func() { system_setting.ServerAddress = previousAddress })
	require.NoError(t, model.DB.Create(&model.EpayEndpoint{Id: "a", Name: "A", Enabled: true, VersionId: a.Id}).Error)
	require.NoError(t, model.DB.Create(&model.EpayEndpoint{Id: "b", Name: "B", Enabled: true, VersionId: b.Id}).Error)
	require.NoError(t, model.DB.Create(&model.Option{Key: "PayMethods", Value: `[{"name":"Alipay","type":"alipay","epay_endpoint_id":"a"},{"name":"WeChat","type":"wxpay","epay_endpoint_id":"b"}]`}).Error)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("id", 900); c.Next() })
	router.POST("/purchase", SubscriptionRequestEpay)
	router.GET("/history", GetUserTopUps)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/purchase", strings.NewReader(`{"plan_id":900,"payment_method":"alipay","epay_endpoint_id":"b"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	var payment struct {
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
		URL     string            `json:"url"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payment))
	require.Equal(t, "success", payment.Message, response.Body.String())
	assert.Equal(t, "101", payment.Data["pid"])
	assert.Equal(t, "https://api.example.com/api/subscription/epay/a/notify", payment.Data["notify_url"])
	assert.Equal(t, "https://api.example.com/api/subscription/epay/a/return", payment.Data["return_url"])
	assert.Equal(t, "9.99", payment.Data["money"])
	assert.NotContains(t, response.Body.String(), a.SecretKey)
	order := model.GetSubscriptionOrderByTradeNo(payment.Data["out_trade_no"])
	require.NotNil(t, order)
	assert.Equal(t, a.Id, order.EpayVersionId)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	assert.Nil(t, model.GetTopUpByTradeNo(order.TradeNo), "no pending mirror is needed")
	// Independent requests represent refreshing and opening history after login.
	for range 2 {
		history := httptest.NewRecorder()
		router.ServeHTTP(history, httptest.NewRequest(http.MethodGet, "/history", nil))
		var data struct {
			Success bool `json:"success"`
			Data    struct {
				Total int                   `json:"total"`
				Items []model.BillingRecord `json:"items"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(history.Body.Bytes(), &data))
		require.True(t, data.Success, history.Body.String())
		require.Len(t, data.Data.Items, 1)
		assert.Equal(t, order.TradeNo, data.Data.Items[0].TradeNo)
		assert.Equal(t, "subscription", data.Data.Items[0].OrderType)
		assert.Equal(t, "Callback Plan", data.Data.Items[0].PlanTitle)
		assert.NotContains(t, history.Body.String(), "sign")
		assert.NotContains(t, history.Body.String(), a.SecretKey)
	}
	require.NoError(t, model.DB.Model(&model.EpayEndpoint{}).Where("id = ?", "a").Update("enabled", false).Error)
	rejected := httptest.NewRecorder()
	router.ServeHTTP(rejected, httptest.NewRequest(http.MethodPost, "/purchase", strings.NewReader(`{"plan_id":900,"payment_method":"alipay"}`)))
	assert.NotContains(t, rejected.Body.String(), `"message":"success"`)
	var count int64
	require.NoError(t, model.DB.Model(&model.SubscriptionOrder{}).Count(&count).Error)
	assert.Equal(t, int64(1), count, "disabled service cannot create another order")
}

func TestEpaySameTypeSelectionsAndOrderIsolation(t *testing.T) {
	a, b := setupEpayCallbackTest(t)
	oldOptions := common.OptionMap
	oldMethods := operation_setting.PayMethods2JsonString()
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		common.OptionMap = oldOptions
		require.NoError(t, operation_setting.UpdatePayMethodsByJsonString(oldMethods))
	})
	require.NoError(t, model.MigrateEpayEndpoints())
	confirmPaymentComplianceForTest(t)
	oldAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://api.example.com"
	t.Cleanup(func() { system_setting.ServerAddress = oldAddress })
	for _, version := range []*model.EpayEndpointVersion{a, b} {
		require.NoError(t, model.DB.Create(&model.EpayEndpoint{Id: version.EndpointId, Name: version.EndpointId, Enabled: true, VersionId: version.Id}).Error)
	}
	methods := []map[string]string{{"name": "Alipay B", "type": "alipay", "epay_endpoint_id": "b"}, {"name": "Alipay A", "type": "alipay", "epay_endpoint_id": "a"}}
	encoded, err := common.Marshal(methods)
	require.NoError(t, err)
	require.NoError(t, model.UpdateOption("PayMethods", string(encoded)))
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("id", 900); c.Next() })
	router.GET("/info", GetTopUpInfo)
	router.POST("/wallet", RequestEpay)
	router.POST("/subscription", SubscriptionRequestEpay)
	router.GET("/wallet/:endpoint_id", EpayNotify)
	router.GET("/subscription/:endpoint_id", SubscriptionEpayNotify)
	info := httptest.NewRecorder()
	router.ServeHTTP(info, httptest.NewRequest(http.MethodGet, "/info", nil))
	var listing struct {
		Data struct {
			Methods []map[string]string `json:"pay_methods"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(info.Body.Bytes(), &listing))
	require.GreaterOrEqual(t, len(listing.Data.Methods), 2)
	assert.Equal(t, "Alipay B", listing.Data.Methods[0]["name"])
	assert.NotEqual(t, listing.Data.Methods[0]["id"], listing.Data.Methods[1]["id"])
	for _, path := range []string{"/wallet", "/subscription"} {
		for _, version := range []*model.EpayEndpointVersion{a, b} {
			selection := model.EpayPaymentMethodKey(map[string]string{"type": "alipay", "epay_endpoint_id": version.EndpointId})
			body := fmt.Sprintf(`{"plan_id":900,"amount":2,"payment_method":%q,"epay_endpoint_id":"ignored"}`, selection)
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			var payment struct {
				Message string            `json:"message"`
				Data    map[string]string `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payment))
			require.Equal(t, "success", payment.Message, response.Body.String())
			assert.Equal(t, "alipay", payment.Data["type"])
			assert.Equal(t, version.MerchantId, payment.Data["pid"])
			trade := payment.Data["out_trade_no"]
			if path == "/wallet" {
				order := model.GetTopUpByTradeNo(trade)
				require.NotNil(t, order)
				assert.Equal(t, version.Id, order.EpayVersionId)
				assert.Equal(t, "alipay", order.PaymentMethod)
			} else {
				order := model.GetSubscriptionOrderByTradeNo(trade)
				require.NotNil(t, order)
				assert.Equal(t, version.Id, order.EpayVersionId)
				assert.Equal(t, "alipay", order.PaymentMethod)
			}
			for _, signer := range []*model.EpayEndpointVersion{a, b, version} {
				params := epay.GenerateParams(map[string]string{"pid": signer.MerchantId, "out_trade_no": trade, "money": payment.Data["money"], "type": "alipay", "trade_status": epay.StatusTradeSuccess, "sign_type": "MD5"}, signer.SecretKey)
				values := url.Values{}
				for key, value := range params {
					values.Set(key, value)
				}
				callback := httptest.NewRecorder()
				router.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, path+"/"+signer.EndpointId+"?"+values.Encode(), nil))
				if signer.EndpointId == version.EndpointId {
					assert.Equal(t, "success", callback.Body.String())
				} else {
					assert.Equal(t, "fail", callback.Body.String())
				}
			}
		}
	}
	for _, path := range []string{"/wallet", "/subscription"} {
		rejected := httptest.NewRecorder()
		router.ServeHTTP(rejected, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"amount":2,"plan_id":900,"payment_method":"alipay"}`)))
		assert.NotContains(t, rejected.Body.String(), `"message":"success"`)
	}
}
