package httpapi

import (
	"encoding/json"
	"testing"
)

func TestProviderCostMinorRequiresVerifiedProviderContract(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		payload  string
		want     int64
		known    bool
	}{
		{name: "mock is known zero cost", provider: "mock", payload: `null`, want: 0, known: true},
		{name: "pixhub generic fee in cents is not a verified cost contract", provider: "pixhub", payload: `{"data":{"feeInCents":37}}`, want: 0, known: false},
		{name: "pixhub provider fee looking field remains unverified", provider: "pixhub", payload: `{"provider_fee_minor":"12"}`, want: 0, known: false},
		{name: "pixhub generic decimal fee is ignored", provider: "pixhub", payload: `{"fee":"0.37"}`, want: 0, known: false},
		{name: "unknown provider stays unknown", provider: "other", payload: `{"costInCents":10}`, want: 0, known: false},
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
