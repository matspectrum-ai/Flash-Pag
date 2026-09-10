package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
)

const firstPartySessionCookie = "flashpag_first_party_session"
const firstPartyPrincipalKey ctxKey = "first-party-principal"
const firstPartySessionKey ctxKey = "first-party-session"

func (s *Server) firstPartyAuthEnabled() bool {
	return s.cfg.FirstPartyAuthEnabled && s.auth != nil
}

func (s *Server) firstPartyLogin(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyAuthEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if strings.TrimSpace(in.Username) == "" || in.Password == "" {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "username or password is invalid")
		return
	}

	user, token, expiresAt, err := s.auth.Authenticate(r.Context(), in.Username, in.Password, requestIPHash(r), hashHeader(r.UserAgent()))
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", "username or password is invalid")
			return
		}
		if errors.Is(err, auth.ErrTooManyAttempts) {
			w.Header().Set("Retry-After", "900")
			writeError(w, http.StatusTooManyRequests, "too_many_attempts", "too many authentication attempts")
			return
		}
		writeError(w, http.StatusInternalServerError, "authentication_failed", "authentication service is unavailable")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     firstPartySessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"user": map[string]any{
			"id":       user.ID,
			"username": user.Username,
		},
		"aal":        "aal1",
		"expires_at": expiresAt,
	})
}

func (s *Server) firstPartyLogout(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyAuthEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	if c, err := r.Cookie(firstPartySessionCookie); err == nil && c.Value != "" {
		if err := s.auth.Logout(r.Context(), c.Value); err != nil {
			writeError(w, http.StatusInternalServerError, "logout_failed", "session could not be revoked")
			return
		}
	}
	clearCookie(w, firstPartySessionCookie, s.cfg.CookieSecure)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) firstPartyMe(w http.ResponseWriter, r *http.Request) {
	if !s.firstPartyAuthEnabled() {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
		return
	}
	c, err := r.Cookie(firstPartySessionCookie)
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
		return
	}
	session, err := s.auth.AuthenticateSessionState(r.Context(), c.Value)
	if err != nil {
		clearCookie(w, firstPartySessionCookie, s.cfg.CookieSecure)
		writeError(w, http.StatusUnauthorized, "invalid_session", "session expired or invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":       session.User.ID,
			"username": session.User.Username,
		},
		"aal": session.AAL,
	})
}

func (s *Server) withFirstPartyAuth(next http.HandlerFunc) http.HandlerFunc {
	return s.withFirstPartySession(false, next)
}

func (s *Server) withFirstPartyAAL2(next http.HandlerFunc) http.HandlerFunc {
	return s.withFirstPartySession(true, next)
}

func (s *Server) withFirstPartySession(requireRecentMFA bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.firstPartyAuthEnabled() {
			writeError(w, http.StatusNotFound, "not_found", "endpoint not available")
			return
		}
		c, err := r.Cookie(firstPartySessionCookie)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "not_authenticated", "login required")
			return
		}
		session, err := s.auth.AuthenticateSessionState(r.Context(), c.Value)
		if err != nil {
			clearCookie(w, firstPartySessionCookie, s.cfg.CookieSecure)
			writeError(w, http.StatusUnauthorized, "invalid_session", "session expired or invalid")
			return
		}
		if requireRecentMFA && !s.auth.SessionHasRecentMFA(session) {
			writeError(w, http.StatusPreconditionRequired, "mfa_required", "recent multi-factor authentication is required")
			return
		}
		ctx := context.WithValue(r.Context(), firstPartyPrincipalKey, session.User)
		ctx = context.WithValue(ctx, firstPartySessionKey, session)
		next(w, r.WithContext(ctx))
	}
}

func firstPartyP(ctx context.Context) auth.User {
	user, _ := ctx.Value(firstPartyPrincipalKey).(auth.User)
	return user
}

func firstPartySession(ctx context.Context) auth.Session {
	session, _ := ctx.Value(firstPartySessionKey).(auth.Session)
	return session
}

func hashHeader(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func requestIPHash(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	return hashHeader(host)
}
