package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/id"
)

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	token, expires, err := s.sb.PasswordLogin(r.Context(), strings.TrimSpace(in.Email), in.Password)
	if err != nil {
		writeError(w, 401, "login_failed", "invalid email/password")
		return
	}
	if expires <= 0 {
		expires = 3600
	}
	http.SetCookie(w, &http.Cookie{Name: "flashpag_session", Value: token, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(expires)})
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "flashpag_session", Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) consoleMe(w http.ResponseWriter, r *http.Request) {
	p := consoleP(r.Context())
	var merchants []map[string]any
	var orgs []map[string]any
	if p.Admin {
		_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchants", url.Values{"select": {"id,name,status,created_at"}, "order": {"created_at.desc"}, "limit": {"100"}}, nil, "", &merchants)
		_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/organizations", url.Values{"select": {"id,merchant_id,name,slug,status,created_at"}, "order": {"created_at.desc"}, "limit": {"200"}}, nil, "", &orgs)
	} else {
		var memberships []struct {
			MerchantID string `json:"merchant_id"`
			Role       string `json:"role"`
		}
		_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_users", url.Values{"user_id": {"eq." + p.UserID}, "select": {"merchant_id,role"}}, nil, "", &memberships)
		ids := make([]string, 0, len(memberships))
		for _, m := range memberships {
			ids = append(ids, m.MerchantID)
		}
		if len(ids) > 0 {
			filter := "in.(" + strings.Join(ids, ",") + ")"
			_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchants", url.Values{"id": {filter}, "select": {"id,name,status,created_at"}}, nil, "", &merchants)
			_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/organizations", url.Values{"merchant_id": {filter}, "select": {"id,merchant_id,name,slug,status,created_at"}, "order": {"created_at.asc"}}, nil, "", &orgs)
		}
	}
	writeJSON(w, 200, map[string]any{"user": map[string]any{"id": p.UserID, "email": p.Email, "platform_admin": p.Admin}, "merchants": merchants, "organizations": orgs, "installed_providers": s.providers.Codes()})
}

func (s *Server) consoleSummary(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsole(r)
	if !ok {
		writeError(w, 403, "organization_forbidden", "select an organization you can access")
		return
	}
	acct, err := s.defaultAccount(r.Context(), orgID, "")
	if err != nil {
		writeError(w, 404, "account_not_found", err.Error())
		return
	}
	var balance map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/account_balance", nil, map[string]any{"p_organization_id": orgID, "p_account_id": acct.ID}, "", &balance); err != nil {
		writeError(w, 500, "balance_error", err.Error())
		return
	}
	q := url.Values{"organization_id": {"eq." + orgID}, "select": {"id,kind,status,amount_minor,currency,provider_code,created_at"}, "order": {"created_at.desc"}, "limit": {"8"}}
	var txs []map[string]any
	_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/transactions", q, nil, "", &txs)
	writeJSON(w, 200, map[string]any{"account": acct, "balance": balance, "recent_transactions": txs})
}

func (s *Server) consoleList(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsole(r)
	if !ok {
		writeError(w, 403, "organization_forbidden", "select an organization you can access")
		return
	}
	resource := r.PathValue("resource")
	type spec struct{ table, selects, order string }
	specs := map[string]spec{
		"transactions":         {"transactions", "id,account_id,customer_id,provider_code,provider_external_id,kind,direction,status,amount_minor,currency,description,pix_key,created_at,updated_at", "created_at.desc"},
		"customers":            {"customers", "id,external_id,name,email,document,metadata,created_at,updated_at", "created_at.desc"},
		"accounts":             {"accounts", "id,name,currency,status,is_default,created_at", "created_at.asc"},
		"provider-connections": {"provider_connections", "id,provider_code,label,config,status,created_at,updated_at", "created_at.desc"},
		"webhook-endpoints":    {"webhook_endpoints", "id,url,description,events,status,created_at", "created_at.desc"},
		"api-keys":             {"api_keys", "id,name,prefix,scopes,last_used_at,revoked_at,created_at", "created_at.desc"},
	}
	sp, exists := specs[resource]
	if !exists {
		writeError(w, 404, "unknown_resource", "resource is not exposed in console")
		return
	}
	q := url.Values{"organization_id": {"eq." + orgID}, "select": {sp.selects}, "order": {sp.order}, "limit": {"100"}}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/"+sp.table, q, nil, "", &rows); err != nil {
		writeError(w, 500, "database_error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"data": rows})
}

func (s *Server) consoleCreateCustomer(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin", "member")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	var in customerRequest
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	row, err := s.createCustomerForOrg(r, orgID, in)
	if err != nil {
		writeError(w, 422, "customer_create_failed", err.Error())
		return
	}
	writeJSON(w, 201, row)
}

func (s *Server) consoleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	var in struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes,omitempty"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeError(w, 422, "name_required", "name is required")
		return
	}
	if len(in.Scopes) == 0 {
		in.Scopes = []string{"pix:read", "pix:write", "balance:read", "customers:read", "customers:write", "webhooks:write"}
	}
	raw, err := id.Token(24)
	if err != nil {
		writeError(w, 500, "key_generation_failed", err.Error())
		return
	}
	secret := "fp_live_" + raw
	sum := sha256.Sum256([]byte(secret))
	hash := hex.EncodeToString(sum[:])
	prefix := secret
	if len(prefix) > 16 {
		prefix = prefix[:16]
	}
	var rows []map[string]any
	err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/api_keys", nil, map[string]any{"organization_id": orgID, "name": in.Name, "prefix": prefix, "secret_hash": hash, "scopes": in.Scopes}, "return=representation", &rows)
	if err != nil || len(rows) != 1 {
		writeError(w, 500, "api_key_create_failed", errString(err))
		return
	}
	delete(rows[0], "secret_hash")
	rows[0]["secret"] = secret
	writeJSON(w, 201, rows[0])
}

func (s *Server) consoleCreateProviderConnection(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	var in struct {
		ProviderCode string         `json:"provider"`
		Label        string         `json:"label"`
		Credentials  map[string]any `json:"credentials,omitempty"`
		Config       map[string]any `json:"config,omitempty"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	in.ProviderCode = normalizeProvider(in.ProviderCode)
	if _, ok := s.providers.Get(in.ProviderCode); !ok {
		writeError(w, 422, "provider_not_installed", "provider adapter is not installed")
		return
	}
	if in.Label == "" {
		in.Label = "default"
	}
	var cipher any = nil
	if len(in.Credentials) > 0 {
		if s.box == nil {
			writeError(w, 422, "master_key_required", "APP_MASTER_KEY_B64 is required to store provider credentials")
			return
		}
		raw, _ := json.Marshal(in.Credentials)
		enc, err := s.box.Seal(raw)
		if err != nil {
			writeError(w, 500, "encrypt_failed", err.Error())
			return
		}
		cipher = enc
	}
	if in.Config == nil {
		in.Config = map[string]any{}
	}
	var rows []map[string]any
	err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/provider_connections", nil, map[string]any{"organization_id": orgID, "provider_code": in.ProviderCode, "label": in.Label, "credentials_ciphertext": cipher, "config": in.Config}, "return=representation", &rows)
	if err != nil || len(rows) != 1 {
		writeError(w, 422, "integration_create_failed", errString(err))
		return
	}
	delete(rows[0], "credentials_ciphertext")
	writeJSON(w, 201, rows[0])
}

func (s *Server) consoleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	var in webhookCreate
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	row, secret, err := s.createWebhookForOrg(r, orgID, in)
	if err != nil {
		writeError(w, 422, "webhook_create_failed", err.Error())
		return
	}
	row["secret"] = secret
	writeJSON(w, 201, row)
}

func (s *Server) consoleCreateTransfer(w http.ResponseWriter, r *http.Request) {
	s.consoleOutbound(w, r, "transfer")
}
func (s *Server) consoleCreateWithdrawal(w http.ResponseWriter, r *http.Request) {
	s.consoleOutbound(w, r, "withdrawal")
}
func (s *Server) consoleOutbound(w http.ResponseWriter, r *http.Request, kind string) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	var in outboundRequest
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	in.Currency = normalizeCurrency(in.Currency)
	in.ProviderCode = normalizeProvider(in.ProviderCode)
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		tok, _ := id.Token(16)
		key = "console_" + tok
	}
	tx, _, status, err := s.createOutboundForOrg(r, orgID, key, kind, in)
	if err != nil {
		writeError(w, status, "outbound_create_failed", err.Error())
		return
	}
	writeJSON(w, status, tx)
}

func (s *Server) adminCreateMerchant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		OwnerUserID string `json:"owner_user_id,omitempty"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeError(w, 422, "name_required", "name is required")
		return
	}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/merchants", nil, map[string]any{"name": in.Name}, "return=representation", &rows); err != nil || len(rows) != 1 {
		writeError(w, 500, "merchant_create_failed", errString(err))
		return
	}
	if in.OwnerUserID != "" {
		_ = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/merchant_users", nil, map[string]any{"merchant_id": rows[0]["id"], "user_id": in.OwnerUserID, "role": "owner"}, "", nil)
	}
	writeJSON(w, 201, rows[0])
}
func (s *Server) adminCreateOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID string `json:"merchant_id"`
		Name       string `json:"name"`
		Slug       string `json:"slug"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	if in.MerchantID == "" || in.Name == "" || in.Slug == "" {
		writeError(w, 422, "fields_required", "merchant_id, name and slug are required")
		return
	}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/organizations", nil, map[string]any{"merchant_id": in.MerchantID, "name": in.Name, "slug": strings.ToLower(in.Slug)}, "return=representation", &rows); err != nil || len(rows) != 1 {
		writeError(w, 422, "organization_create_failed", errString(err))
		return
	}
	orgID, _ := rows[0]["id"].(string)
	var accounts []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/accounts", nil, map[string]any{"organization_id": orgID, "name": "Principal", "currency": "BRL", "is_default": true}, "return=representation", &accounts); err != nil {
		writeError(w, 500, "account_create_failed", err.Error())
		return
	}
	rows[0]["accounts"] = accounts
	writeJSON(w, 201, rows[0])
}
func (s *Server) adminAddMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantID string `json:"merchant_id"`
		UserID     string `json:"user_id"`
		Role       string `json:"role"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	if in.Role == "" {
		in.Role = "member"
	}
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/merchant_users", nil, map[string]any{"merchant_id": in.MerchantID, "user_id": in.UserID, "role": in.Role}, "resolution=merge-duplicates", nil); err != nil {
		writeError(w, 422, "member_add_failed", err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true})
}

func errString(err error) string {
	if err == nil {
		return "unexpected empty response"
	}
	return err.Error()
}
