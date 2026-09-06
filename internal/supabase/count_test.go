package supabase

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestCountReadsExactContentRange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Prefer"); got != "count=exact" {
			t.Fatalf("Prefer = %q, want count=exact", got)
		}
		if got := r.Header.Get("Range"); got != "0-0" {
			t.Fatalf("Range = %q, want 0-0", got)
		}
		if got := r.Header.Get("apikey"); got != "secret" {
			t.Fatalf("apikey = %q, want secret", got)
		}
		if got := r.URL.Query().Get("organization_id"); got != "eq.org-1" {
			t.Fatalf("organization_id = %q, want eq.org-1", got)
		}
		w.Header().Set("Content-Range", "0-0/123")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte(`[{"id":"row-1"}]`))
	}))
	defer server.Close()

	client := New(server.URL, "secret", "publishable")
	count, err := client.Count(context.Background(), "/rest/v1/customers", url.Values{
		"organization_id": {"eq.org-1"},
		"select":          {"id"},
	})
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if count != 123 {
		t.Fatalf("Count() = %d, want 123", count)
	}
}

func TestCountRejectsMissingExactTotal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "0-0/*")
		w.WriteHeader(http.StatusPartialContent)
	}))
	defer server.Close()

	client := New(server.URL, "secret", "publishable")
	if _, err := client.Count(context.Background(), "/rest/v1/customers", nil); err == nil {
		t.Fatal("Count() error = nil, want missing exact count error")
	}
}
