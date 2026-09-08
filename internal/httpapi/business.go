package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

type transaction struct {
	ID                   string  `json:"id"`
	OrganizationID       string  `json:"organization_id"`
	AccountID            string  `json:"account_id"`
	CustomerID           *string `json:"customer_id"`
	ProviderConnectionID *string `json:"provider_connection_id"`
	ProviderCode         string  `json:"provider_code"`
	ProviderExternalID   *string `json:"provider_external_id"`
	Kind                 string  `json:"kind"`
	Direction            string  `json:"direction"`
	Status               string  `json:"status"`
	AmountMinor          int64   `json:"amount_minor"`
	FeeMinor             int64   `json:"fee_minor"`
	PricingVersionID     string  `json:"pricing_version_id"`
	PricingVersion       int     `json:"pricing_version"`
	Currency             string  `json:"currency"`
	Description          *string `json:"description"`
	PixKey               *string `json:"pix_key"`
	QRCode               *string `json:"qr_code"`
	FailureCode          *string `json:"failure_code"`
	FailureMessage       *string `json:"failure_message"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
}

type account struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	Name           string `json:"name"`
	Currency       string `json:"currency"`
	Status         string `json:"status"`
	IsDefault      bool   `json:"is_default"`
	CreatedAt      string `json:"created_at"`
}

type customerRow struct {
	ID       string         `json:"id"`
	Name     *string        `json:"name"`
	Email    *string        `json:"email"`
	Document *string        `json:"document"`
	Metadata map[string]any `json:"metadata"`
}

type providerConnectionRow struct {
	ID                    string          `json:"id"`
	OrganizationID        string          `json:"organization_id"`
	ProviderCode          string          `json:"provider_code"`
	Label                 string          `json:"label"`
	CredentialsCiphertext *string         `json:"credentials_ciphertext"`
	Config                json.RawMessage `json:"config"`
	Status                string          `json:"status"`
}

type idempotencyClaim struct {
	Action     string          `json:"action"`
	ResourceID string          `json:"resource_id"`
	Status     string          `json:"status"`
	Response   json.RawMessage `json:"response"`
}

func fingerprint(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func (s *Server) defaultAccount(ctx context.Context, orgID, requested string) (account, error) {
	q := url.Values{"organization_id": {"eq." + orgID}, "status": {"eq.active"}, "select": {"id,organization_id,name,currency,status,is_default,created_at"}, "limit": {"1"}}
	if requested != "" {
		q.Set("id", "eq."+requested)
	} else {
		q.Set("is_default", "eq.true")
	}
	var rows []account
	if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/accounts", q, nil, "", &rows); err != nil {
		return account{}, err
	}
	if len(rows) == 0 && requested == "" {
		q.Del("is_default")
		if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/accounts", q, nil, "", &rows); err != nil {
			return account{}, err
		}
	}
	if len(rows) != 1 {
		return account{}, errors.New("account not found")
	}
	return rows[0], nil
}

func (s *Server) providerConnection(ctx context.Context, orgID, code, requested string) (provider.Connection, error) {
	q := url.Values{"organization_id": {"eq." + orgID}, "provider_code": {"eq." + code}, "status": {"eq.active"}, "select": {"id,organization_id,provider_code,label,credentials_ciphertext,config,status"}, "limit": {"1"}}
	if requested != "" {
		q.Set("id", "eq."+requested)
	}
	var rows []providerConnectionRow
	if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/provider_connections", q, nil, "", &rows); err != nil {
		return provider.Connection{}, err
	}
	if len(rows) == 0 && code == "mock" && requested == "" {
		return provider.Connection{ProviderCode: "mock"}, nil
	}
	if len(rows) != 1 {
		return provider.Connection{}, errors.New("provider connection not found")
	}
	var creds json.RawMessage
	if rows[0].CredentialsCiphertext != nil && *rows[0].CredentialsCiphertext != "" {
		if s.box == nil {
			return provider.Connection{}, errors.New("provider secrets require APP_MASTER_KEY_B64")
		}
		raw, err := s.box.Open(*rows[0].CredentialsCiphertext)
		if err != nil {
			return provider.Connection{}, err
		}
		creds = raw
	}
	return provider.Connection{ID: rows[0].ID, ProviderCode: rows[0].ProviderCode, Credentials: creds}, nil
}

func (s *Server) customerForOrg(ctx context.Context, orgID, customerID string) (customerRow, error) {
	q := url.Values{"id": {"eq." + customerID}, "organization_id": {"eq." + orgID}, "select": {"id,name,email,document,metadata"}, "limit": {"1"}}
	var rows []customerRow
	if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/customers", q, nil, "", &rows); err != nil {
		return customerRow{}, err
	}
	if len(rows) != 1 {
		return customerRow{}, errors.New("customer not found")
	}
	return rows[0], nil
}

func stringValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func (s *Server) providerCallbackURL(conn provider.Connection) string {
	if conn.ID == "" || conn.ProviderCode == "" || s.cfg.PublicURL == "" {
		return ""
	}
	if isLoopbackURL(s.cfg.PublicURL) {
		return ""
	}
	callback := s.cfg.PublicURL + "/providers/" + conn.ProviderCode + "/webhooks/" + conn.ID
	var secrets struct {
		WebhookToken string `json:"webhook_token"`
	}
	if len(conn.Credentials) > 0 && json.Unmarshal(conn.Credentials, &secrets) == nil && secrets.WebhookToken != "" {
		callback += "?token=" + url.QueryEscape(secrets.WebhookToken)
	}
	return callback
}

// isLoopbackURL reports whether raw is an http(s) URL whose hostname is a
// loopback address or name. Providers cannot reach such callbacks, and some
// reject the charge outright, so callers must omit the webhook URL instead.
func isLoopbackURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" {
		return true
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func (s *Server) claimIdempotency(ctx context.Context, orgID, operation, key, fp, resourceID string) (idempotencyClaim, error) {
	var c idempotencyClaim
	err := s.sb.Do(ctx, http.MethodPost, "/rest/v1/rpc/claim_idempotency", nil, map[string]any{"p_organization_id": orgID, "p_operation": operation, "p_key": key, "p_fingerprint": fp, "p_resource_id": resourceID}, "", &c)
	return c, err
}
func (s *Server) finishIdempotency(ctx context.Context, orgID, operation, key, status string, response any) error {
	return s.sb.Do(ctx, http.MethodPost, "/rest/v1/rpc/finish_idempotency", nil, map[string]any{"p_organization_id": orgID, "p_operation": operation, "p_key": key, "p_status": status, "p_response": response}, "", nil)
}

func (s *Server) fetchTransaction(ctx context.Context, orgID, id string) (transaction, error) {
	q := url.Values{"id": {"eq." + id}, "organization_id": {"eq." + orgID}, "select": {"id,organization_id,account_id,customer_id,provider_connection_id,provider_code,provider_external_id,kind,direction,status,amount_minor,fee_minor,pricing_version_id,pricing_version,currency,description,pix_key,qr_code,failure_code,failure_message,created_at,updated_at"}, "limit": {"1"}}
	var rows []transaction
	if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/transactions", q, nil, "", &rows); err != nil {
		return transaction{}, err
	}
	if len(rows) != 1 {
		return transaction{}, errors.New("transaction not found")
	}
	return rows[0], nil
}

func (s *Server) patchTransaction(ctx context.Context, id string, patch map[string]any) error {
	return s.sb.Do(ctx, http.MethodPatch, "/rest/v1/transactions", url.Values{"id": {"eq." + id}}, patch, "", nil)
}

func (s *Server) applyProviderStatus(ctx context.Context, tx transaction, status string, code, message string) error {
	switch status {
	case "succeeded":
		rpc := "/rest/v1/rpc/settle_pix_in"
		body := map[string]any{"p_transaction_id": tx.ID}
		if tx.Kind != "pix_in" {
			rpc = "/rest/v1/rpc/complete_outbound"
		}
		if err := s.sb.Do(ctx, http.MethodPost, rpc, nil, body, "", nil); err != nil {
			return err
		}
	case "failed":
		if tx.Kind == "pix_in" {
			if err := s.patchTransaction(ctx, tx.ID, map[string]any{"status": "failed", "failure_code": code, "failure_message": message}); err != nil {
				return err
			}
		} else {
			if err := s.sb.Do(ctx, http.MethodPost, "/rest/v1/rpc/fail_outbound", nil, map[string]any{"p_transaction_id": tx.ID, "p_code": code, "p_message": message}, "", nil); err != nil {
				return err
			}
		}
	case "ambiguous":
		return s.patchTransaction(ctx, tx.ID, map[string]any{"status": "ambiguous"})
	case "pending":
		return nil
	default:
		return errors.New("unsupported provider status")
	}
	return nil
}

func (s *Server) enqueueTransactionWebhook(ctx context.Context, tx transaction) {
	fresh, err := s.fetchTransaction(ctx, tx.OrganizationID, tx.ID)
	if err != nil {
		return
	}
	eventType := "transaction." + fresh.Status
	_ = s.sb.Do(ctx, http.MethodPost, "/rest/v1/rpc/enqueue_webhook_event", nil, map[string]any{"p_organization_id": fresh.OrganizationID, "p_event_type": eventType, "p_payload": fresh}, "", nil)
}
