package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) adminOrganizationCustomerCount(w http.ResponseWriter, r *http.Request) {
	organizationID := strings.TrimSpace(r.PathValue("organizationID"))
	if organizationID == "" {
		writeError(w, http.StatusBadRequest, "organization_required", "organization id is required")
		return
	}

	count, err := s.sb.Count(r.Context(), "/rest/v1/customers", url.Values{
		"organization_id": {"eq." + organizationID},
		"select":          {"id"},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "customer_count_failed", "organization customer count could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}
