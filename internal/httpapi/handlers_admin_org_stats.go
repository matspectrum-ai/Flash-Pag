package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) adminOrganizationStats(w http.ResponseWriter, r *http.Request) {
	organizationID := strings.TrimSpace(r.PathValue("organizationID"))
	if organizationID == "" {
		writeError(w, http.StatusBadRequest, "organization_required", "organization id is required")
		return
	}

	organizationCount, err := s.sb.Count(r.Context(), "/rest/v1/organizations", url.Values{
		"id":     {"eq." + organizationID},
		"select": {"id"},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "organization_load_failed", "organization could not be loaded")
		return
	}
	if organizationCount != 1 {
		writeError(w, http.StatusNotFound, "organization_not_found", "organization not found")
		return
	}

	counts := make(map[string]int64, 3)
	for key, table := range map[string]string{
		"accounts":             "accounts",
		"customers":            "customers",
		"provider_connections": "provider_connections",
	} {
		count, countErr := s.sb.Count(r.Context(), "/rest/v1/"+table, url.Values{
			"organization_id": {"eq." + organizationID},
			"select":          {"id"},
		})
		if countErr != nil {
			writeError(w, http.StatusInternalServerError, "organization_stats_failed", "organization statistics could not be loaded")
			return
		}
		counts[key] = count
	}

	writeJSON(w, http.StatusOK, counts)
}
