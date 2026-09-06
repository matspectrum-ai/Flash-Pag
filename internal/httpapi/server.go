package httpapi

import (
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
	"github.com/matspectrum-ai/Flash-Pag/internal/supabase"
	"github.com/matspectrum-ai/Flash-Pag/internal/ui"
)

type Server struct {
	cfg       config.Config
	sb        *supabase.Client
	box       *cryptobox.Box
	providers *provider.Registry
	log       *slog.Logger
	mux       *http.ServeMux
}

func New(cfg config.Config, sb *supabase.Client, box *cryptobox.Box, providers *provider.Registry, log *slog.Logger) *Server {
	s := &Server{cfg: cfg, sb: sb, box: box, providers: providers, log: log, mux: http.NewServeMux()}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return securityHeaders(previewReadOnly(s.cfg.PreviewReadOnly, s.mux)) }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preview_read_only": s.cfg.PreviewReadOnly})
	})
	s.mux.HandleFunc("GET /docs", s.docs)
	s.mux.HandleFunc("GET /openapi.yaml", s.openapi)

	// Private application API. The /console prefix is retained during the React migration
	// as an implementation detail and is not exposed as product terminology in the UI.
	s.mux.HandleFunc("POST /console/session", s.login)
	s.mux.HandleFunc("DELETE /console/session", s.logout)
	s.mux.HandleFunc("GET /console/api/me", s.withConsoleAuth(s.consoleMe))
	s.mux.HandleFunc("GET /console/api/summary", s.withConsoleAuth(s.consoleSummary))
	s.mux.HandleFunc("GET /console/api/{resource}", s.withConsoleAuth(s.consoleList))
	s.mux.HandleFunc("POST /console/api/customers", s.withConsoleAuth(s.consoleCreateCustomer))
	s.mux.HandleFunc("POST /console/api/api-keys", s.withConsoleAuth(s.consoleCreateAPIKey))
	s.mux.HandleFunc("POST /console/api/provider-connections", s.withConsoleAuth(s.consoleCreateProviderConnection))
	s.mux.HandleFunc("POST /console/api/provider-connections/{id}/test", s.withConsoleAuth(s.consoleTestProviderConnection))
	s.mux.HandleFunc("POST /console/api/transactions/{id}/reconcile", s.withConsoleAuth(s.consoleReconcileTransaction))
	s.mux.HandleFunc("POST /console/api/webhook-endpoints", s.withConsoleAuth(s.consoleCreateWebhook))
	s.mux.HandleFunc("POST /console/api/transfers", s.withConsoleAuth(s.consoleCreateTransfer))
	s.mux.HandleFunc("POST /console/api/withdrawals", s.withConsoleAuth(s.consoleCreateWithdrawal))
	s.mux.HandleFunc("POST /console/api/admin/merchants", s.withAdmin(s.adminCreateMerchant))
	s.mux.HandleFunc("POST /console/api/admin/organizations", s.withAdmin(s.adminCreateOrganization))
	s.mux.HandleFunc("POST /console/api/admin/members", s.withAdmin(s.adminAddMember))

	s.mux.HandleFunc("GET /v1/balance", s.withAPIScope("balance:read", s.getBalance))
	s.mux.HandleFunc("POST /v1/pix/charges", s.withAPIScope("pix:write", s.createCharge))
	s.mux.HandleFunc("GET /v1/pix/charges/{id}", s.withAPIScope("pix:read", s.getTransaction))
	s.mux.HandleFunc("POST /v1/transfers", s.withAPIScope("pix:write", s.createTransfer))
	s.mux.HandleFunc("POST /v1/withdrawals", s.withAPIScope("pix:write", s.createWithdrawal))
	s.mux.HandleFunc("GET /v1/transactions", s.withAPIScope("pix:read", s.listTransactions))
	s.mux.HandleFunc("GET /v1/accounts", s.withAPIScope("balance:read", s.listAccounts))
	s.mux.HandleFunc("GET /v1/customers", s.withAPIScope("customers:read", s.listCustomers))
	s.mux.HandleFunc("POST /v1/customers", s.withAPIScope("customers:write", s.createCustomer))
	s.mux.HandleFunc("GET /v1/integrations", s.withAPIScope("pix:read", s.listIntegrations))
	s.mux.HandleFunc("GET /v1/webhooks", s.withAPIScope("webhooks:write", s.listWebhooks))
	s.mux.HandleFunc("POST /v1/webhooks", s.withAPIScope("webhooks:write", s.createWebhook))
	s.mux.HandleFunc("DELETE /v1/webhooks/{id}", s.withAPIScope("webhooks:write", s.deleteWebhook))

	s.mux.HandleFunc("POST /providers/{provider}/webhooks/{connectionID}", s.providerWebhook)

	legacy := http.FileServer(http.FS(ui.Files))
	s.mux.Handle("/console/", http.StripPrefix("/console/", legacy))
	s.mux.HandleFunc("GET /console", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/console/", http.StatusTemporaryRedirect)
	})

	if appRoot, err := fs.Sub(ui.AppFiles, "dist"); err == nil {
		s.mux.Handle("/app/", http.StripPrefix("/app", spaFileServer(appRoot)))
		s.mux.HandleFunc("GET /app", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "/app/", http.StatusTemporaryRedirect)
		})
	}

	s.mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/app/", http.StatusTemporaryRedirect)
	})
}

func previewReadOnly(enabled bool, next http.Handler) http.Handler {
	if !enabled {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/console/session" {
			next.ServeHTTP(w, r)
			return
		}

		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		default:
			writeError(w, http.StatusLocked, "preview_read_only", "This preview is read-only; mutating operations are disabled")
		}
	})
}

func spaFileServer(root fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(root, path); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		clone := r.Clone(r.Context())
		urlCopy := *r.URL
		urlCopy.Path = "/"
		clone.URL = &urlCopy
		fileServer.ServeHTTP(w, clone)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
func decodeJSON(r *http.Request, out any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	d.DisallowUnknownFields()
	return d.Decode(out)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(r.URL.Path, "/console") || strings.HasPrefix(r.URL.Path, "/app") {
			w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		}
		next.ServeHTTP(w, r)
	})
}
