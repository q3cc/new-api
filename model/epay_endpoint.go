package model

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const epayConfigLockKey = "EpayEndpointsMigrated"

var epayConfigMutex sync.Mutex
var epayEndpointIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// MySQL option keys can compare equal despite differences in case, accents or
// trailing spaces. Such aliases must not bypass the canonical write handlers.
func rejectEpayOptionAlias(key string) error {
	controlled := []string{"PayMethods", "PayAddress", "EpayId", "EpayKey", epayConfigLockKey}
	for _, canonical := range controlled {
		if key != canonical && strings.EqualFold(strings.TrimSpace(key), canonical) {
			return errors.New("支付配置键无效")
		}
	}
	if !common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return nil
	}
	var stored Option
	if err := DB.Select(commonKeyCol).Where(commonKeyCol+" = ?", key).Find(&stored).Error; err != nil {
		return err
	}
	if stored.Key != key && slices.Contains(controlled, stored.Key) {
		return errors.New("支付配置键无效")
	}
	return nil
}

type EpayEndpoint struct {
	Id        string `json:"id" gorm:"primaryKey;size:64"`
	Name      string `json:"name" gorm:"size:128"`
	Enabled   bool   `json:"enabled"`
	VersionId int    `json:"-"`
}

type EpayEndpointVersion struct {
	Id         int    `json:"-"`
	EndpointId string `json:"-" gorm:"size:64;index"`
	Address    string `json:"-" gorm:"size:2048"`
	MerchantId string `json:"-" gorm:"size:128"`
	SecretKey  string `json:"-" gorm:"type:text"`
}

type EpayEndpointConfig struct {
	Id         string  `json:"id"`
	Name       string  `json:"name"`
	Enabled    bool    `json:"enabled"`
	Address    string  `json:"address"`
	MerchantId string  `json:"merchant_id"`
	Key        *string `json:"key,omitempty"`
	HasKey     bool    `json:"has_key"`
}

type EpayConfig struct {
	Endpoints  []EpayEndpointConfig `json:"endpoints"`
	PayMethods []map[string]string  `json:"pay_methods"`
}

func IsEpayPaymentMethod(method string) bool {
	return method != "" && !slices.Contains([]string{PaymentMethodStripe, PaymentMethodCreem, PaymentMethodWaffo, PaymentMethodWaffoPancake, PaymentMethodBalance}, method)
}

func epayConfigLock(tx *gorm.DB) error {
	var option Option
	return lockForUpdate(tx).Where(commonKeyCol+" = ?", epayConfigLockKey).First(&option).Error
}

func MigrateEpayEndpoints() error {
	return DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		marker := Option{Key: epayConfigLockKey}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&marker).Error; err != nil {
			return err
		}
		if err := epayConfigLock(tx); err != nil {
			return err
		}
		if err := tx.Where(commonKeyCol+" = ?", epayConfigLockKey).First(&marker).Error; err != nil {
			return err
		}
		if marker.Value == "1" {
			return nil
		}
		var options []Option
		if err := tx.Where(commonKeyCol+" IN ?", []string{"PayAddress", "EpayId", "EpayKey", "PayMethods"}).Find(&options).Error; err != nil {
			return err
		}
		values := map[string]string{}
		for _, option := range options {
			values[option.Key] = strings.TrimSpace(option.Value)
		}
		if values["PayAddress"] != "" && values["EpayId"] != "" && values["EpayKey"] != "" {
			version := EpayEndpointVersion{EndpointId: "legacy", Address: values["PayAddress"], MerchantId: values["EpayId"], SecretKey: values["EpayKey"]}
			if err := tx.Create(&version).Error; err != nil {
				return err
			}
			if err := tx.Create(&EpayEndpoint{Id: "legacy", Name: "Default", Enabled: true, VersionId: version.Id}).Error; err != nil {
				return err
			}
			methods := []map[string]string{}
			if err := common.UnmarshalJsonStr(operation_setting.PayMethods2JsonString(), &methods); err != nil {
				return err
			}
			if values["PayMethods"] != "" {
				if err := common.UnmarshalJsonStr(values["PayMethods"], &methods); err != nil {
					return err
				}
			}
			for _, method := range methods {
				if IsEpayPaymentMethod(method["type"]) {
					method["epay_endpoint_id"] = "legacy"
				}
			}
			encoded, err := common.Marshal(methods)
			if err != nil {
				return err
			}
			if err := tx.Save(&Option{Key: "PayMethods", Value: string(encoded)}).Error; err != nil {
				return err
			}
			for _, order := range []any{&TopUp{}, &SubscriptionOrder{}} {
				if err := tx.Model(order).Where("(payment_provider = ? OR ((payment_provider IS NULL OR payment_provider = '') AND payment_method <> '' AND payment_method NOT IN ?)) AND (epay_version_id IS NULL OR epay_version_id = 0)", PaymentProviderEpay, []string{PaymentMethodStripe, PaymentMethodCreem, PaymentMethodWaffo, PaymentMethodWaffoPancake, PaymentMethodBalance}).
					Updates(map[string]any{"epay_version_id": version.Id, "legacy_epay_callback": true, "payment_provider": PaymentProviderEpay}).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&marker).Update("value", "1").Error
	})
}

func GetEpayConfig() (config EpayConfig, err error) {
	config.Endpoints = []EpayEndpointConfig{}
	config.PayMethods = []map[string]string{}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var endpoints []EpayEndpoint
		if err := tx.Order("id ASC").Find(&endpoints).Error; err != nil {
			return err
		}
		for _, endpoint := range endpoints {
			var version EpayEndpointVersion
			if err := tx.First(&version, endpoint.VersionId).Error; err != nil {
				return err
			}
			config.Endpoints = append(config.Endpoints, EpayEndpointConfig{Id: endpoint.Id, Name: endpoint.Name, Enabled: endpoint.Enabled, Address: version.Address, MerchantId: version.MerchantId, HasKey: version.SecretKey != ""})
		}
		var option Option
		if err := tx.Where(commonKeyCol+" = ?", "PayMethods").First(&option).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		return common.UnmarshalJsonStr(option.Value, &config.PayMethods)
	})
	return
}

func validateEpayMethods(tx *gorm.DB, methods []map[string]string) error {
	if len(methods) > 100 {
		return errors.New("支付方式过多")
	}
	seen := map[string]bool{}
	for _, method := range methods {
		paymentType := method["type"]
		if paymentType == "" || len(paymentType) > 50 || strings.TrimSpace(method["name"]) == "" || seen[paymentType] {
			return errors.New("支付方式名称和类型必须有效，类型不能重复")
		}
		seen[paymentType] = true
		if !IsEpayPaymentMethod(paymentType) {
			if method["epay_endpoint_id"] != "" {
				return errors.New("该支付方式不能绑定易支付服务")
			}
			continue
		}
		var endpoint EpayEndpoint
		if err := tx.Where("id = ?", method["epay_endpoint_id"]).First(&endpoint).Error; err != nil {
			return errors.New("请选择有效的易支付服务")
		}
	}
	return nil
}

func SaveEpayConfig(config EpayConfig) error {
	epayConfigMutex.Lock()
	defer epayConfigMutex.Unlock()
	if len(config.Endpoints) > 100 {
		return errors.New("支付服务过多")
	}
	var encoded []byte
	err := DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		if err := epayConfigLock(tx); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, input := range config.Endpoints {
			if !epayEndpointIDPattern.MatchString(input.Id) || seen[input.Id] {
				return errors.New("支付服务标识无效或重复")
			}
			seen[input.Id] = true
			name := strings.TrimSpace(input.Name)
			address := strings.TrimRight(strings.TrimSpace(input.Address), "/")
			merchant := strings.TrimSpace(input.MerchantId)
			u, err := url.Parse(address)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(address) > 2048 || name == "" || len(name) > 128 || merchant == "" || len(merchant) > 128 {
				return errors.New("支付服务名称、地址或商户号无效")
			}
			var endpoint EpayEndpoint
			err = tx.Where("id = ?", input.Id).First(&endpoint).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if endpoint.Id != "" && endpoint.Id != input.Id {
				return errors.New("支付服务标识不可修改")
			}
			version := EpayEndpointVersion{EndpointId: input.Id}
			if endpoint.VersionId != 0 {
				if err := tx.First(&version, endpoint.VersionId).Error; err != nil {
					return err
				}
			}
			key := version.SecretKey
			if input.Key != nil {
				key = strings.TrimSpace(*input.Key)
			}
			if key == "" || len(key) > 4096 {
				return errors.New("支付密钥不能为空或过长")
			}
			var reused int64
			if err := tx.Model(&EpayEndpointVersion{}).Where("endpoint_id <> ? AND secret_key = ?", input.Id, key).Count(&reused).Error; err != nil {
				return err
			}
			if reused != 0 {
				return errors.New("不同支付服务必须使用独立密钥")
			}
			if version.Id == 0 || version.Address != address || version.MerchantId != merchant || version.SecretKey != key {
				version = EpayEndpointVersion{EndpointId: input.Id, Address: address, MerchantId: merchant, SecretKey: key}
				if err := tx.Create(&version).Error; err != nil {
					return err
				}
			}
			endpoint = EpayEndpoint{Id: input.Id, Name: name, Enabled: input.Enabled, VersionId: version.Id}
			if err := tx.Save(&endpoint).Error; err != nil {
				return err
			}
		}
		var endpoints []EpayEndpoint
		if err := tx.Find(&endpoints).Error; err != nil {
			return err
		}
		for _, endpoint := range endpoints {
			if !seen[endpoint.Id] {
				if err := tx.Model(&endpoint).Update("enabled", false).Error; err != nil {
					return err
				}
			}
		}
		if err := validateEpayMethods(tx, config.PayMethods); err != nil {
			return err
		}
		var err error
		encoded, err = common.Marshal(config.PayMethods)
		if err != nil {
			return err
		}
		return tx.Save(&Option{Key: "PayMethods", Value: string(encoded)}).Error
	})
	if err != nil {
		return err
	}
	return updateOptionMap("PayMethods", string(encoded))
}

func UpdateEpayPaymentMethods(value string) error {
	epayConfigMutex.Lock()
	defer epayConfigMutex.Unlock()
	var methods []map[string]string
	if err := common.UnmarshalJsonStr(value, &methods); err != nil {
		return err
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		if err := epayConfigLock(tx); err != nil {
			return err
		}
		if err := validateEpayMethods(tx, methods); err != nil {
			return err
		}
		return tx.Save(&Option{Key: "PayMethods", Value: value}).Error
	}); err != nil {
		return err
	}
	return updateOptionMap("PayMethods", value)
}

func ResolveEpayPaymentMethod(method string) (*EpayEndpointVersion, error) {
	if !IsEpayPaymentMethod(method) {
		return nil, ErrPaymentMethodMismatch
	}
	var version EpayEndpointVersion
	err := DB.Transaction(func(tx *gorm.DB) error {
		var option Option
		if err := tx.Where(commonKeyCol+" = ?", "PayMethods").First(&option).Error; err != nil {
			return err
		}
		var methods []map[string]string
		if err := common.UnmarshalJsonStr(option.Value, &methods); err != nil {
			return err
		}
		for _, candidate := range methods {
			if candidate["type"] != method {
				continue
			}
			var endpoint EpayEndpoint
			if err := tx.Where("id = ? AND enabled = ?", candidate["epay_endpoint_id"], true).First(&endpoint).Error; err != nil {
				return errors.New("支付服务不可用")
			}
			return tx.Where("id = ? AND endpoint_id = ?", endpoint.VersionId, endpoint.Id).First(&version).Error
		}
		return errors.New("支付方式不存在")
	})
	return &version, err
}

// EpayVerification carries verified order identity into the settlement transaction.
type EpayVerification struct {
	VersionId int
	Method    string
	Money     string
}

func validateEpaySettlement(versionId int, method string, money float64, payMoney string, verification []EpayVerification) error {
	if versionId <= 0 || len(verification) != 1 || verification[0].VersionId != versionId || verification[0].Method != method {
		return ErrPaymentMethodMismatch
	}
	expected := payMoney
	if expected == "" {
		expected = strconv.FormatFloat(money, 'f', 2, 64)
	}
	amount, err := decimal.NewFromString(verification[0].Money)
	if err != nil || amount.Sign() <= 0 {
		return errors.New("支付金额无效")
	}
	want, err := decimal.NewFromString(expected)
	if err != nil || !amount.Equal(want) {
		return errors.New("支付金额不匹配")
	}
	return nil
}

func GetEpayOrderVersion(tradeNo string, endpointId string, subscription bool) (*EpayEndpointVersion, error) {
	var versionId int
	var provider string
	var legacy bool
	if subscription {
		order := GetSubscriptionOrderByTradeNo(tradeNo)
		if order == nil {
			return nil, ErrSubscriptionOrderNotFound
		}
		versionId, provider, legacy = order.EpayVersionId, order.PaymentProvider, order.LegacyEpayCallback
	} else {
		order := GetTopUpByTradeNo(tradeNo)
		if order == nil {
			return nil, ErrTopUpNotFound
		}
		// A subscription mirror must never be handled as a wallet recharge.
		if GetSubscriptionOrderByTradeNo(tradeNo) != nil {
			return nil, ErrPaymentMethodMismatch
		}
		versionId, provider, legacy = order.EpayVersionId, order.PaymentProvider, order.LegacyEpayCallback
	}
	if provider != PaymentProviderEpay || versionId <= 0 || (endpointId == "" && !legacy) {
		return nil, ErrPaymentMethodMismatch
	}
	var version EpayEndpointVersion
	if err := DB.First(&version, versionId).Error; err != nil {
		return nil, err
	}
	if endpointId != "" && version.EndpointId != endpointId {
		return nil, ErrPaymentMethodMismatch
	}
	if endpointId == "" && version.EndpointId != "legacy" {
		return nil, ErrPaymentMethodMismatch
	}
	return &version, nil
}

func EpayCallbackPath(version *EpayEndpointVersion, subscription bool, action string) string {
	if subscription {
		return fmt.Sprintf("/api/subscription/epay/%s/%s", version.EndpointId, action)
	}
	return fmt.Sprintf("/api/user/epay/%s/%s", version.EndpointId, action)
}
