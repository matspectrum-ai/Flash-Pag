package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

// withFirstPartyOrigin protects cookie-authenticated mutations against cross-origin requests.
// Missing Origin is allowed for non-browser callers; browser fetch/XHR requests carry it,
// while the SameSite=Lax session cookie remains the second CSRF defense.
func (s *Server) withFirstPartyOrigin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" && !s.sameOrigin(origin) {
			writeError(w, http.StatusForbidden, "csrf_origin_rejected", "request origin is not allowed")
			return
		}
		next(w, r)
	}
}

func (s *Server) sameOrigin(origin string) bool {
	originURL, err := url.Parse(origin)
	if err != nil || originURL.Scheme == "" || originURL.Host == "" || originURL.User != nil {
		return false
	}
	publicURL, err := url.Parse(strings.TrimRight(s.cfg.PublicURL, "/"))
	if err != nil || publicURL.Scheme == "" || publicURL.Host == "" || publicURL.User != nil {
		return false
	}
	return strings.EqualFold(originURL.Scheme, publicURL.Scheme) && strings.EqualFold(originURL.Host, publicURL.Host)
}
