package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
)

func (s *Server) firstPartyMFAEnabled() bool {
	return s.firstPartyAuthEnabled() && s.mfa != nil
}

func (s *Server) firstPartyMFAStatus(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyMFAEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	user := firstPartyP(r.Context())
	enabled, err := s.mfa.Status(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "mfa_status_failed", "could not read authenticator status")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": enabled})
}

func (s *Server) firstPartyMFAEnroll(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyMFAEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	user := firstPartyP(r.Context())
	secret, uri, err := s.mfa.BeginEnrollment(r.Context(), user.ID, user.Username)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrMFAAlreadyEnrolled):
			writeError(w, http.StatusConflict, "mfa_already_enabled", "authenticator is already enabled")
		default:
			writeError(w, http.StatusInternalServerError, "mfa_enroll_failed", "could not start authenticator enrollment")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":        "Flash Pag",
		"account_label": user.Username,
		"secret":        secret,
		"uri":           uri,
	})
}

func (s *Server) firstPartyMFAEnrollVerify(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyMFAEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	code := strings.TrimSpace(in.Code)
	if len(code) != 6 {
		writeError(w, http.StatusUnprocessableEntity, "mfa_code_invalid", "enter the 6-digit authenticator code")
		return
	}
	user := firstPartyP(r.Context())
	if err := s.mfa.VerifyEnrollment(r.Context(), user.ID, code); err != nil {
		switch {
		case errors.Is(err, auth.ErrMFAInvalidCode):
			writeError(w, http.StatusUnauthorized, "mfa_code_invalid", "invalid or expired authenticator code")
		case errors.Is(err, auth.ErrMFAReplay):
			writeError(w, http.StatusConflict, "mfa_code_replayed", "authenticator code was already used")
		default:
			writeError(w, http.StatusInternalServerError, "mfa_enroll_verify_failed", "could not verify authenticator enrollment")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true, "aal": "aal1"})
}

func (s *Server) firstPartyMFAStepUp(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyMFAEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	c, err := r.Cookie(firstPartySessionCookie)
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	code := strings.TrimSpace(in.Code)
	if len(code) != 6 {
		writeError(w, http.StatusUnprocessableEntity, "mfa_code_invalid", "enter the 6-digit authenticator code")
		return
	}
	user := firstPartyP(r.Context())
	if err := s.mfa.VerifyAndElevate(r.Context(), user.ID, auth.HashSessionToken(c.Value), code); err != nil {
		switch {
		case errors.Is(err, auth.ErrMFAInvalidCode):
			writeError(w, http.StatusUnauthorized, "mfa_code_invalid", "invalid or expired authenticator code")
		case errors.Is(err, auth.ErrMFAReplay):
			writeError(w, http.StatusConflict, "mfa_code_replayed", "authenticator code was already used")
		case errors.Is(err, auth.ErrMFAInvalidSession):
			writeError(w, http.StatusUnauthorized, "invalid_session", "session is no longer eligible for MFA")
		case errors.Is(err, auth.ErrMFANotEnrolled):
			writeError(w, http.StatusPreconditionRequired, "mfa_setup_required", "authenticator enrollment is required first")
		default:
			writeError(w, http.StatusInternalServerError, "mfa_step_up_failed", "could not elevate session assurance")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "aal": "aal2"})
}
