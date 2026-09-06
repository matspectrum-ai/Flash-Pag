package httpapi

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProviderCostMinorRequiresExplicitMinorUnitEvidence(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		payload  string
		want     int64
		ok       bool
	}{
		{name: "mock is zero cost", provider: "mock", payload: `null`, want: 0, ok: true},
		{name: "explicit fee in cents", provider: "pixhub", payload: `{"data":{"feeInCents":37}}`, want: 37, ok: true},
		{name: "explicit provider fee minor string", provider: "pixhub", payload: `{"provider_fee_minor":"12"}`, want: 12, ok: true},
		{name: "generic decimal fee is not trusted", provider: "pixhub", payload: `{"fee":"0.37"}`, want: 0, ok: false},
		{name: "missing evidence", provider: "pixhub", payload: `{"data":{"amount":1000}}`, want: 0, ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := providerCostMinor(tc.provider, json.RawMessage(tc.payload))
			if got != tc.want || ok != tc.ok {
				t.Fatalf("providerCostMinor() = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestAggregateAdminFinanceSeparatesTPVRevenueAndMargin(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	txs := []adminFinanceTransaction{
		{ProviderCode: "mock", Kind: "pix_in", Status: "succeeded", AmountMinor: 10000, FeeMinor: 150, CreatedAt: now},
		{ProviderCode: "mock", Kind: "pix_in", Status: "succeeded", AmountMinor: 5000, FeeMinor: 80, CreatedAt: now},
		{ProviderCode: "mock", Kind: "pix_in", Status: "pending", AmountMinor: 9000, FeeMinor: 100, CreatedAt: now},
	}
	metrics, daily := aggregateAdminFinance(txs, 30, false)
	if metrics.TPVMinor != 15000 {
		t.Fatalf("TPVMinor = %d, want 15000", metrics.TPVMinor)
	}
	if metrics.RevenueMinor != 230 {
		t.Fatalf("RevenueMinor = %d, want 230", metrics.RevenueMinor)
	}
	if metrics.ProviderCostMinor != 0 || !metrics.ProviderCostComplete {
		t.Fatalf("provider cost = %d complete=%v, want 0,true", metrics.ProviderCostMinor, metrics.ProviderCostComplete)
	}
	if metrics.MarginMinor == nil || *metrics.MarginMinor != 230 {
		t.Fatalf("MarginMinor = %v, want 230", metrics.MarginMinor)
	}
	if metrics.PendingTransactions != 1 || metrics.SucceededTransactions != 2 {
		t.Fatalf("status counts = succeeded %d pending %d", metrics.SucceededTransactions, metrics.PendingTransactions)
	}
	if len(daily) != 30 {
		t.Fatalf("daily points = %d, want 30", len(daily))
	}
}

func TestAggregateAdminFinanceWithholdsMarginWhenProviderCostIsUnknown(t *testing.T) {
	txs := []adminFinanceTransaction{{
		ProviderCode: "pixhub", Kind: "pix_in", Status: "succeeded", AmountMinor: 10000, FeeMinor: 150,
		ProviderPayload: json.RawMessage(`{"data":{"amount":10000}}`), CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}}
	metrics, _ := aggregateAdminFinance(txs, 7, false)
	if metrics.ProviderCostComplete {
		t.Fatal("ProviderCostComplete = true, want false")
	}
	if metrics.MarginMinor != nil {
		t.Fatalf("MarginMinor = %v, want nil", metrics.MarginMinor)
	}
	if metrics.ProviderCostMissingCount != 1 {
		t.Fatalf("ProviderCostMissingCount = %d, want 1", metrics.ProviderCostMissingCount)
	}
}
