package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type consoleMember struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

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
		"organization_id":          orgID,
		"role":                     role,
		"can_manage":               roleAllowed(role, "owner", "admin"),
		"can_manage_members":       roleAllowed(role, "owner", "admin"),
		"can_manage_admins":        role == "owner" || role == "platform_admin",
		"can_manage_integrations":  roleAllowed(role, "owner", "admin"),
		"can_view_sensitive_config": roleAllowed(role, "owner", "admin"),
		"can_create_customer":      roleAllowed(role, "owner", "admin", "member"),
		"can_write_operational":    roleAllowed(role, "owner", "admin", "member"),
	})
}

func (s *Server) consoleMembers(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsole(r)
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	rows, err := s.membersForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "members_load_failed", "could not load merchant members")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (s *Server) consoleCreateMember(w http.ResponseWriter, r *http.Request) {
	orgID, actorRole, ok := s.organizationWithRole(r, "owner", "admin")
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	in.Role = normalizeMemberRole(in.Role)
	if in.Email == "" {
		writeError(w, http.StatusUnprocessableEntity, "email_required", "email is required")
		return
	}
	if !memberRoleAssignableBy(actorRole, in.Role) {
		writeError(w, http.StatusForbidden, "role_forbidden", "you cannot assign this role")
		return
	}

	var userID string
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/lookup_auth_user_by_email", nil, map[string]any{"p_email": in.Email}, "", &userID); err != nil || userID == "" {
		writeError(w, http.StatusNotFound, "user_not_found", "this email does not belong to an existing Flash Pag user")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "merchant_not_found", "merchant could not be resolved")
		return
	}
	existingRole, exists := s.memberRoleForMerchant(r.Context(), merchantID, userID)
	if exists && !memberTargetManageableBy(actorRole, existingRole) {
		writeError(w, http.StatusForbidden, "member_forbidden", "you cannot manage this member")
		return
	}
	if exists && existingRole == "owner" && in.Role != "owner" && !s.merchantHasAnotherOwner(r.Context(), merchantID, userID) {
		writeError(w, http.StatusConflict, "last_owner", "a merchant must keep at least one owner")
		return
	}

	var rows []map[string]any
	prefer := "resolution=merge-duplicates,return=representation"
	body := map[string]any{"merchant_id": merchantID, "user_id": userID, "role": in.Role}
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/merchant_users", nil, body, prefer, &rows); err != nil || len(rows) != 1 {
		writeError(w, http.StatusUnprocessableEntity, "member_save_failed", "member could not be saved")
		return
	}
	rows[0]["email"] = in.Email
	writeJSON(w, http.StatusCreated, rows[0])
}

func (s *Server) consoleUpdateMember(w http.ResponseWriter, r *http.Request) {
	orgID, actorRole, ok := s.organizationWithRole(r, "owner", "admin")
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	userID := strings.TrimSpace(r.PathValue("userID"))
	var in struct {
		Role string `json:"role"`
	}
	if userID == "" {
		writeError(w, http.StatusBadRequest, "member_required", "member user id is required")
		return
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.Role = normalizeMemberRole(in.Role)
	if !memberRoleAssignableBy(actorRole, in.Role) {
		writeError(w, http.StatusForbidden, "role_forbidden", "you cannot assign this role")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "merchant_not_found", "merchant could not be resolved")
		return
	}
	existingRole, exists := s.memberRoleForMerchant(r.Context(), merchantID, userID)
	if !exists {
		writeError(w, http.StatusNotFound, "member_not_found", "member not found")
		return
	}
	if !memberTargetManageableBy(actorRole, existingRole) {
		writeError(w, http.StatusForbidden, "member_forbidden", "you cannot manage this member")
		return
	}
	if existingRole == "owner" && in.Role != "owner" && !s.merchantHasAnotherOwner(r.Context(), merchantID, userID) {
		writeError(w, http.StatusConflict, "last_owner", "a merchant must keep at least one owner")
		return
	}
	q := url.Values{"merchant_id": {"eq." + merchantID}, "user_id": {"eq." + userID}}
	if err := s.sb.Do(r.Context(), http.MethodPatch, "/rest/v1/merchant_users", q, map[string]any{"role": in.Role}, "", nil); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "member_update_failed", "member role could not be updated")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) consoleDeleteMember(w http.ResponseWriter, r *http.Request) {
	orgID, actorRole, ok := s.organizationWithRole(r, "owner", "admin")
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		writeError(w, http.StatusBadRequest, "member_required", "member user id is required")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "merchant_not_found", "merchant could not be resolved")
		return
	}
	existingRole, exists := s.memberRoleForMerchant(r.Context(), merchantID, userID)
	if !exists {
		writeError(w, http.StatusNotFound, "member_not_found", "member not found")
		return
	}
	if !memberTargetManageableBy(actorRole, existingRole) {
		writeError(w, http.StatusForbidden, "member_forbidden", "you cannot manage this member")
		return
	}
	if existingRole == "owner" && !s.merchantHasAnotherOwner(r.Context(), merchantID, userID) {
		writeError(w, http.StatusConflict, "last_owner", "a merchant must keep at least one owner")
		return
	}
	q := url.Values{"merchant_id": {"eq." + merchantID}, "user_id": {"eq." + userID}}
	if err := s.sb.Do(r.Context(), http.MethodDelete, "/rest/v1/merchant_users", q, nil, "", nil); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "member_delete_failed", "member could not be removed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) consoleSensitiveList(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
		if !ok {
			writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
			return
		}
		type spec struct{ table, selects, order string }
		specs := map[string]spec{
			"provider-connections": {"provider_connections", "id,provider_code,label,config,status,created_at,updated_at", "created_at.desc"},
			"webhook-endpoints":    {"webhook_endpoints", "id,url,description,events,status,created_at", "created_at.desc"},
			"api-keys":             {"api_keys", "id,name,prefix,scopes,last_used_at,revoked_at,created_at", "created_at.desc"},
		}
		sp := specs[resource]
		q := url.Values{"organization_id": {"eq." + orgID}, "select": {sp.selects}, "order": {sp.order}, "limit": {"100"}}
		var rows []map[string]any
		if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/"+sp.table, q, nil, "", &rows); err != nil {
			writeError(w, http.StatusInternalServerError, "database_error", "resource could not be loaded")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": rows})
	}
}

func (s *Server) organizationWithRole(r *http.Request, allowed ...string) (string, string, bool) {
	orgID := strings.TrimSpace(r.URL.Query().Get("organization_id"))
	if orgID == "" {
		orgID = strings.TrimSpace(r.Header.Get("X-Organization-Id"))
	}
	role, ok := s.organizationRole(r.Context(), consoleP(r.Context()), orgID)
	return orgID, role, ok && roleAllowed(role, allowed...)
}

func (s *Server) membersForOrganization(ctx context.Context, orgID string) ([]consoleMember, error) {
	var rows []consoleMember
	err := s.sb.Do(ctx, http.MethodPost, "/rest/v1/rpc/merchant_members_for_organization", nil, map[string]any{"p_organization_id": orgID}, "", &rows)
	return rows, err
}

func (s *Server) merchantIDForOrganization(ctx context.Context, orgID string) (string, error) {
	var rows []struct {
		MerchantID string `json:"merchant_id"`
	}
	q := url.Values{"id": {"eq." + orgID}, "select": {"merchant_id"}, "limit": {"1"}}
	if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/organizations", q, nil, "", &rows); err != nil || len(rows) != 1 || rows[0].MerchantID == "" {
		if err != nil {
			return "", err
		}
		return "", errMemberNotFound
	}
	return rows[0].MerchantID, nil
}

var errMemberNotFound = &memberLookupError{}

type memberLookupError struct{}
func (*memberLookupError) Error() string { return "member not found" }

func (s *Server) memberRoleForMerchant(ctx context.Context, merchantID, userID string) (string, bool) {
	var rows []struct {
		Role string `json:"role"`
	}
	q := url.Values{"merchant_id": {"eq." + merchantID}, "user_id": {"eq." + userID}, "select": {"role"}, "limit": {"1"}}
	if s.sb.Do(ctx, http.MethodGet, "/rest/v1/merchant_users", q, nil, "", &rows) != nil || len(rows) != 1 {
		return "", false
	}
	return rows[0].Role, true
}

func (s *Server) merchantHasAnotherOwner(ctx context.Context, merchantID, excludingUserID string) bool {
	var rows []struct {
		UserID string `json:"user_id"`
	}
	q := url.Values{"merchant_id": {"eq." + merchantID}, "role": {"eq.owner"}, "select": {"user_id"}, "limit": {"10"}}
	if s.sb.Do(ctx, http.MethodGet, "/rest/v1/merchant_users", q, nil, "", &rows) != nil {
		return false
	}
	for _, row := range rows {
		if row.UserID != excludingUserID {
			return true
		}
	}
	return false
}

func normalizeMemberRole(role string) string {
	role = strings.ToLower(strings.TrimSpace(role))
	if role == "" {
		return "member"
	}
	return role
}

func validMemberRole(role string) bool {
	switch role {
	case "owner", "admin", "member", "viewer":
		return true
	default:
		return false
	}
}

func memberRoleAssignableBy(actorRole, targetRole string) bool {
	if !validMemberRole(targetRole) {
		return false
	}
	switch actorRole {
	case "platform_admin", "owner":
		return true
	case "admin":
		return targetRole == "member" || targetRole == "viewer"
	default:
		return false
	}
}

func memberTargetManageableBy(actorRole, existingRole string) bool {
	switch actorRole {
	case "platform_admin", "owner":
		return true
	case "admin":
		return existingRole == "member" || existingRole == "viewer"
	default:
		return false
	}
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
