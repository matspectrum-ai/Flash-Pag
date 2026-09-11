package httpapi

import (
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
)

const firstPartyRecoveryCookie = "flashpag_first_party_recovery"

type firstPartyRecoveryCookiePayload struct {
	ChallengeID string `json:"challenge_id"`
	Token       string `json:"token"`
	UserID      string `json:"user_id"`
	KeyID       string `json:"key_id"`
	ExpiresAt   int64  `json:"expires_at"`
}

func (s *Server) firstPartyRecoveryEnabled() bool {
	return s.cfg.FirstPartyAuthEnabled && s.recovery != nil && s.box != nil
}

func (s *Server) firstPartyRecoveryChallenge(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyRecoveryEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	var in struct {
		Identifier string `json:"identifier"`
		KitBase64  string `json:"kit_base64"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid recovery request")
		return
	}
	if strings.TrimSpace(in.Identifier) == "" || len(in.KitBase64) > 8192 {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	kitData, err := base64.StdEncoding.DecodeString(in.KitBase64)
	if err != nil || len(kitData) > 4096 {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	state, err := s.recovery.BeginChallenge(r.Context(), in.Identifier, kitData, requestIP(r))
	if err != nil {
		if errors.Is(err, auth.ErrRecoveryRateLimited) {
			w.Header().Set("Retry-After", "900")
			writeError(w, http.StatusTooManyRequests, "recovery_rate_limited", "recovery is temporarily unavailable; try again later")
			return
		}
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}

	payload := firstPartyRecoveryCookiePayload{
		ChallengeID: state.ID,
		Token:       state.Token,
		UserID:      state.UserID,
		KeyID:       state.KeyID,
		ExpiresAt:   state.ExpiresAt.Unix(),
	}
	encoded, err := marshalJSON(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "recovery_failed", "recovery could not be started")
		return
	}
	if err := s.setEncryptedCookie(w, firstPartyRecoveryCookie, string(encoded), int(time.Until(state.ExpiresAt).Seconds())); err != nil {
		writeError(w, http.StatusInternalServerError, "recovery_failed", "recovery could not be started")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"expires_at": state.ExpiresAt,
	})
}

func (s *Server) firstPartyRecoveryResetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyRecoveryEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	value, err := s.readEncryptedCookie(r, firstPartyRecoveryCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "recovery_required", "a valid recovery verification is required")
		return
	}
	var state firstPartyRecoveryCookiePayload
	if err := unmarshalJSON([]byte(value), &state); err != nil || state.ChallengeID == "" || state.Token == "" || state.UserID == "" || state.KeyID == "" || time.Now().Unix() >= state.ExpiresAt {
		clearCookie(w, firstPartyRecoveryCookie, s.cfg.CookieSecure)
		writeError(w, http.StatusUnauthorized, "recovery_required", "recovery verification expired")
		return
	}

	var in struct {
		Password        string `json:"password"`
		PasswordConfirm string `json:"password_confirm"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid password reset request")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > 128 || in.Password != in.PasswordConfirm {
		writeError(w, http.StatusUnprocessableEntity, "password_invalid", "passwords must match and contain 8 to 128 characters")
		return
	}

	err = s.recovery.ResetPassword(r.Context(), state.ChallengeID, state.Token, state.UserID, state.KeyID, in.Password, in.PasswordConfirm)
	if err != nil {
		if errors.Is(err, auth.ErrRecoveryPassword) {
			writeError(w, http.StatusUnprocessableEntity, "password_invalid", "passwords must match and contain 8 to 128 characters")
			return
		}
		if errors.Is(err, auth.ErrRecoveryUnavailable) {
			clearCookie(w, firstPartyRecoveryCookie, s.cfg.CookieSecure)
			writeError(w, http.StatusUnauthorized, "recovery_required", "recovery verification is invalid or expired")
			return
		}
		writeError(w, http.StatusInternalServerError, "password_reset_failed", "password could not be changed")
		return
	}

	clearCookie(w, firstPartyRecoveryCookie, s.cfg.CookieSecure)
	clearCookie(w, firstPartySessionCookie, s.cfg.CookieSecure)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                         true,
		"login_required":             true,
		"mfa_reenrollment_required": true,
		"aal":                        "aal1",
	})
}

func requestIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
