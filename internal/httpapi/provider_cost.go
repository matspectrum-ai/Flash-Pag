package httpapi

import "encoding/json"

// providerCostMinor returns the actual provider cost only when Flash Pag has a
// verified provider-specific contract for that value. Never infer cost from
// generic fields in raw provider payloads: a plausible-looking `fee` can refer
// to a customer charge, tax, settlement adjustment, or another unit entirely.
func providerCostMinor(providerCode string, _ json.RawMessage) (int64, bool) {
	switch providerCode {
	case "mock":
		// The deterministic development adapter never moves real money and has no
		// external processing cost by definition.
		return 0, true
	default:
		// No live provider currently has a verified provider-cost contract in the
		// repository. Keep cost unknown until the adapter normalizes a documented
		// cost field with explicit integer-minor semantics.
		return 0, false
	}
}
