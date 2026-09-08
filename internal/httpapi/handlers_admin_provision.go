package httpapi

import (
	"net/http"
	"strings"
)

func (s *Server) adminProvisionOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		OwnerUserID string `json:"owner_user_id,omitempty"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.ToLower(strings.TrimSpace(in.Slug))
	in.OwnerUserID = strings.TrimSpace(in.OwnerUserID)
	if in.Name == "" || in.Slug == "" {
		writeError(w, http.StatusUnprocessableEntity, "fields_required", "name and slug are required")
		return
	}

	payload := map[string]any{
		"p_name":          in.Name,
		"p_slug":          in.Slug,
		"p_owner_user_id": nil,
	}
	if in.OwnerUserID != "" {
		payload["p_owner_user_id"] = in.OwnerUserID
	}

	var result map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/provision_platform_organization", nil, payload, "", &result); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "organization_provision_failed", err.Error())
		return
	}
	if result["organization"] == nil || result["account"] == nil {
		writeError(w, http.StatusInternalServerError, "organization_provision_failed", "provisioning response is incomplete")
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
