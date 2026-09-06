package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
)

type providerRequestEnvelope struct {
	Provider string `json:"provider"`
}

func providerCodeFromRequest(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
	r.Body = io.NopCloser(bytes.NewReader(raw))
	if err != nil || len(raw) > 1<<20 {
		return ""
	}
	var in providerRequestEnvelope
	if json.Unmarshal(raw, &in) != nil {
		return ""
	}
	return normalizeProvider(in.Provider)
}

func (s *Server) withKYCApprovedAPI(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		providerCode := providerCodeFromRequest(r)
		if providerCode == "" || providerCode == "mock" {
			next(w, r)
			return
		}
		p := apiP(r.Context())
		status, err := s.merchantKYCStatusForOrganization(r, p.OrganizationID)
		if err != nil || status != "approved" {
			writeError(w, http.StatusForbidden, "kyc_required", "merchant KYC must be approved before real financial operations are enabled")
			return
		}
		next(w, r)
	}
}

func (s *Server) withKYCApprovedConsole(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		providerCode := providerCodeFromRequest(r)
		if providerCode == "" || providerCode == "mock" {
			next(w, r)
			return
		}
		orgID, ok := s.organizationFromConsole(r)
		if !ok {
			writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
			return
		}
		status, err := s.merchantKYCStatusForOrganization(r, orgID)
		if err != nil || status != "approved" {
			writeError(w, http.StatusForbidden, "kyc_required", "merchant KYC must be approved before real financial infrastructure is enabled")
			return
		}
		next(w, r)
	}
}
