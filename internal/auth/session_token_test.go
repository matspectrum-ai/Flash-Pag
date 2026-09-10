package auth

import (
	"strings"
	"testing"
)

func TestNewSessionToken(t *testing.T) {
	a, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken() error = %v", err)
	}
	b, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken() error = %v", err)
	}
	if a == b || a == "" || b == "" {
		t.Fatal("session tokens must be non-empty and unique")
	}
	if strings.ContainsAny(a, "+/=") || strings.ContainsAny(b, "+/=") {
		t.Fatal("session token must use URL-safe base64 without padding")
	}
}

func TestHashSessionToken(t *testing.T) {
	const token = "example-token"
	if got := HashSessionToken(token); len(got) != 64 {
		t.Fatalf("HashSessionToken() length = %d, want 64", len(got))
	}
	if got := HashSessionToken(token); got != HashSessionToken(token) {
		t.Fatal("HashSessionToken() must be deterministic")
	}
	if got := HashSessionToken(token); got == HashSessionToken("other-token") {
		t.Fatal("different tokens must not share the same SHA-256 hash")
	}
}
