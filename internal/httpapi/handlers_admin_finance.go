package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const adminFinanceMaxTransactions = 5000

type adminFinanceTransaction struct {
	ID                   string          `json:"id"`
	OrganizationID       string          `json:"organization_id"`
	AccountID            string          `json:"account_id"`
	CustomerID           *string         `json:"customer_id"`
	ProviderConnectionID *string         `json:"provider_connection_id"`
	ProviderCode         string          `json:"provider_code"`
	ProviderExternalID   *string         `json:"provider_external_id"`
	Kind                 string          `json:"kind"`
	Direction            string          `json:"direction"`
	Status               string          `json:"status"`
	AmountMinor          int64           `json:"amount_minor"`
	FeeMinor             int64           `json:"fee_minor"`
	Currency             string          `json:"currency"`
	Description          string          `json:"description"`
	ProviderPayload      json.RawMessage `json:"provider_payload"`
	CreatedAt            string          `json:"created_at"`
	UpdatedAt            string          `json:"updated_at"`
}

type adminFinanceMetrics struct {
	PeriodDays                  int    `json:"period_days"`
	TPVMinor                    int64  `json:"tpv_minor"`
	RevenueMinor                int64  `json:"revenue_minor"`
	ProviderCostMinor           int64  `json:"provider_cost_minor"`
	ProviderCostComplete        bool   `json:"provider_cost_complete"`
	ProviderCostKnownCount      int    `json:"provider_cost_known_count"`
	ProviderCostMissingCount    int    `json:"provider_cost_missing_count"`
	MarginMinor                 *int64 `json:"margin_minor"`
	SucceededTransactions       int    `json:"succeeded_transactions"`
	PendingTransactions         int    `json:"pending_transactions"`
	FailedTransactions          int    `json:"failed_transactions"`
	AmbiguousTransactions       int    `json:"ambiguous_transactions"`
	AverageTicketMinor          int64  `json:"average_ticket_minor"`
	TransactionWindowWasLimited bool   `json:"transaction_window_was_limited"`
}

type adminFinanceDailyPoint struct {
	Date             string `json:"date"`
	TPVMinor         int64  `json:"tpv_minor"`
	RevenueMinor     int64  `json:"revenue_minor"`
	TransactionCount int    `json:"transaction_count"`
}

type adminMerchantSummary struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Status            string `json:"status"`
	CreatedAt         string `json:"created_at"`
	OrganizationCount int    `json:"organization_count"`
	TPVMinor          int64  `json:"tpv_minor"`
	RevenueMinor      int64  `json:"revenue_minor"`
	SucceededCount    int    `json:"succeeded_count"`
}

type adminTransactionView struct {
	ID                 string `json:"id"`
	MerchantID         string `json:"merchant_id"`
	MerchantName       string `json:"merchant_name"`
	OrganizationID     string `json:"organization_id"`
	OrganizationName   string `json:"organization_name"`
	ProviderCode       string `json:"provider_code"`
	ProviderExternalID string `json:"provider_external_id,omitempty"`
	Status             string `json:"status"`
	AmountMinor        int64  `json:"amount_minor"`
	FeeMinor           int64  `json:"fee_minor"`
	ProviderCostMinor  *int64 `json:"provider_cost_minor"`
	MarginMinor        *int64 `json:"margin_minor"`
	Currency           string `json:"currency"`
	Description        string `json:"description,omitempty"`
	CreatedAt          string `json:"created_at"`
}

type adminOrganization360 struct {
	ID                  string                   `json:"id"`
	Name                string                   `json:"name"`
	Slug                string                   `json:"slug"`
	Status              string                   `json:"status"`
	CreatedAt           string                   `json:"created_at"`
	Accounts            []map[string]any         `json:"accounts"`
	CustomerCount       int                      `json:"customer_count"`
	Connections         []map[string]any         `json:"connections"`
	RecentTransactions  []adminTransactionView   `json:"recent_transactions"`
}

func (s *Server) adminFinanceDashboard(w http.ResponseWriter, r *http.Request) {
	days := adminPeriodDays(r.URL.Query().Get("days"))
	merchants, orgs, err := s.adminTenantRows(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "admin_finance_load_failed", "platform tenants could not be loaded")
		return
	}

	txs, limited, err := s.loadAdminPixIn(r, days, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "admin_finance_load_failed", "platform transactions could not be loaded")
		return
	}

	metrics, daily := aggregateAdminFinance(txs, days, limited)
	merchantNames := make(map[string]string, len(merchants))
	merchantSummary := make(map[string]*adminMerchantSummary, len(merchants))
	for _, merchant := range merchants {
		id, _ := merchant["id"].(string)
		name, _ := merchant["name"].(string)
		status, _ := merchant["status"].(string)
		createdAt, _ := merchant["created_at"].(string)
		merchantNames[id] = name
		merchantSummary[id] = &adminMerchantSummary{ID: id, Name: name, Status: status, CreatedAt: createdAt}
	}
	orgNames := make(map[string]string, len(orgs))
	orgMerchant := make(map[string]string, len(orgs))
	for _, org := range orgs {
		id, _ := org["id"].(string)
		merchantID, _ := org["merchant_id"].(string)
		name, _ := org["name"].(string)
		orgNames[id] = name
		orgMerchant[id] = merchantID
		if summary := merchantSummary[merchantID]; summary != nil {
			summary.OrganizationCount++
		}
	}

	transactions := make([]adminTransactionView, 0, minInt(len(txs), 200))
	for _, tx := range txs {
		merchantID := orgMerchant[tx.OrganizationID]
		if tx.Status == "succeeded" {
			if summary := merchantSummary[merchantID]; summary != nil {
				summary.TPVMinor += tx.AmountMinor
				summary.RevenueMinor += tx.FeeMinor
				summary.SucceededCount++
			}
		}
		if len(transactions) < 200 {
			transactions = append(transactions, adminTransactionForView(tx, merchantID, merchantNames[merchantID], orgNames[tx.OrganizationID]))
		}
	}

	merchantList := make([]adminMerchantSummary, 0, len(merchantSummary))
	for _, summary := range merchantSummary {
		merchantList = append(merchantList, *summary)
	}
	sort.Slice(merchantList, func(i, j int) bool {
		if merchantList[i].TPVMinor == merchantList[j].TPVMinor {
			return merchantList[i].Name < merchantList[j].Name
		}
		return merchantList[i].TPVMinor > merchantList[j].TPVMinor
	})

	activeMerchants := 0
	for _, merchant := range merchants {
		if merchant["status"] == "active" {
			activeMerchants++
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"period_days":      days,
		"merchant_count":   len(merchants),
		"active_merchants": activeMerchants,
		"organization_count": len(orgs),
		"metrics":          metrics,
		"daily":            daily,
		"merchants":        merchantList,
		"transactions":     transactions,
	})
}

func (s *Server) adminMerchant360(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	if merchantID == "" {
		writeError(w, http.StatusBadRequest, "merchant_required", "merchant id is required")
		return
	}
	days := adminPeriodDays(r.URL.Query().Get("days"))

	var merchants []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchants", url.Values{
		"id": {"eq." + merchantID}, "select": {"id,name,status,created_at"}, "limit": {"1"},
	}, nil, "", &merchants); err != nil || len(merchants) != 1 {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant not found")
		return
	}
	merchantName, _ := merchants[0]["name"].(string)

	var orgRows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/organizations", url.Values{
		"merchant_id": {"eq." + merchantID}, "select": {"id,merchant_id,name,slug,status,created_at"}, "order": {"created_at.asc"}, "limit": {"500"},
	}, nil, "", &orgRows); err != nil {
		writeError(w, http.StatusInternalServerError, "merchant_organizations_load_failed", "merchant organizations could not be loaded")
		return
	}
	orgIDs := make([]string, 0, len(orgRows))
	orgNames := make(map[string]string, len(orgRows))
	for _, org := range orgRows {
		id, _ := org["id"].(string)
		name, _ := org["name"].(string)
		orgIDs = append(orgIDs, id)
		orgNames[id] = name
	}

	txs, limited, err := s.loadAdminPixIn(r, days, orgIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "merchant_finance_load_failed", "merchant transactions could not be loaded")
		return
	}
	metrics, daily := aggregateAdminFinance(txs, days, limited)

	var kyc map[string]any
	_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_profiles", url.Values{
		"merchant_id": {"eq." + merchantID}, "select": {"merchant_id,status,legal_name,trade_name,tax_id,company_email,company_phone,city,state,country,public_note,created_at,updated_at,submitted_at,reviewed_at,approved_at,rejected_at"}, "limit": {"1"},
	}, nil, "", &[]map[string]any{})
	var kycRows []map[string]any
	if s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_profiles", url.Values{
		"merchant_id": {"eq." + merchantID}, "select": {"merchant_id,status,legal_name,trade_name,tax_id,company_email,company_phone,city,state,country,public_note,created_at,updated_at,submitted_at,reviewed_at,approved_at,rejected_at"}, "limit": {"1"},
	}, nil, "", &kycRows) == nil && len(kycRows) == 1 {
		kyc = kycRows[0]
	}

	var pricing map[string]any
	_ = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/merchant_pricing_detail", nil, map[string]any{"p_merchant_id": merchantID}, "", &pricing)

	var members []consoleMember
	if len(orgIDs) > 0 {
		members, _ = s.membersForOrganization(r.Context(), orgIDs[0])
	}

	txsByOrg := make(map[string][]adminTransactionView, len(orgIDs))
	for _, tx := range txs {
		if len(txsByOrg[tx.OrganizationID]) >= 20 {
			continue
		}
		txsByOrg[tx.OrganizationID] = append(txsByOrg[tx.OrganizationID], adminTransactionForView(tx, merchantID, merchantName, orgNames[tx.OrganizationID]))
	}

	organizations := make([]adminOrganization360, 0, len(orgRows))
	for _, org := range orgRows {
		orgID, _ := org["id"].(string)
		name, _ := org["name"].(string)
		slug, _ := org["slug"].(string)
		status, _ := org["status"].(string)
		createdAt, _ := org["created_at"].(string)

		var accounts []map[string]any
		_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/accounts", url.Values{
			"organization_id": {"eq." + orgID}, "select": {"id,name,currency,status,is_default,created_at"}, "order": {"created_at.asc"}, "limit": {"100"},
		}, nil, "", &accounts)
		for _, account := range accounts {
			accountID, _ := account["id"].(string)
			var balance map[string]any
			if accountID != "" && s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/account_balance", nil, map[string]any{"p_organization_id": orgID, "p_account_id": accountID}, "", &balance) == nil {
				account["balance"] = balance
			}
		}

		var customers []struct{ ID string `json:"id"` }
		_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/customers", url.Values{
			"organization_id": {"eq." + orgID}, "select": {"id"}, "limit": {"1000"},
		}, nil, "", &customers)

		var connections []map[string]any
		_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/provider_connections", url.Values{
			"organization_id": {"eq." + orgID}, "select": {"id,provider_code,label,status,created_at,updated_at"}, "order": {"created_at.desc"}, "limit": {"100"},
		}, nil, "", &connections)

		organizations = append(organizations, adminOrganization360{
			ID: orgID, Name: name, Slug: slug, Status: status, CreatedAt: createdAt,
			Accounts: accounts, CustomerCount: len(customers), Connections: connections,
			RecentTransactions: txsByOrg[orgID],
		})
	}

	recent := make([]adminTransactionView, 0, minInt(len(txs), 100))
	for i, tx := range txs {
		if i >= 100 {
			break
		}
		recent = append(recent, adminTransactionForView(tx, merchantID, merchantName, orgNames[tx.OrganizationID]))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"merchant":            merchants[0],
		"kyc":                 kyc,
		"pricing":             pricing,
		"members":             members,
		"metrics":             metrics,
		"daily":               daily,
		"organizations":       organizations,
		"recent_transactions": recent,
	})
}

func (s *Server) adminTenantRows(r *http.Request) ([]map[string]any, []map[string]any, error) {
	var merchants []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchants", url.Values{
		"select": {"id,name,status,created_at"}, "order": {"created_at.desc"}, "limit": {"1000"},
	}, nil, "", &merchants); err != nil {
		return nil, nil, err
	}
	var orgs []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/organizations", url.Values{
		"select": {"id,merchant_id,name,slug,status,created_at"}, "order": {"created_at.asc"}, "limit": {"5000"},
	}, nil, "", &orgs); err != nil {
		return nil, nil, err
	}
	return merchants, orgs, nil
}

func (s *Server) loadAdminPixIn(r *http.Request, days int, orgIDs []string) ([]adminFinanceTransaction, bool, error) {
	from := time.Now().UTC().AddDate(0, 0, -days+1).Truncate(24 * time.Hour)
	q := url.Values{
		"kind":       {"eq.pix_in"},
		"created_at": {"gte." + from.Format(time.RFC3339)},
		"select":     {"id,organization_id,account_id,customer_id,provider_connection_id,provider_code,provider_external_id,kind,direction,status,amount_minor,fee_minor,currency,description,provider_payload,created_at,updated_at"},
		"order":      {"created_at.desc"},
		"limit":      {strconv.Itoa(adminFinanceMaxTransactions)},
	}
	if orgIDs != nil {
		if len(orgIDs) == 0 {
			return []adminFinanceTransaction{}, false, nil
		}
		q.Set("organization_id", "in.("+strings.Join(orgIDs, ",")+")")
	}
	var txs []adminFinanceTransaction
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/transactions", q, nil, "", &txs); err != nil {
		return nil, false, err
	}
	return txs, len(txs) == adminFinanceMaxTransactions, nil
}

func aggregateAdminFinance(txs []adminFinanceTransaction, days int, limited bool) (adminFinanceMetrics, []adminFinanceDailyPoint) {
	metrics := adminFinanceMetrics{PeriodDays: days, ProviderCostComplete: true, TransactionWindowWasLimited: limited}
	points := make(map[string]*adminFinanceDailyPoint, days)
	now := time.Now().UTC()
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		points[date] = &adminFinanceDailyPoint{Date: date}
	}

	for _, tx := range txs {
		switch tx.Status {
		case "succeeded":
			metrics.SucceededTransactions++
			metrics.TPVMinor += tx.AmountMinor
			metrics.RevenueMinor += tx.FeeMinor
			if cost, ok := providerCostMinor(tx.ProviderCode, tx.ProviderPayload); ok {
				metrics.ProviderCostMinor += cost
				metrics.ProviderCostKnownCount++
			} else {
				metrics.ProviderCostComplete = false
				metrics.ProviderCostMissingCount++
			}
			if created, err := time.Parse(time.RFC3339, tx.CreatedAt); err == nil {
				if point := points[created.UTC().Format("2006-01-02")]; point != nil {
					point.TPVMinor += tx.AmountMinor
					point.RevenueMinor += tx.FeeMinor
					point.TransactionCount++
				}
			}
		case "pending":
			metrics.PendingTransactions++
		case "failed":
			metrics.FailedTransactions++
		case "ambiguous":
			metrics.AmbiguousTransactions++
		}
	}
	if metrics.SucceededTransactions > 0 {
		metrics.AverageTicketMinor = metrics.TPVMinor / int64(metrics.SucceededTransactions)
	}
	if metrics.ProviderCostComplete {
		margin := metrics.RevenueMinor - metrics.ProviderCostMinor
		metrics.MarginMinor = &margin
	}

	daily := make([]adminFinanceDailyPoint, 0, len(points))
	for _, point := range points {
		daily = append(daily, *point)
	}
	sort.Slice(daily, func(i, j int) bool { return daily[i].Date < daily[j].Date })
	return metrics, daily
}

func adminTransactionForView(tx adminFinanceTransaction, merchantID, merchantName, organizationName string) adminTransactionView {
	view := adminTransactionView{
		ID: tx.ID, MerchantID: merchantID, MerchantName: merchantName,
		OrganizationID: tx.OrganizationID, OrganizationName: organizationName,
		ProviderCode: tx.ProviderCode, Status: tx.Status, AmountMinor: tx.AmountMinor,
		FeeMinor: tx.FeeMinor, Currency: tx.Currency, Description: tx.Description, CreatedAt: tx.CreatedAt,
	}
	if tx.ProviderExternalID != nil {
		view.ProviderExternalID = *tx.ProviderExternalID
	}
	if tx.Status == "succeeded" {
		if cost, ok := providerCostMinor(tx.ProviderCode, tx.ProviderPayload); ok {
			view.ProviderCostMinor = &cost
			margin := tx.FeeMinor - cost
			view.MarginMinor = &margin
		}
	}
	return view
}

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
	if decoder.Decode(&value) != nil {
		return 0, false
	}
	return findProviderCostMinor(value)
}

func findProviderCostMinor(value any) (int64, bool) {
	keys := map[string]struct{}{
		"provider_fee_minor": {}, "providerFeeMinor": {}, "providerFeeInCents": {},
		"fee_in_cents": {}, "feeInCents": {}, "transaction_fee_in_cents": {},
		"transactionFeeInCents": {}, "cost_minor": {}, "costInCents": {},
	}
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			if _, ok := keys[key]; ok {
				if cost, ok := exactMinorInteger(item); ok && cost >= 0 {
					return cost, true
				}
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
		v, err := typed.Int64()
		return v, err == nil
	case string:
		v, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return v, err == nil
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	default:
		return 0, false
	}
}

func adminPeriodDays(raw string) int {
	switch raw {
	case "7":
		return 7
	case "90":
		return 90
	default:
		return 30
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
