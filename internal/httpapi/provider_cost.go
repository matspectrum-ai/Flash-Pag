package httpapi

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

func providerCostMinor(providerCode string, payload json.RawMessage) (int64, bool) {
	if providerCode == "mock" {
		return 0, true
	}

	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return 0, false
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return 0, false
	}

	return findProviderCostMinor(value)
}

func findProviderCostMinor(value any) (int64, bool) {
	keys := map[string]struct{}{
		"provider_fee_minor":        {},
		"providerFeeMinor":          {},
		"providerFeeInCents":        {},
		"fee_in_cents":              {},
		"feeInCents":                {},
		"transaction_fee_in_cents":  {},
		"transactionFeeInCents":     {},
		"cost_minor":                {},
		"costInCents":               {},
	}

	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			if _, ok := keys[key]; !ok {
				continue
			}
			if cost, ok := exactMinorInteger(item); ok && cost >= 0 {
				return cost, true
			}
		}
		for _, item := range typed {
			if cost, ok := findProviderCostMinor(item); ok {
				return cost, true
			}
		}
	case []any:
		for _, item := range typed {
			if cost, ok := findProviderCostMinor(item); ok {
				return cost, true
			}
		}
	}

	return 0, false
}

func exactMinorInteger(value any) (int64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed, err == nil
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	default:
		return 0, false
	}
}
