package httpapi

import (
	"encoding/json"
	"testing"
)

func TestProviderCostMinorRequiresExplicitMinorUnitEvidence(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		payload  string
		want     int64
		known    bool
	}{
		{name: "mock", provider: "mock", payload: `null`, want: 0, known: true},
		{name: "fee in cents", provider: "pixhub", payload: `{"data":{"feeInCents":37}}`, want: 37, known: true},
		{name: "provider fee minor string", provider: "pixhub", payload: `{"provider_fee_minor":"12"}`, want: 12, known: true},
		{name: "generic decimal fee is ignored", provider: "pixhub", payload: `{"fee":"0.37"}`, want: 0, known: false},
		{name: "missing cost", provider: "pixhub", payload: `{"data":{"amount":1000}}`, want: 0, known: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, known := providerCostMinor(test.provider, json.RawMessage(test.payload))
			if got != test.want || known != test.known {
				t.Fatalf("providerCostMinor() = (%d, %v), want (%d, %v)", got, known, test.want, test.known)
			}
		})
	}
}
