package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/recovery"
)

const recoveryCookie = "flashpag_recovery_pending"
const recoveryTTL = 15 * time.Minute

type recoveryCookiePayload struct {
	ChallengeID string `json:"challenge_id"`
	Token       string `json:"token"`
	UserID      string `json:"user_id"`
	KeyID       string `json:"key_id"`
	ExpiresAt   int64  `json:"expires_at"`
}

func (s *Server) consoleRecoveryStatus(w http.ResponseWriter, r *http.Request) {
	p := consoleP(r.Context())
	var rows []struct {
		CreatedAt *string `json:"created_at"`
		RotatedAt *string `json:"rotated_at"`
	}
	q := url.Values{"user_id": {"eq." + p.UserID}, "status": {"eq.active"}, "select": {"created_at,rotated_at"}, "limit": {"1"}}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/account_recovery_kits", q, nil, "", &rows); err != nil {
		writeError(w, http.StatusBadGateway, "recovery_status_failed", "could not read recovery status")
		return
	}
	if len(rows) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"configured": true, "created_at": rows[0].CreatedAt, "rotated_at": rows[0].RotatedAt})
}

func (s *Server) consoleRecoverySetup(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("flashpag_session")
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
		return
	}
	user, err := s.sb.AuthUser(r.Context(), c.Value)
	if err != nil || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "invalid_session", "session expired or invalid")
		return
	}
	if !s.hasRecentMFA(r, user.ID, c.Value) {
		writeError(w, http.StatusPreconditionRequired, "mfa_required", "Google Authenticator verification is required to create a recovery kit")
		return
	}
	kit, data, err := recovery.Generate(user.ID, s.cfg.MasterKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "recovery_generate_failed", "could not create the recovery kit")
		return
	}
	verifier, err := recovery.Verifier(s.cfg.MasterKey, kit.Secret[:])
	if err != nil {
		writeError(w, http.StatusInternalServerError, "recovery_generate_failed", "could not create the recovery kit")
		return
	}
	if err := s.sb.RotateRecoveryKit(r.Context(), user.ID, kit.KeyID, verifier); err != nil {
		writeError(w, http.StatusBadGateway, "recovery_store_failed", "could not activate the recovery kit")
		return
	}
	_ = s.recordSecurityEvent(r.Context(), user.ID, "", "recovery.created", "succeeded")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"filename":       "account-recovery-" + user.ID + ".recovery",
		"content_base64": base64.StdEncoding.EncodeToString(data),
	})
}

func (s *Server) recoveryRateAllowed(ctx context.Context, identifier string, r *http.Request, subjectLimit, ipLimit int) bool {
	ip := strings.TrimSpace(r.Header.Get("X-Real-IP"))
	if ip == "" {
		ip = strings.TrimSpace(r.RemoteAddr)
	}
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	subjectHash, err := recovery.RateHash(s.cfg.MasterKey, "subject", strings.ToLower(strings.TrimSpace(identifier)))
	if err != nil {
		return false
	}
	ipHash, err := recovery.RateHash(s.cfg.MasterKey, "ip", ip)
	if err != nil {
		return false
	}
	ok, err := s.sb.RecoveryRateLimit(ctx, subjectHash, ipHash, subjectLimit, ipLimit)
	return err == nil && ok
}

func (s *Server) consoleRecoveryChallenge(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Identifier string `json:"identifier"`
		KitBase64  string `json:"kit_base64"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid recovery request")
		return
	}
	identifier := strings.ToLower(strings.TrimSpace(in.Identifier))
	if !s.recoveryRateAllowed(r.Context(), identifier, r, 5, 20) {
		writeError(w, http.StatusTooManyRequests, "recovery_rate_limited", "recovery is temporarily unavailable; try again later")
		return
	}
	if identifier == "" || len(in.KitBase64) > 8192 {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	data, err := base64.StdEncoding.DecodeString(in.KitBase64)
	if err != nil || len(data) > 4096 {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	kit, err := recovery.Parse(data, s.cfg.MasterKey)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	if !strings.EqualFold(strings.TrimSpace(kit.AccountID), identifier) {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	user, err := s.sb.AdminGetUserByID(r.Context(), kit.AccountID)
	if err != nil || user.ID == "" || !strings.EqualFold(strings.TrimSpace(user.ID), kit.AccountID) {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	row, err := s.sb.RecoveryKit(r.Context(), kit.AccountID, kit.KeyID)
	if err != nil || row.Version != 1 {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	verifier, err := recovery.Verifier(s.cfg.MasterKey, kit.Secret[:])
	if err != nil || !constantTimeEqual(verifier, row.SecretVerifier) {
		writeError(w, http.StatusUnauthorized, "recovery_failed", "recovery information is invalid")
		return
	}
	challengeTokenBytes := make([]byte, 32)
	if _, err := rand.Read(challengeTokenBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "recovery_failed", "recovery could not be started")
		return
	}
	challengeToken := hex.EncodeToString(challengeTokenBytes)
	sum := sha256.Sum256([]byte(challengeToken))
	expiresAt := time.Now().Add(recoveryTTL)
	challenge, err := s.sb.CreateRecoveryChallenge(r.Context(), kit.AccountID, kit.KeyID, hex.EncodeToString(sum[:]), expiresAt)
	if err != nil {
		writeError(w, http.StatusBadGateway, "recovery_failed", "recovery could not be started")
		return
	}
	payload := recoveryCookiePayload{ChallengeID: challenge.ID, Token: challengeToken, UserID: kit.AccountID, KeyID: kit.KeyID, ExpiresAt: expiresAt.Unix()}
	encoded, err := marshalJSON(payload)
	if err != nil || s.setEncryptedCookie(w, recoveryCookie, string(encoded), int(recoveryTTL.Seconds())) != nil {
		writeError(w, http.StatusInternalServerError, "recovery_failed", "recovery could not be started")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "expires_in": int(recoveryTTL.Seconds())})
}

func (s *Server) consoleRecoveryResetPassword(w http.ResponseWriter, r *http.Request) {
	value, err := s.readEncryptedCookie(r, recoveryCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "recovery_required", "a valid recovery verification is required")
		return
	}
	var state recoveryCookiePayload
	if unmarshalJSON([]byte(value), &state) != nil || state.ChallengeID == "" || state.Token == "" || state.UserID == "" || time.Now().Unix() >= state.ExpiresAt {
		clearCookie(w, recoveryCookie, s.cfg.CookieSecure)
		writeError(w, http.StatusUnauthorized, "recovery_required", "recovery verification expired")
		return
	}
	if !s.recoveryRateAllowed(r.Context(), state.UserID, r, 10, 30) {
		writeError(w, http.StatusTooManyRequests, "recovery_rate_limited", "recovery is temporarily unavailable; try again later")
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
	sum := sha256.Sum256([]byte(state.Token))
	claim, err := s.sb.BeginRecoveryReset(r.Context(), state.ChallengeID, hex.EncodeToString(sum[:]))
	if err != nil || claim.UserID != state.UserID || claim.KeyID != state.KeyID {
		clearCookie(w, recoveryCookie, s.cfg.CookieSecure)
		writeError(w, http.StatusUnauthorized, "recovery_required", "recovery verification is invalid or expired")
		return
	}
	if claim.Status != "consuming" {
		clearCookie(w, recoveryCookie, s.cfg.CookieSecure)
		writeError(w, http.StatusUnauthorized, "recovery_required", "recovery verification is invalid or expired")
		return
	}
	if err := s.sb.AdminUpdateUserPassword(r.Context(), claim.UserID, in.Password); err != nil {
		_, _ = s.sb.AbortRecoveryReset(r.Context(), state.ChallengeID, claim.UserID, claim.KeyID)
		writeError(w, http.StatusBadGateway, "password_reset_failed", "password could not be changed")
		return
	}
	if err := s.sb.AdminResetMFAFactors(r.Context(), claim.UserID); err != nil {
		_, _ = s.sb.AbortRecoveryReset(r.Context(), state.ChallengeID, claim.UserID, claim.KeyID)
		writeError(w, http.StatusBadGateway, "mfa_reset_failed", "authenticator reset could not be completed")
		return
	}
	if ok, err := s.sb.FinalizeRecoveryReset(r.Context(), state.ChallengeID, claim.UserID, claim.KeyID); err != nil || !ok {
		writeError(w, http.StatusBadGateway, "recovery_finalize_failed", "recovery could not be finalized")
		return
	}
	clearCookie(w, recoveryCookie, s.cfg.CookieSecure)
	clearCookie(w, mfaPendingCookie, s.cfg.CookieSecure)
	clearCookie(w, mfaStepUpCookie, s.cfg.CookieSecure)
	_ = s.recordSecurityEvent(r.Context(), claim.UserID, "", "recovery.password_reset", "succeeded")
	_ = s.recordSecurityEvent(r.Context(), claim.UserID, "", "recovery.sessions_revoked", "succeeded")
	_ = s.recordSecurityEvent(r.Context(), claim.UserID, "", "mfa.reset", "succeeded")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "login_required": true, "mfa_reenrollment_required": true})
}

func marshalJSON(v any) ([]byte, error)      { return json.Marshal(v) }
func unmarshalJSON(data []byte, v any) error { return json.Unmarshal(data, v) }

func constantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
