package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	platformTenantBatchSize = 500
	platformTenantMaxRows   = 10000
	platformMemberMaxRows   = 500
)

func (s *Server) adminTenantInventory(w http.ResponseWriter, r *http.Request) {
	merchants, merchantsComplete, err := s.adminPagedRows(r.Context(), "merchants", "id,name,status,created_at", "id.asc", platformTenantMaxRows)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "platform_merchants_load_failed", "platform merchants could not be loaded")
		return
	}
	organizations, organizationsComplete, err := s.adminPagedRows(r.Context(), "organizations", "id,merchant_id,name,slug,status,created_at", "id.asc", platformTenantMaxRows)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "platform_organizations_load_failed", "platform organizations could not be loaded")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"merchants":              merchants,
		"organizations":          organizations,
		"merchants_complete":     merchantsComplete,
		"organizations_complete": organizationsComplete,
		"complete":               merchantsComplete && organizationsComplete,
	})
}

func (s *Server) adminMerchantMembers(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	if merchantID == "" {
		writeError(w, http.StatusBadRequest, "merchant_required", "merchant id is required")
		return
	}

	var merchantRows []struct {
		ID string `json:"id"`
	}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchants", url.Values{
		"id": {"eq." + merchantID}, "select": {"id"}, "limit": {"1"},
	}, nil, "", &merchantRows); err != nil {
		writeError(w, http.StatusInternalServerError, "merchant_load_failed", "merchant could not be loaded")
		return
	}
	if len(merchantRows) != 1 {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant not found")
		return
	}

	var organizations []struct {
		ID string `json:"id"`
	}
	_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/organizations", url.Values{
		"merchant_id": {"eq." + merchantID}, "select": {"id"}, "order": {"id.asc"}, "limit": {"1"},
	}, nil, "", &organizations)
	if len(organizations) == 1 {
		members, err := s.membersForOrganization(r.Context(), organizations[0].ID)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]any{"data": members, "complete": true})
			return
		}
	}

	var members []consoleMember
	q := url.Values{
		"merchant_id": {"eq." + merchantID},
		"select":      {"user_id,role,created_at"},
		"order":       {"created_at.asc"},
		"limit":       {strconv.Itoa(platformMemberMaxRows)},
	}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_users", q, nil, "", &members); err != nil {
		writeError(w, http.StatusInternalServerError, "merchant_members_load_failed", "merchant members could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": members, "complete": len(members) < platformMemberMaxRows})
}

func (s *Server) adminPagedRows(ctx context.Context, table, selectColumns, order string, maxRows int) ([]map[string]any, bool, error) {
	rows := make([]map[string]any, 0)
	for offset := 0; offset < maxRows; offset += platformTenantBatchSize {
		limit := platformTenantBatchSize
		if remaining := maxRows - offset; remaining < limit {
			limit = remaining
		}
		var page []map[string]any
		q := url.Values{
			"select": {selectColumns},
			"order":  {order},
			"limit":  {strconv.Itoa(limit)},
			"offset": {strconv.Itoa(offset)},
		}
		if err := s.sb.Do(ctx, http.MethodGet, "/rest/v1/"+table, q, nil, "", &page); err != nil {
			return nil, false, err
		}
		rows = append(rows, page...)
		if len(page) < limit {
			return rows, true, nil
		}
	}
	return rows, false, nil
}
