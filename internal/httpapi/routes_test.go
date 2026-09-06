package httpapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

func TestRootRouteRedirectsToApp(t *testing.T) {
	s := New(config.Config{}, nil, nil, provider.NewRegistry(), slog.Default())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusTemporaryRedirect)
	}
	if got := rr.Header().Get("Location"); got != "/app/" {
		t.Fatalf("Location = %q, want %q", got, "/app/")
	}
}

func TestAppRouteFallsBackToSPAIndex(t *testing.T) {
	s := New(config.Config{}, nil, nil, provider.NewRegistry(), slog.Default())

	req := httptest.NewRequest(http.MethodGet, "/app/transactions", nil)
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got == "" {
		t.Fatal("Content-Type is empty")
	}
}

func TestPhase3AppRoutesFallBackToSPAIndex(t *testing.T) {
	s := New(config.Config{}, nil, nil, provider.NewRegistry(), slog.Default())
	paths := []string{
		"/app/platform/finance",
		"/app/platform/merchants/00000000-0000-0000-0000-000000000000",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rr := httptest.NewRecorder()
			s.Handler().ServeHTTP(rr, req)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
			}
		})
	}
}

func TestPhase3AdminReadRoutesRequireAuthentication(t *testing.T) {
	s := New(config.Config{}, nil, nil, provider.NewRegistry(), slog.Default())
	paths := []string{
		"/console/api/admin/tenants",
		"/console/api/admin/merchants/00000000-0000-0000-0000-000000000000/members",
		"/console/api/admin/organizations/00000000-0000-0000-0000-000000000000/stats",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rr := httptest.NewRecorder()
			s.Handler().ServeHTTP(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
			}
		})
	}
}
