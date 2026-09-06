package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

type pricingRuleInput struct {
	FixedMinor  int64  `json:"fixed_minor"`
	PercentBPS  int    `json:"percent_bps"`
	MinFeeMinor *int64 `json:"min_fee_minor"`
	MaxFeeMinor *int64 `json:"max_fee_minor"`
}

type adminPricingInput struct {
	Note  string                      `json:"note,omitempty"`
	Rules map[string]pricingRuleInput `json:"rules"`
}

func validatePricingRule(rule pricingRuleInput) string {
	if rule.FixedMinor < 0 {
		return "fixed_minor must be >= 0"
	}
	if rule.PercentBPS < 0 || rule.PercentBPS > 10000 {
		return "percent_bps must be between 0 and 10000"
	}
	if rule.MinFeeMinor != nil && *rule.MinFeeMinor < 0 {
		return "min_fee_minor must be >= 0"
	}
	if rule.MaxFeeMinor != nil && *rule.MaxFeeMinor < 0 {
		return "max_fee_minor must be >= 0"
	}
	if rule.MinFeeMinor != nil && rule.MaxFeeMinor != nil && *rule.MinFeeMinor > *rule.MaxFeeMinor {
		return "min_fee_minor cannot exceed max_fee_minor"
	}
	return ""
}

func validatePricingInput(in adminPricingInput) string {
	if len(in.Rules) != 3 {
		return "rules must define exactly pix_in, transfer and withdrawal"
	}
	for _, operation := range []string{"pix_in", "transfer", "withdrawal"} {
		rule, ok := in.Rules[operation]
		if !ok {
			return "missing pricing rule for " + operation
		}
		if message := validatePricingRule(rule); message != "" {
			return operation + ": " + message
		}
	}
	for operation := range in.Rules {
		if operation != "pix_in" && operation != "transfer" && operation != "withdrawal" {
			return "unsupported pricing operation " + operation
		}
	}
	return ""
}

func (s *Server) adminPricingDetail(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	if merchantID == "" {
		writeError(w, http.StatusBadRequest, "merchant_required", "merchant id is required")
		return
	}
	var detail map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/merchant_pricing_detail", nil, map[string]any{"p_merchant_id": merchantID}, "", &detail); err != nil {
		writeError(w, http.StatusInternalServerError, "pricing_load_failed", "merchant pricing could not be loaded")
		return
	}
	if detail == nil || detail["merchant"] == nil {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant not found")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) adminSetPricing(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	if merchantID == "" {
		writeError(w, http.StatusBadRequest, "merchant_required", "merchant id is required")
		return
	}
	var in adminPricingInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if message := validatePricingInput(in); message != "" {
		writeError(w, http.StatusUnprocessableEntity, "pricing_invalid", message)
		return
	}

	var detail map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/set_merchant_pricing", nil, map[string]any{
		"p_merchant_id": merchantID,
		"p_created_by":  consoleP(r.Context()).UserID,
		"p_rules":       in.Rules,
		"p_note":        strings.TrimSpace(in.Note),
	}, "", &detail); err != nil {
		writeError(w, http.StatusConflict, "pricing_update_failed", "a new pricing version could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, detail)
}

// Transactions are exposed through an exact route so fee/pricing fields can evolve
// without coupling the merchant UI to the legacy generic console resource map.
func (s *Server) consolePricedTransactions(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsole(r)
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "select an organization you can access")
		return
	}
	q := url.Values{
		"organization_id": {"eq." + orgID},
		"select":          {"id,account_id,customer_id,provider_connection_id,provider_code,provider_external_id,kind,direction,status,amount_minor,fee_minor,pricing_version_id,pricing_version,currency,description,pix_key,failure_code,failure_message,created_at,updated_at"},
		"order":           {"created_at.desc"},
		"limit":           {"100"},
	}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/transactions", q, nil, "", &rows); err != nil {
		writeError(w, http.StatusInternalServerError, "database_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}
