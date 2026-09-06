package httpapi

import (
	"net/http"
	"strings"
)

func (s *Server) adminCreateMerchantWithKYC(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		OwnerUserID string `json:"owner_user_id,omitempty"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.OwnerUserID = strings.TrimSpace(in.OwnerUserID)
	if in.Name == "" {
		writeError(w, http.StatusUnprocessableEntity, "name_required", "name is required")
		return
	}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/merchants", nil, map[string]any{"name": in.Name}, "return=representation", &rows); err != nil || len(rows) != 1 {
		writeError(w, http.StatusInternalServerError, "merchant_create_failed", errString(err))
		return
	}
	merchantID, _ := rows[0]["id"].(string)
	if merchantID == "" {
		writeError(w, http.StatusInternalServerError, "merchant_create_failed", "merchant id missing from database response")
		return
	}
	if in.OwnerUserID != "" {
		if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/merchant_users", nil, map[string]any{"merchant_id": merchantID, "user_id": in.OwnerUserID, "role": "owner"}, "", nil); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "merchant_owner_failed", "merchant was created but owner assignment failed")
			return
		}
	}
	writeJSON(w, http.StatusCreated, rows[0])
}
