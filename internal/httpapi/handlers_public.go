package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/id"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

type chargeRequest struct {
	AccountID            string `json:"account_id,omitempty"`
	CustomerID           string `json:"customer_id,omitempty"`
	AmountMinor          int64  `json:"amount_minor"`
	Currency             string `json:"currency,omitempty"`
	Description          string `json:"description,omitempty"`
	ProviderCode         string `json:"provider,omitempty"`
	ProviderConnectionID string `json:"provider_connection_id,omitempty"`
}

type outboundRequest struct {
	AccountID            string `json:"account_id,omitempty"`
	AmountMinor          int64  `json:"amount_minor"`
	Currency             string `json:"currency,omitempty"`
	PixKey               string `json:"pix_key"`
	Description          string `json:"description,omitempty"`
	ProviderCode         string `json:"provider,omitempty"`
	ProviderConnectionID string `json:"provider_connection_id,omitempty"`
}

func normalizeCurrency(v string) string {
	if v == "" {
		return "BRL"
	}
	return strings.ToUpper(v)
}
func normalizeProvider(v string) string {
	if v == "" {
		return "mock"
	}
	return strings.ToLower(v)
}

func (s *Server) createCharge(w http.ResponseWriter, r *http.Request) {
	var in chargeRequest
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	in.Currency = normalizeCurrency(in.Currency)
	in.ProviderCode = normalizeProvider(in.ProviderCode)
	if in.AmountMinor <= 0 || in.Currency != "BRL" {
		writeError(w, 422, "invalid_amount", "amount_minor must be > 0 and currency BRL")
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		writeError(w, 400, "idempotency_key_required", "Idempotency-Key is required for financial POSTs")
		return
	}
	p := apiP(r.Context())
	tx, replayed, status, err := s.createChargeForOrg(r, p.OrganizationID, key, in)
	if err != nil {
		writeError(w, status, "charge_create_failed", err.Error())
		return
	}
	if replayed {
		w.Header().Set("Idempotent-Replayed", "true")
	}
	writeJSON(w, status, tx)
}

func (s *Server) createChargeForOrg(r *http.Request, orgID, key string, in chargeRequest) (transaction, bool, int, error) {
	acct, err := s.defaultAccount(r.Context(), orgID, in.AccountID)
	if err != nil {
		return transaction{}, false, 422, err
	}
	impl, ok := s.providers.Get(in.ProviderCode)
	if !ok {
		return transaction{}, false, 422, errors.New("provider is not installed")
	}
	conn, err := s.providerConnection(r.Context(), orgID, in.ProviderCode, in.ProviderConnectionID)
	if err != nil {
		return transaction{}, false, 422, err
	}
	var customer any
	var providerCustomer *provider.Customer
	if in.CustomerID != "" {
		c, err := s.customerForOrg(r.Context(), orgID, in.CustomerID)
		if err != nil {
			return transaction{}, false, 422, err
		}
		customer = in.CustomerID
		providerCustomer = &provider.Customer{Name: stringValue(c.Name), Email: stringValue(c.Email), Document: stringValue(c.Document)}
		if c.Metadata != nil {
			if phone, ok := c.Metadata["phone"].(string); ok {
				providerCustomer.Phone = phone
			}
		}
	}
	if in.ProviderCode == "pixhub" && providerCustomer == nil {
		return transaction{}, false, 422, errors.New("customer_id is required for Pixhub charges")
	}
	resourceID, err := id.UUID()
	if err != nil {
		return transaction{}, false, 500, err
	}
	fp := fingerprint(in)
	claim, err := s.claimIdempotency(r.Context(), orgID, "pix.charge.create", key, fp, resourceID)
	if err != nil {
		return transaction{}, false, 500, err
	}
	switch claim.Action {
	case "conflict":
		return transaction{}, false, 409, errors.New("Idempotency-Key was reused with different input")
	case "replay":
		var tx transaction
		if err := json.Unmarshal(claim.Response, &tx); err != nil {
			return transaction{}, false, 500, err
		}
		return tx, true, 200, nil
	case "processing", "ambiguous":
		return transaction{}, false, 409, errors.New("request is already processing or has an ambiguous provider outcome; reconcile resource " + claim.ResourceID)
	case "acquired":
	default:
		return transaction{}, false, 500, errors.New("invalid idempotency state")
	}
	var connection any = nil
	if conn.ID != "" {
		connection = conn.ID
	}
	var ignored string
	err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/begin_pix_in", nil, map[string]any{
		"p_transaction_id": resourceID, "p_organization_id": orgID, "p_account_id": acct.ID, "p_customer_id": customer, "p_amount_minor": in.AmountMinor,
		"p_currency": in.Currency, "p_description": in.Description, "p_provider_code": in.ProviderCode, "p_provider_connection_id": connection,
	}, "", &ignored)
	if err != nil {
		return transaction{}, false, 422, err
	}
	result, err := impl.CreateCharge(r.Context(), conn, provider.ChargeRequest{OperationID: resourceID, AmountMinor: in.AmountMinor, Currency: in.Currency, Description: in.Description, Customer: providerCustomer, WebhookURL: s.providerCallbackURL(conn)})
	if err != nil {
		if provider.IsFinal(err) {
			_ = s.patchTransaction(r.Context(), resourceID, map[string]any{"status": "failed", "failure_code": "provider_rejected", "failure_message": err.Error()})
			tx, _ := s.fetchTransaction(r.Context(), orgID, resourceID)
			_ = s.finishIdempotency(r.Context(), orgID, "pix.charge.create", key, "failed_final", tx)
			s.enqueueTransactionWebhook(r.Context(), tx)
			return tx, false, 422, err
		}
		_ = s.patchTransaction(r.Context(), resourceID, map[string]any{"status": "ambiguous", "failure_code": "provider_ambiguous", "failure_message": "provider outcome unknown"})
		tx, _ := s.fetchTransaction(r.Context(), orgID, resourceID)
		_ = s.finishIdempotency(r.Context(), orgID, "pix.charge.create", key, "ambiguous", tx)
		return tx, false, 502, errors.New("provider outcome is ambiguous; do not create a new payment identity")
	}
	patch := map[string]any{"provider_external_id": result.ExternalID, "qr_code": result.QRCode, "provider_payload": result.Raw}
	if err := s.patchTransaction(r.Context(), resourceID, patch); err != nil {
		return transaction{}, false, 500, err
	}
	tx, _ := s.fetchTransaction(r.Context(), orgID, resourceID)
	if result.Status != "pending" {
		if err := s.applyProviderStatus(r.Context(), tx, result.Status, "provider_status", ""); err != nil {
			return transaction{}, false, 500, err
		}
	}
	tx, err = s.fetchTransaction(r.Context(), orgID, resourceID)
	if err != nil {
		return transaction{}, false, 500, err
	}
	if err := s.finishIdempotency(r.Context(), orgID, "pix.charge.create", key, "succeeded", tx); err != nil {
		return transaction{}, false, 500, err
	}
	s.enqueueTransactionWebhook(r.Context(), tx)
	return tx, false, 201, nil
}

func (s *Server) createTransfer(w http.ResponseWriter, r *http.Request) {
	s.createOutbound(w, r, "transfer")
}
func (s *Server) createWithdrawal(w http.ResponseWriter, r *http.Request) {
	s.createOutbound(w, r, "withdrawal")
}
func (s *Server) createOutbound(w http.ResponseWriter, r *http.Request, kind string) {
	var in outboundRequest
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	in.Currency = normalizeCurrency(in.Currency)
	in.ProviderCode = normalizeProvider(in.ProviderCode)
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		writeError(w, 400, "idempotency_key_required", "Idempotency-Key is required for financial POSTs")
		return
	}
	p := apiP(r.Context())
	tx, replayed, status, err := s.createOutboundForOrg(r, p.OrganizationID, key, kind, in)
	if err != nil {
		writeError(w, status, "outbound_create_failed", err.Error())
		return
	}
	if replayed {
		w.Header().Set("Idempotent-Replayed", "true")
	}
	writeJSON(w, status, tx)
}

func (s *Server) createOutboundForOrg(r *http.Request, orgID, key, kind string, in outboundRequest) (transaction, bool, int, error) {
	if in.AmountMinor <= 0 || in.Currency != "BRL" || strings.TrimSpace(in.PixKey) == "" {
		return transaction{}, false, 422, errors.New("amount_minor > 0, currency BRL and pix_key are required")
	}
	acct, err := s.defaultAccount(r.Context(), orgID, in.AccountID)
	if err != nil {
		return transaction{}, false, 422, err
	}
	impl, ok := s.providers.Get(in.ProviderCode)
	if !ok {
		return transaction{}, false, 422, errors.New("provider is not installed")
	}
	conn, err := s.providerConnection(r.Context(), orgID, in.ProviderCode, in.ProviderConnectionID)
	if err != nil {
		return transaction{}, false, 422, err
	}
	resourceID, err := id.UUID()
	if err != nil {
		return transaction{}, false, 500, err
	}
	operation := "pix." + kind + ".create"
	claim, err := s.claimIdempotency(r.Context(), orgID, operation, key, fingerprint(in), resourceID)
	if err != nil {
		return transaction{}, false, 500, err
	}
	switch claim.Action {
	case "conflict":
		return transaction{}, false, 409, errors.New("Idempotency-Key was reused with different input")
	case "replay":
		var tx transaction
		if err := json.Unmarshal(claim.Response, &tx); err != nil {
			return transaction{}, false, 500, err
		}
		return tx, true, 200, nil
	case "processing", "ambiguous":
		return transaction{}, false, 409, errors.New("request is already processing or ambiguous; reconcile resource " + claim.ResourceID)
	case "acquired":
	default:
		return transaction{}, false, 500, errors.New("invalid idempotency state")
	}
	var connection any = nil
	if conn.ID != "" {
		connection = conn.ID
	}
	var ignored string
	err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/begin_outbound", nil, map[string]any{"p_transaction_id": resourceID, "p_organization_id": orgID, "p_account_id": acct.ID, "p_kind": kind, "p_amount_minor": in.AmountMinor, "p_currency": in.Currency, "p_description": in.Description, "p_pix_key": in.PixKey, "p_provider_code": in.ProviderCode, "p_provider_connection_id": connection}, "", &ignored)
	if err != nil {
		return transaction{}, false, 422, err
	}
	result, err := impl.CreateTransfer(r.Context(), conn, provider.TransferRequest{OperationID: resourceID, AmountMinor: in.AmountMinor, Currency: in.Currency, PixKey: in.PixKey, Description: in.Description, WebhookURL: s.providerCallbackURL(conn)})
	if err != nil {
		if provider.IsFinal(err) {
			_ = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/fail_outbound", nil, map[string]any{"p_transaction_id": resourceID, "p_code": "provider_rejected", "p_message": err.Error()}, "", nil)
			tx, _ := s.fetchTransaction(r.Context(), orgID, resourceID)
			_ = s.finishIdempotency(r.Context(), orgID, operation, key, "failed_final", tx)
			s.enqueueTransactionWebhook(r.Context(), tx)
			return tx, false, 422, err
		}
		_ = s.applyProviderStatus(r.Context(), transaction{ID: resourceID, Kind: kind}, "ambiguous", "", "")
		tx, _ := s.fetchTransaction(r.Context(), orgID, resourceID)
		_ = s.finishIdempotency(r.Context(), orgID, operation, key, "ambiguous", tx)
		return tx, false, 502, errors.New("provider outcome is ambiguous; reserved balance remains locked until reconciliation")
	}
	if err := s.patchTransaction(r.Context(), resourceID, map[string]any{"provider_external_id": result.ExternalID, "provider_payload": result.Raw}); err != nil {
		return transaction{}, false, 500, err
	}
	tx, _ := s.fetchTransaction(r.Context(), orgID, resourceID)
	if result.Status != "pending" {
		if err := s.applyProviderStatus(r.Context(), tx, result.Status, "provider_status", ""); err != nil {
			return transaction{}, false, 500, err
		}
	}
	tx, err = s.fetchTransaction(r.Context(), orgID, resourceID)
	if err != nil {
		return transaction{}, false, 500, err
	}
	if err := s.finishIdempotency(r.Context(), orgID, operation, key, "succeeded", tx); err != nil {
		return transaction{}, false, 500, err
	}
	s.enqueueTransactionWebhook(r.Context(), tx)
	return tx, false, 201, nil
}

func (s *Server) getTransaction(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	tx, err := s.fetchTransaction(r.Context(), p.OrganizationID, r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "not_found", "transaction not found")
		return
	}
	writeJSON(w, 200, tx)
}
func (s *Server) listTransactions(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	q := url.Values{"organization_id": {"eq." + p.OrganizationID}, "select": {"id,organization_id,account_id,customer_id,provider_connection_id,provider_code,provider_external_id,kind,direction,status,amount_minor,fee_minor,pricing_version_id,pricing_version,currency,description,pix_key,qr_code,failure_code,failure_message,created_at,updated_at"}, "order": {"created_at.desc"}, "limit": {parseLimit(r.URL.Query().Get("limit"))}}
	var rows []transaction
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/transactions", q, nil, "", &rows); err != nil {
		writeError(w, 500, "database_error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"data": rows})
}
func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	rows, err := s.accountsForOrg(r.Context(), p.OrganizationID)
	if err != nil {
		writeError(w, 500, "database_error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"data": rows})
}
func (s *Server) accountsForOrg(ctx context.Context, orgID string) ([]account, error) {
	q := url.Values{"organization_id": {"eq." + orgID}, "select": {"id,organization_id,name,currency,status,is_default,created_at"}, "order": {"created_at.asc"}}
	var rows []account
	err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/accounts", q, nil, "", &rows)
	return rows, err
}
func (s *Server) getBalance(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	acct, err := s.defaultAccount(r.Context(), p.OrganizationID, r.URL.Query().Get("account_id"))
	if err != nil {
		writeError(w, 404, "account_not_found", err.Error())
		return
	}
	var out map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/account_balance", nil, map[string]any{"p_organization_id": p.OrganizationID, "p_account_id": acct.ID}, "", &out); err != nil {
		writeError(w, 500, "balance_error", err.Error())
		return
	}
	writeJSON(w, 200, out)
}

type customerRequest struct {
	ExternalID string         `json:"external_id,omitempty"`
	Name       string         `json:"name,omitempty"`
	Email      string         `json:"email,omitempty"`
	Document   string         `json:"document,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

func (s *Server) listCustomers(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	rows, err := s.customersForOrg(r.Context(), p.OrganizationID)
	if err != nil {
		writeError(w, 500, "database_error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"data": rows})
}
func (s *Server) customersForOrg(ctx context.Context, orgID string) ([]map[string]any, error) {
	q := url.Values{"organization_id": {"eq." + orgID}, "select": {"id,external_id,name,email,document,metadata,created_at,updated_at"}, "order": {"created_at.desc"}, "limit": {"100"}}
	var rows []map[string]any
	err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/customers", q, nil, "", &rows)
	return rows, err
}
func (s *Server) createCustomer(w http.ResponseWriter, r *http.Request) {
	var in customerRequest
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	p := apiP(r.Context())
	row, err := s.createCustomerForOrg(r, p.OrganizationID, in)
	if err != nil {
		writeError(w, 422, "customer_create_failed", err.Error())
		return
	}
	writeJSON(w, 201, row)
}
func (s *Server) createCustomerForOrg(r *http.Request, orgID string, in customerRequest) (map[string]any, error) {
	body := map[string]any{"organization_id": orgID, "external_id": nullable(in.ExternalID), "name": nullable(in.Name), "email": nullable(in.Email), "document": nullable(in.Document), "metadata": in.Metadata}
	if in.Metadata == nil {
		body["metadata"] = map[string]any{}
	}
	var rows []map[string]any
	err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/customers", nil, body, "return=representation", &rows)
	if err != nil {
		return nil, err
	}
	if len(rows) != 1 {
		return nil, errors.New("customer insert returned no row")
	}
	return rows[0], nil
}
func nullable(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func (s *Server) listIntegrations(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	q := url.Values{"organization_id": {"eq." + p.OrganizationID}, "select": {"id,provider_code,label,config,status,created_at,updated_at"}, "order": {"created_at.desc"}}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/provider_connections", q, nil, "", &rows); err != nil {
		writeError(w, 500, "database_error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"installed_providers": s.providers.Codes(), "connections": rows})
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	rows, err := s.webhooksForOrg(r.Context(), p.OrganizationID)
	if err != nil {
		writeError(w, 500, "database_error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"data": rows})
}
func (s *Server) webhooksForOrg(ctx context.Context, orgID string) ([]map[string]any, error) {
	q := url.Values{"organization_id": {"eq." + orgID}, "select": {"id,url,description,events,status,created_at"}, "order": {"created_at.desc"}}
	var rows []map[string]any
	err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/webhook_endpoints", q, nil, "", &rows)
	return rows, err
}

type webhookCreate struct {
	URL         string   `json:"url"`
	Description string   `json:"description,omitempty"`
	Events      []string `json:"events,omitempty"`
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request) {
	var in webhookCreate
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	p := apiP(r.Context())
	row, secret, err := s.createWebhookForOrg(r, p.OrganizationID, in)
	if err != nil {
		writeError(w, 422, "webhook_create_failed", err.Error())
		return
	}
	row["secret"] = secret
	writeJSON(w, 201, row)
}
func (s *Server) createWebhookForOrg(r *http.Request, orgID string, in webhookCreate) (map[string]any, string, error) {
	if s.box == nil {
		return nil, "", errors.New("APP_MASTER_KEY_B64 is required for webhook secrets")
	}
	if err := validateWebhookURL(in.URL); err != nil {
		return nil, "", err
	}
	if len(in.Events) == 0 {
		in.Events = []string{"transaction.*"}
	}
	tok, err := id.Token(24)
	if err != nil {
		return nil, "", err
	}
	secret := "whsec_" + tok
	enc, err := s.box.Seal([]byte(secret))
	if err != nil {
		return nil, "", err
	}
	body := map[string]any{"organization_id": orgID, "url": in.URL, "description": nullable(in.Description), "events": in.Events, "secret_ciphertext": enc}
	var rows []map[string]any
	err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/webhook_endpoints", nil, body, "return=representation", &rows)
	if err != nil {
		return nil, "", err
	}
	if len(rows) != 1 {
		return nil, "", errors.New("webhook insert returned no row")
	}
	delete(rows[0], "secret_ciphertext")
	return rows[0], secret, nil
}
func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	p := apiP(r.Context())
	q := url.Values{"id": {"eq." + r.PathValue("id")}, "organization_id": {"eq." + p.OrganizationID}}
	if err := s.sb.Do(r.Context(), http.MethodDelete, "/rest/v1/webhook_endpoints", q, nil, "", nil); err != nil {
		writeError(w, 500, "delete_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validateWebhookURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return errors.New("invalid webhook URL")
	}
	host := strings.ToLower(u.Hostname())
	if u.Scheme == "https" {
		if ip := net.ParseIP(host); ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
			return errors.New("webhook URL cannot target private/loopback IP")
		}
		return nil
	}
	if u.Scheme == "http" && (host == "localhost" || host == "127.0.0.1") {
		return nil
	}
	return errors.New("webhook URL must use https (http is allowed only for localhost development)")
}
