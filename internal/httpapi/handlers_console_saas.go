package httpapi

import (
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) consoleAccess(w http.ResponseWriter, r *http.Request) {
	orgID := strings.TrimSpace(r.URL.Query().Get("organization_id"))
	if orgID == "" {
		orgID = strings.TrimSpace(r.Header.Get("X-Organization-Id"))
	}
	role, ok := s.organizationRole(r.Context(), consoleP(r.Context()), orgID)
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"organization_id":     orgID,
		"role":                role,
		"can_manage":          roleAllowed(role, "owner", "admin"),
		"can_create_customer": roleAllowed(role, "owner", "admin", "member"),
	})
}

func (s *Server) consoleRevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	keyID := strings.TrimSpace(r.PathValue("id"))
	if keyID == "" {
		writeError(w, http.StatusBadRequest, "api_key_required", "api key id is required")
		return
	}
	q := url.Values{"id": {"eq." + keyID}, "organization_id": {"eq." + orgID}, "revoked_at": {"is.null"}}
	if err := s.sb.Do(r.Context(), http.MethodPatch, "/rest/v1/api_keys", q, map[string]any{"revoked_at": time.Now().UTC().Format(time.RFC3339Nano)}, "", nil); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "api_key_revoke_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) consoleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	webhookID := strings.TrimSpace(r.PathValue("id"))
	if webhookID == "" {
		writeError(w, http.StatusBadRequest, "webhook_required", "webhook endpoint id is required")
		return
	}
	q := url.Values{"id": {"eq." + webhookID}, "organization_id": {"eq." + orgID}}
	if err := s.sb.Do(r.Context(), http.MethodDelete, "/rest/v1/webhook_endpoints", q, nil, "", nil); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "webhook_delete_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
