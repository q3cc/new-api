package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateOptionValueRejectsInvalidMaxTokenAutoGroups(t *testing.T) {
	for _, value := range []string{"", "0", "-1", "1.5", "invalid"} {
		t.Run(value, func(t *testing.T) {
			assert.Error(t, validateOptionValue("MaxTokenAutoGroups", value))
		})
	}
	require.NoError(t, validateOptionValue("MaxTokenAutoGroups", "999999"))
}

// The payment path divides by QuotaPerUnit and feeds Price into a decimal,
// where a zero or non-finite value panics. Reject them where they are saved.
func TestValidateOptionValueRejectsNonFinitePaymentUnits(t *testing.T) {
	for _, value := range []string{"0", "-1", "NaN", "Inf", "-Inf", "abc", ""} {
		t.Run("QuotaPerUnit/"+value, func(t *testing.T) {
			assert.Error(t, validateOptionValue("QuotaPerUnit", value))
		})
	}
	require.NoError(t, validateOptionValue("QuotaPerUnit", "500000"))
	require.NoError(t, validateOptionValue("QuotaPerUnit", "0.5"))

	// A zero price is a valid "free" configuration; a non-finite one is not.
	require.NoError(t, validateOptionValue("Price", "0"))
	require.NoError(t, validateOptionValue("USDExchangeRate", "7.3"))
	for _, key := range []string{"Price", "USDExchangeRate"} {
		for _, value := range []string{"-1", "NaN", "Inf", "abc", ""} {
			t.Run(key+"/"+value, func(t *testing.T) {
				assert.Error(t, validateOptionValue(key, value))
			})
		}
	}
}
