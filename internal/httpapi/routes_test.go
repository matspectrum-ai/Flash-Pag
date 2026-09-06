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
