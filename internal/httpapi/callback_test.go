package httpapi

import (
	"testing"

	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

func TestIsLoopbackURL(t *testing.T) {
	cases := []struct {
		raw  string
		want bool
	}{
		{"http://127.0.0.1:18080", true},
		{"http://localhost:8080", true},
		{"http://LOCALHOST:8080/", true},
		{"http://[::1]:8080", true},
		{"http://127.0.0.2:8080/", true},
		{"https://example.com", false},
		{"https://app.example.com/cb", false},
		{"", true},
		{"not a url with spaces", true},
	}
	for _, c := range cases {
		if got := isLoopbackURL(c.raw); got != c.want {
			t.Errorf("isLoopbackURL(%q)=%v want %v", c.raw, got, c.want)
		}
	}
}

func TestProviderCallbackURLSkipsLoopback(t *testing.T) {
	conn := provider.Connection{ID: "conn-1", ProviderCode: "pixhub"}
	loop := &Server{cfg: config.Config{PublicURL: "http://127.0.0.1:18080"}}
	if got := loop.providerCallbackURL(conn); got != "" {
		t.Fatalf("loopback callback=%q want empty", got)
	}
	pub := &Server{cfg: config.Config{PublicURL: "https://example.com"}}
	want := "https://example.com/providers/pixhub/webhooks/conn-1"
	if got := pub.providerCallbackURL(conn); got != want {
		t.Fatalf("public callback=%q want %q", got, want)
	}
}
