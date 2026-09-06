package httpapi

import "net/http"

func (s *Server) withKYCApprovedAPI(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := apiP(r.Context())
		status, err := s.merchantKYCStatusForOrganization(r, p.OrganizationID)
		if err != nil || status != "approved" {
			writeError(w, http.StatusForbidden, "kyc_required", "merchant KYC must be approved before financial operations are enabled")
			return
		}
		next(w, r)
	}
}

func (s *Server) withKYCApprovedConsole(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
