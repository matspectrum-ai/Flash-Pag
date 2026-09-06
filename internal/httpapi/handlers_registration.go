package httpapi

import (
	"net/http"
	"strings"
	"unicode"

	"github.com/matspectrum-ai/Flash-Pag/internal/id"
)

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MerchantName     string `json:"merchant_name"`
		OrganizationName string `json:"organization_name,omitempty"`
		Email            string `json:"email"`
		Password         string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.MerchantName = strings.TrimSpace(in.MerchantName)
	in.OrganizationName = strings.TrimSpace(in.OrganizationName)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if in.MerchantName == "" || in.Email == "" || len(in.Password) < 8 {
		writeError(w, http.StatusUnprocessableEntity, "registration_invalid", "merchant_name, a valid email and a password with at least 8 characters are required")
		return
	}
	if in.OrganizationName == "" {
		in.OrganizationName = in.MerchantName
	}

	signup, err := s.sb.SignUp(r.Context(), in.Email, in.Password)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "signup_failed", "account could not be created")
		return
	}
	if signup.AlreadyExists {
		writeError(w, http.StatusConflict, "account_exists", "an account already exists for this email")
		return
	}

	baseSlug := merchantSlug(in.MerchantName)
	provisioned := false
	for attempt := 0; attempt < 3; attempt++ {
		suffix, tokenErr := id.Token(3)
		if tokenErr != nil {
			writeError(w, http.StatusInternalServerError, "provision_failed", "account could not be provisioned")
			return
		}
		slug := baseSlug + "-" + suffix
		var result map[string]any
		err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/provision_merchant_for_user", nil, map[string]any{
			"p_user_id": signup.UserID, "p_merchant_name": in.MerchantName,
			"p_organization_name": in.OrganizationName, "p_organization_slug": slug,
		}, "", &result)
		if err == nil {
			provisioned = true
			break
		}
	}
	if !provisioned {
		writeError(w, http.StatusInternalServerError, "provision_failed", "user was created but merchant provisioning failed; contact support before retrying")
		return
	}

	if signup.AccessToken != "" {
		expires := signup.ExpiresIn
		if expires <= 0 {
			expires = 3600
		}
		http.SetCookie(w, &http.Cookie{Name: "flashpag_session", Value: signup.AccessToken, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(expires)})
		writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "authenticated": true, "requires_email_confirmation": false})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "authenticated": false, "requires_email_confirmation": signup.NeedsConfirm})
}

func merchantSlug(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastDash := false
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if r <= unicode.MaxASCII {
				b.WriteRune(r)
				lastDash = false
			}
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	value := strings.Trim(b.String(), "-")
	if value == "" {
		return "merchant"
	}
	if len(value) > 48 {
		value = strings.Trim(value[:48], "-")
	}
	return value
}
