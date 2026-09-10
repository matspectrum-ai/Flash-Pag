package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

func TestFirstPartyOriginRejectsCrossOriginMutation(t *testing.T) {
	s := New(config.Config{
		FirstPartyAuthEnabled: true,
		PublicURL:             "https://app.flashpag.local",
	}, nil, nil, provider.NewRegistry(), nil)

	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.Header.Set("Origin", "https://evil.example")
	resp := httptest.NewRecorder()
	s.Handler().ServeHTTP(resp, req)

	if resp.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusForbidden)
	}
}

func TestFirstPartyOriginAcceptsConfiguredOrigin(t *testing.T) {
	s := New(config.Config{
		FirstPartyAuthEnabled: true,
		PublicURL:             "https://app.flashpag.local",
	}, nil, nil, provider.NewRegistry(), nil)

	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.Header.Set("Origin", "https://app.flashpag.local")
	resp := httptest.NewRecorder()
	s.Handler().ServeHTTP(resp, req)

	if resp.Code == http.StatusForbidden {
		t.Fatalf("same-origin request was rejected as CSRF: body=%s", resp.Body.String())
	}
}

func TestFirstPartyOriginRejectsNullOrigin(t *testing.T) {
	s := New(config.Config{
		FirstPartyAuthEnabled: true,
		PublicURL:             "https://app.flashpag.local",
	}, nil, nil, provider.NewRegistry(), nil)

	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.Header.Set("Origin", "null")
	resp := httptest.NewRecorder()
	s.Handler().ServeHTTP(resp, req)

	if resp.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusForbidden)
	}
}
