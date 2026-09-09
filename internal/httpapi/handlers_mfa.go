package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"
)

func (s *Server) pendingOrSessionToken(r *http.Request) (string, error) {
	if c, err := r.Cookie("flashpag_session"); err == nil && c.Value != "" {
		return c.Value, nil
	}
	return s.readEncryptedCookie(r, mfaPendingCookie)
}

func (s *Server) consoleMFAStatus(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("flashpag_session")
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
		return
	}
	factors, err := s.sb.ListMFAFactors(r.Context(), c.Value)
	if err != nil {
		writeError(w, http.StatusBadGateway, "mfa_status_failed", "could not read authenticator status")
		return
	}
	verified := make([]map[string]any, 0)
	for _, factor := range factors.TOTP {
		if factor.Status == "verified" {
			verified = append(verified, map[string]any{"id": factor.ID, "type": factor.Type, "friendly_name": factor.FriendlyName, "status": factor.Status})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": len(verified) > 0, "factors": verified})
}

func (s *Server) consoleMFAEnroll(w http.ResponseWriter, r *http.Request) {
	token, err := s.pendingOrSessionToken(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "mfa_session_required", "authentication is required to configure the authenticator")
		return
	}
	enrollment, err := s.sb.EnrollTOTP(r.Context(), token, "Google Authenticator", "Flash Pag")
	if err != nil {
		writeError(w, http.StatusBadGateway, "mfa_enroll_failed", "could not start authenticator enrollment")
		return
	}
	if enrollment.ID == "" || enrollment.TOTP.QRCode == "" || enrollment.TOTP.Secret == "" {
		writeError(w, http.StatusBadGateway, "mfa_enroll_incomplete", "authenticator enrollment returned incomplete data")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"factor_id":     enrollment.ID,
		"friendly_name": enrollment.FriendlyName,
		"qr_code":       "data:image/svg+xml;utf-8," + enrollment.TOTP.QRCode,
		"secret":        enrollment.TOTP.Secret,
		"uri":           enrollment.TOTP.URI,
	})
}

func (s *Server) consoleMFAChallenge(w http.ResponseWriter, r *http.Request) {
	token, err := s.pendingOrSessionToken(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "mfa_session_required", "authentication is required")
		return
	}
	factorID := strings.TrimSpace(r.URL.Query().Get("factor_id"))
	if factorID == "" {
		factors, factorErr := s.sb.ListMFAFactors(r.Context(), token)
		if factorErr != nil || len(factors.TOTP) == 0 {
			writeError(w, http.StatusPreconditionRequired, "mfa_setup_required", "an authenticator factor must be enrolled first")
			return
		}
		for _, factor := range factors.TOTP {
			if factor.Status == "verified" {
				factorID = factor.ID
				break
			}
		}
	}
	challenge, err := s.sb.ChallengeMFA(r.Context(), token, factorID)
	if err != nil || challenge.ID == "" {
		writeError(w, http.StatusBadGateway, "mfa_challenge_failed", "could not create authenticator challenge")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"factor_id": factorID, "challenge_id": challenge.ID})
}

func (s *Server) consoleMFAVerify(w http.ResponseWriter, r *http.Request) {
	token, err := s.pendingOrSessionToken(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "mfa_session_required", "authentication is required")
		return
	}
	var in struct {
		FactorID    string `json:"factor_id"`
		ChallengeID string `json:"challenge_id,omitempty"`
		Code        string `json:"code"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.FactorID = strings.TrimSpace(in.FactorID)
	in.ChallengeID = strings.TrimSpace(in.ChallengeID)
	in.Code = strings.TrimSpace(in.Code)
	if in.FactorID == "" || len(in.Code) != 6 {
		writeError(w, http.StatusUnprocessableEntity, "mfa_code_invalid", "enter the 6-digit Google Authenticator code")
		return
	}
	if in.ChallengeID == "" {
		challenge, err := s.sb.ChallengeMFA(r.Context(), token, in.FactorID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "mfa_challenge_failed", "could not create authenticator challenge")
			return
		}
		in.ChallengeID = challenge.ID
	}
	session, err := s.sb.VerifyMFA(r.Context(), token, in.FactorID, in.ChallengeID, in.Code)
	if err != nil || session.AccessToken == "" {
		writeError(w, http.StatusUnauthorized, "mfa_verification_failed", "invalid or expired authenticator code")
		return
	}
	expires := session.ExpiresIn
	if expires <= 0 {
		expires = 3600
	}
	http.SetCookie(w, &http.Cookie{Name: "flashpag_session", Value: session.AccessToken, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(expires)})
	clearCookie(w, mfaPendingCookie, s.cfg.CookieSecure)
	user, err := s.sb.AuthUser(r.Context(), session.AccessToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "mfa_session_invalid", "authenticated session could not be established")
		return
	}
	if err := s.setMFAStepUp(w, user.ID, session.AccessToken); err != nil {
		writeError(w, http.StatusInternalServerError, "mfa_state_failed", "secure MFA state could not be stored")
		return
	}
	_ = s.recordSecurityEvent(r.Context(), user.ID, "", "mfa.verify", "succeeded")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) consoleMFAStepUpChallenge(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("flashpag_session")
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
		return
	}
	factors, err := s.sb.ListMFAFactors(r.Context(), c.Value)
	if err != nil {
		writeError(w, http.StatusBadGateway, "mfa_status_failed", "could not read authenticator status")
		return
	}
	factorID := ""
	for _, factor := range factors.TOTP {
		if factor.Status == "verified" {
			factorID = factor.ID
			break
		}
	}
	if factorID == "" {
		writeError(w, http.StatusPreconditionRequired, "mfa_setup_required", "an authenticator factor must be enrolled first")
		return
	}
	challenge, err := s.sb.ChallengeMFA(r.Context(), c.Value, factorID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "mfa_challenge_failed", "could not create authenticator challenge")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"factor_id": factorID, "challenge_id": challenge.ID})
}

func (s *Server) consoleMFAStepUpVerify(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("flashpag_session")
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
		return
	}
	var in struct {
		FactorID    string `json:"factor_id"`
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if len(strings.TrimSpace(in.Code)) != 6 {
		writeError(w, http.StatusUnprocessableEntity, "mfa_code_invalid", "enter the 6-digit Google Authenticator code")
		return
	}
	session, err := s.sb.VerifyMFA(r.Context(), c.Value, strings.TrimSpace(in.FactorID), strings.TrimSpace(in.ChallengeID), strings.TrimSpace(in.Code))
	if err != nil || session.AccessToken == "" {
		writeError(w, http.StatusUnauthorized, "mfa_verification_failed", "invalid or expired authenticator code")
		return
	}
	expires := session.ExpiresIn
	if expires <= 0 {
		expires = 3600
	}
	http.SetCookie(w, &http.Cookie{Name: "flashpag_session", Value: session.AccessToken, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(expires)})
	user, err := s.sb.AuthUser(r.Context(), session.AccessToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "mfa_session_invalid", "authenticated session could not be established")
		return
	}
	if err := s.setMFAStepUp(w, user.ID, session.AccessToken); err != nil {
		writeError(w, http.StatusInternalServerError, "mfa_state_failed", "secure MFA state could not be stored")
		return
	}
	_ = s.recordSecurityEvent(r.Context(), user.ID, "", "mfa.step_up", "succeeded")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) mfaFreshEnough(r *http.Request) bool {
	c, err := r.Cookie("flashpag_session")
	if err != nil || c.Value == "" {
		return false
	}
	p := consoleP(r.Context())
	return p.UserID != "" && s.hasRecentMFA(r, p.UserID, c.Value) && time.Now().Unix() > 0
}

func (s *Server) recordSecurityEvent(ctx context.Context, userID, organizationID, action, result string) error {
	body := map[string]any{"user_id": userID, "organization_id": nil, "action": action, "result": result}
	if organizationID != "" {
		body["organization_id"] = organizationID
	}
	return s.sb.Do(ctx, http.MethodPost, "/rest/v1/security_events", nil, body, "", nil)
}
