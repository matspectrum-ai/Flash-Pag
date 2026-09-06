package httpapi

import "testing"

func int64ptr(v int64) *int64 { return &v }

func TestValidatePricingRule(t *testing.T) {
	valid := pricingRuleInput{FixedMinor: 50, PercentBPS: 125, MinFeeMinor: int64ptr(10), MaxFeeMinor: int64ptr(500)}
	if message := validatePricingRule(valid); message != "" {
		t.Fatalf("valid rule rejected: %s", message)
	}

	cases := []pricingRuleInput{
		{FixedMinor: -1},
		{PercentBPS: -1},
		{PercentBPS: 10001},
		{MinFeeMinor: int64ptr(-1)},
		{MaxFeeMinor: int64ptr(-1)},
		{MinFeeMinor: int64ptr(200), MaxFeeMinor: int64ptr(100)},
	}
	for i, rule := range cases {
		if message := validatePricingRule(rule); message == "" {
			t.Fatalf("case %d should be rejected", i)
		}
	}
}

func TestValidatePricingInputRequiresCompleteOperations(t *testing.T) {
	zero := pricingRuleInput{}
	valid := adminPricingInput{Rules: map[string]pricingRuleInput{
		"pix_in": zero, "transfer": zero, "withdrawal": zero,
	}}
	if message := validatePricingInput(valid); message != "" {
		t.Fatalf("complete pricing rejected: %s", message)
	}

	missing := adminPricingInput{Rules: map[string]pricingRuleInput{"pix_in": zero, "transfer": zero}}
	if message := validatePricingInput(missing); message == "" {
		t.Fatal("missing operation should be rejected")
	}

	extra := adminPricingInput{Rules: map[string]pricingRuleInput{
		"pix_in": zero, "transfer": zero, "withdrawal": zero, "refund": zero,
	}}
	if message := validatePricingInput(extra); message == "" {
		t.Fatal("unsupported operation should be rejected")
	}
}
