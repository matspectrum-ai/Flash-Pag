package httpapi

import (
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
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
	auth      *auth.Service
	mfa       *auth.MFAService
	log       *slog.Logger
	mux       *http.ServeMux
}

func New(cfg config.Config, sb *supabase.Client, box *cryptobox.Box, providers *provider.Registry, log *slog.Logger, authServices ...*auth.Service) *Server {
	var authService *auth.Service
	if len(authServices) > 0 {
		authService = authServices[0]
	}
	s := &Server{cfg: cfg, sb: sb, box: box, providers: providers, auth: authService, log: log, mux: http.NewServeMux()}
	s.routes()
	return s
}

func NewWithMFA(cfg config.Config, sb *supabase.Client, box *cryptobox.Box, providers *provider.Registry, log *slog.Logger, authService *auth.Service, mfaService *auth.MFAService) *Server {
	s := &Server{cfg: cfg, sb: sb, box: box, providers: providers, auth: authService, mfa: mfaService, log: log, mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return securityHeaders(previewReadOnly(s.cfg.PreviewReadOnly, s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preview_read_only": s.cfg.PreviewReadOnly})
	})
	s.mux.HandleFunc("GET /docs", s.docs)
	s.mux.HandleFunc("GET /openapi.yaml", s.openapi)

	s.mux.HandleFunc("POST /auth/login", s.firstPartyLogin)
	s.mux.HandleFunc("POST /auth/logout", s.firstPartyLogout)
	s.mux.HandleFunc("GET /auth/me", s.firstPartyMe)
	s.mux.HandleFunc("GET /auth/mfa/status", s.withFirstPartyAuth(s.firstPartyMFAStatus))
	s.mux.HandleFunc("POST /auth/mfa/enroll", s.withFirstPartyAuth(s.firstPartyMFAEnroll))
	s.mux.HandleFunc("POST /auth/mfa/enroll/verify", s.withFirstPartyAuth(s.firstPartyMFAEnrollVerify))
	s.mux.HandleFunc("POST /auth/mfa/step-up", s.withFirstPartyAuth(s.firstPartyMFAStepUp))

	s.mux.HandleFunc("POST /console/register", s.register)
	s.mux.HandleFunc("POST /console/session", s.login)
	s.mux.HandleFunc("DELETE /console/session", s.logout)
	s.mux.HandleFunc("GET /console/mfa/status", s.withConsoleAuth(s.consoleMFAStatus))
	s.mux.HandleFunc("POST /console/mfa/enroll", s.consoleMFAEnroll)
	s.mux.HandleFunc("POST /console/mfa/challenge", s.consoleMFAChallenge)
	s.mux.HandleFunc("POST /console/mfa/verify", s.consoleMFAVerify)
	s.mux.HandleFunc("POST /console/mfa/step-up/challenge", s.withConsoleAuth(s.consoleMFAStepUpChallenge))
	s.mux.HandleFunc("POST /console/mfa/step-up/verify", s.withConsoleAuth(s.consoleMFAStepUpVerify))
	s.mux.HandleFunc("GET /console/recovery/status", s.withConsoleAuth(s.consoleRecoveryStatus))
	s.mux.HandleFunc("POST /console/recovery/setup", s.withRecentMFA(s.consoleRecoverySetup))
	s.mux.HandleFunc("POST /console/recovery/challenge", s.consoleRecoveryChallenge)
	s.mux.HandleFunc("POST /console/recovery/reset-password", s.consoleRecoveryResetPassword)

	s.mux.HandleFunc("GET /console/api/me", s.withConsoleAuth(s.consoleMe))
	s.mux.HandleFunc("GET /console/api/access", s.withConsoleAuth(s.consoleAccess))
	s.mux.HandleFunc("GET /console/api/summary", s.withConsoleAuth(s.consoleSummary))
	s.mux.HandleFunc("GET /console/api/kyc", s.withConsoleAuth(s.consoleKYC))
	s.mux.HandleFunc("PATCH /console/api/kyc", s.withConsoleAuth(s.consoleUpdateKYC))
	s.mux.HandleFunc("POST /console/api/kyc/documents", s.withConsoleAuth(s.consoleUploadKYCDocument))
	s.mux.HandleFunc("GET /console/api/kyc/documents/{id}", s.withConsoleAuth(s.consoleDownloadKYCDocument))
	s.mux.HandleFunc("POST /console/api/kyc/submit", s.withConsoleAuth(s.consoleSubmitKYC))
	s.mux.HandleFunc("GET /console/api/api-keys", s.withConsoleAuth(s.consoleSensitiveList("api-keys")))
	s.mux.HandleFunc("GET /console/api/webhook-endpoints", s.withConsoleAuth(s.consoleSensitiveList("webhook-endpoints")))
	s.mux.HandleFunc("GET /console/api/provider-connections", s.withConsoleAuth(s.consoleSensitiveList("provider-connections")))
	s.mux.HandleFunc("GET /console/api/transactions", s.withConsoleAuth(s.consolePricedTransactions))
	s.mux.HandleFunc("GET /console/api/members", s.withConsoleAuth(s.consoleMembers))
	s.mux.HandleFunc("POST /console/api/members", s.withConsoleAuth(s.consoleCreateMember))
	s.mux.HandleFunc("PATCH /console/api/members/{userID}", s.withConsoleAuth(s.consoleUpdateMember))
	s.mux.HandleFunc("DELETE /console/api/members/{userID}", s.withConsoleAuth(s.consoleDeleteMember))
	s.mux.HandleFunc("GET /console/api/{resource}", s.withConsoleAuth(s.consoleList))
	s.mux.HandleFunc("POST /console/api/customers", s.withConsoleAuth(s.consoleCreateCustomer))
	s.mux.HandleFunc("POST /console/api/api-keys", s.withRecentMFA(s.consoleCreateAPIKey))
	s.mux.HandleFunc("DELETE /console/api/api-keys/{id}", s.withRecentMFA(s.consoleRevokeAPIKey))
	s.mux.HandleFunc("POST /console/api/provider-connections", s.withRecentMFA(s.withKYCApprovedConsole(s.consoleCreateProviderConnection)))
	s.mux.HandleFunc("POST /console/api/provider-connections/{id}/test", s.withRecentMFA(s.consoleTestProviderConnection))
	s.mux.HandleFunc("POST /console/api/transactions/{id}/reconcile", s.withConsoleAuth(s.consoleReconcileTransaction))
	s.mux.HandleFunc("POST /console/api/webhook-endpoints", s.withRecentMFA(s.consoleCreateWebhook))
	s.mux.HandleFunc("DELETE /console/api/webhook-endpoints/{id}", s.withRecentMFA(s.consoleDeleteWebhook))
	s.mux.HandleFunc("POST /console/api/transfers", s.withRecentMFA(s.withKYCApprovedConsole(s.consoleCreateTransfer)))
	s.mux.HandleFunc("GET /console/api/withdrawal-destinations", s.withConsoleAuth(s.consoleWithdrawalDestinations))
	s.mux.HandleFunc("POST /console/api/withdrawal-destinations", s.withRecentMFA(s.withKYCApprovedConsole(s.consoleCreateWithdrawalDestination)))
	s.mux.HandleFunc("DELETE /console/api/withdrawal-destinations/{id}", s.withRecentMFA(s.withKYCApprovedConsole(s.consoleDeleteWithdrawalDestination)))
	s.mux.HandleFunc("POST /console/api/withdrawals", s.withRecentMFA(s.withKYCApprovedConsole(s.consoleCreateWithdrawal)))

	s.mux.HandleFunc("GET /console/api/admin/tenants", s.withAdmin(s.adminTenantInventory))
	s.mux.HandleFunc("GET /console/api/admin/merchants/{merchantID}/members", s.withAdmin(s.adminMerchantMembers))
	s.mux.HandleFunc("GET /console/api/admin/organizations/{organizationID}/stats", s.withAdmin(s.adminOrganizationStats))
	s.mux.HandleFunc("GET /console/api/admin/kyc", s.withAdmin(s.adminKYCQueue))
	s.mux.HandleFunc("GET /console/api/admin/kyc/{merchantID}", s.withAdmin(s.adminKYCDetail))
	s.mux.HandleFunc("GET /console/api/admin/kyc/{merchantID}/documents/{id}", s.withAdmin(s.adminDownloadKYCDocument))
	s.mux.HandleFunc("POST /console/api/admin/kyc/{merchantID}/review", s.withAdmin(s.adminStartKYCReview))
	s.mux.HandleFunc("POST /console/api/admin/kyc/{merchantID}/decision", s.withAdmin(s.adminDecideKYC))
	s.mux.HandleFunc("GET /console/api/admin/pricing/{merchantID}", s.withAdmin(s.adminPricingDetail))
	s.mux.HandleFunc("POST /console/api/admin/pricing/{merchantID}", s.withAdmin(s.adminSetPricing))
	s.mux.HandleFunc("POST /console/api/admin/merchants", s.withAdmin(s.adminCreateMerchantWithKYC))
	s.mux.HandleFunc("POST /console/api/admin/organizations", s.withAdmin(s.adminCreateOrganization))
	s.mux.HandleFunc("POST /console/api/admin/organizations/provision", s.withAdmin(s.adminProvisionOrganization))
	s.mux.HandleFunc("POST /console/api/admin/members", s.withAdmin(s.adminAddMember))

	s.mux.HandleFunc("GET /v1/balance", s.withAPIScope("balance:read", s.getBalance))
	s.mux.HandleFunc("POST /v1/pix/charges", s.withAPIScope("pix:write", s.withKYCApprovedAPI(s.createCharge)))
	s.mux.HandleFunc("GET /v1/pix/charges/{id}", s.withAPIScope("pix:read", s.getTransaction))
	s.mux.HandleFunc("POST /v1/transfers", s.withAPIScope("pix:write", s.withKYCApprovedAPI(s.createTransfer)))
	s.mux.HandleFunc("POST /v1/withdrawals", s.withAPIScope("pix:write", s.withKYCApprovedAPI(s.createWithdrawal)))
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
		if r.URL.Path == "/console/session" && (r.Method == http.MethodPost || r.Method == http.MethodDelete) {
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
		index, err := fs.ReadFile(root, "index.html")
		if err != nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func decodeJSON(r *http.Request, out any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	d.DisallowUnknownFields()
	return d.Decode(out)
}
