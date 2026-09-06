package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/supabase"
)

type ctxKey string

const apiPrincipalKey ctxKey = "api-principal"
const consolePrincipalKey ctxKey = "console-principal"

type apiPrincipal struct {
	KeyID, OrganizationID string
	Scopes                []string
}
type consolePrincipal struct {
	UserID, Email string
	Admin         bool
}

type apiKeyRow struct {
	ID             string   `json:"id"`
	OrganizationID string   `json:"organization_id"`
	Scopes         []string `json:"scopes"`
}

func (s *Server) withAPIScope(scope string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimSpace(r.Header.Get("X-API-Key"))
		if raw == "" {
			if h := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(h), "bearer ") {
				raw = strings.TrimSpace(h[7:])
			}
		}
		if raw == "" {
			writeError(w, http.StatusUnauthorized, "missing_api_key", "X-API-Key or Bearer token is required")
			return
		}
		sum := sha256.Sum256([]byte(raw))
		hash := hex.EncodeToString(sum[:])
		q := url.Values{"secret_hash": {"eq." + hash}, "revoked_at": {"is.null"}, "select": {"id,organization_id,scopes"}, "limit": {"1"}}
		var rows []apiKeyRow
		if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/api_keys", q, nil, "", &rows); err != nil || len(rows) != 1 {
			writeError(w, http.StatusUnauthorized, "invalid_api_key", "API key is invalid or revoked")
			return
		}
		if scope != "" && !hasScope(rows[0].Scopes, scope) {
			writeError(w, http.StatusForbidden, "insufficient_scope", "API key does not grant "+scope)
			return
		}
		// best-effort usage timestamp; failure must not break the financial request.
		_ = s.sb.Do(r.Context(), http.MethodPatch, "/rest/v1/api_keys", url.Values{"id": {"eq." + rows[0].ID}}, map[string]any{"last_used_at": time.Now().UTC().Format(time.RFC3339Nano)}, "", nil)
		p := apiPrincipal{KeyID: rows[0].ID, OrganizationID: rows[0].OrganizationID, Scopes: rows[0].Scopes}
		next(w, r.WithContext(context.WithValue(r.Context(), apiPrincipalKey, p)))
	}
}

func hasScope(scopes []string, wanted string) bool {
	for _, s := range scopes {
		if s == "*" || s == wanted {
			return true
		}
	}
	return false
}
func apiP(ctx context.Context) apiPrincipal {
	p, _ := ctx.Value(apiPrincipalKey).(apiPrincipal)
	return p
}

func (s *Server) withConsoleAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("flashpag_session")
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
			return
		}
		user, err := s.sb.AuthUser(r.Context(), c.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid_session", "session expired or invalid")
			return
		}
		admin := false
		var rows []struct {
			UserID string `json:"user_id"`
		}
		q := url.Values{"user_id": {"eq." + user.ID}, "select": {"user_id"}, "limit": {"1"}}
		if s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/platform_admins", q, nil, "", &rows) == nil && len(rows) == 1 {
			admin = true
		}
		p := consolePrincipal{UserID: user.ID, Email: user.Email, Admin: admin}
		next(w, r.WithContext(context.WithValue(r.Context(), consolePrincipalKey, p)))
	}
}

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.withConsoleAuth(func(w http.ResponseWriter, r *http.Request) {
		p := consoleP(r.Context())
		if !p.Admin {
			writeError(w, http.StatusForbidden, "admin_required", "platform admin required")
			return
		}
		next(w, r)
	})
}
func consoleP(ctx context.Context) consolePrincipal {
	p, _ := ctx.Value(consolePrincipalKey).(consolePrincipal)
	return p
}

func (s *Server) organizationRole(ctx context.Context, p consolePrincipal, orgID string) (string, bool) {
	if orgID == "" {
		return "", false
	}
	if p.Admin {
		return "platform_admin", true
	}
	var orgs []struct {
		MerchantID string `json:"merchant_id"`
	}
	if s.sb.Do(ctx, http.MethodGet, "/rest/v1/organizations", url.Values{"id": {"eq." + orgID}, "select": {"merchant_id"}, "limit": {"1"}}, nil, "", &orgs) != nil || len(orgs) != 1 {
		return "", false
	}
	var memberships []struct {
		Role string `json:"role"`
	}
	q := url.Values{"merchant_id": {"eq." + orgs[0].MerchantID}, "user_id": {"eq." + p.UserID}, "select": {"role"}, "limit": {"1"}}
	if s.sb.Do(ctx, http.MethodGet, "/rest/v1/merchant_users", q, nil, "", &memberships) != nil || len(memberships) != 1 {
		return "", false
	}
	return memberships[0].Role, true
}

func roleAllowed(role string, allowed ...string) bool {
	if role == "platform_admin" {
		return true
	}
	for _, candidate := range allowed {
		if role == candidate {
			return true
		}
	}
	return false
}

func (s *Server) organizationFromConsole(r *http.Request) (string, bool) {
	orgID := r.URL.Query().Get("organization_id")
	if orgID == "" {
		orgID = r.Header.Get("X-Organization-Id")
	}
	_, ok := s.organizationRole(r.Context(), consoleP(r.Context()), orgID)
	return orgID, ok
}

func (s *Server) organizationFromConsoleRoles(r *http.Request, allowed ...string) (string, bool) {
	orgID := r.URL.Query().Get("organization_id")
	if orgID == "" {
		orgID = r.Header.Get("X-Organization-Id")
	}
	role, ok := s.organizationRole(r.Context(), consoleP(r.Context()), orgID)
	return orgID, ok && roleAllowed(role, allowed...)
}

func parseLimit(v string) string {
	if v == "" {
		return "50"
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return "50"
		}
	}
	return v
}

var _ = supabase.AuthUser{}
