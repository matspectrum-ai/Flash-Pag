package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPreviewReadOnlyBlocksMutations(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/transfers", nil)
	rr := httptest.NewRecorder()
	previewReadOnly(true, next).ServeHTTP(rr, req)

	if called {
		t.Fatal("next handler was called for a blocked mutation")
	}
	if rr.Code != http.StatusLocked {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusLocked)
	}
}

func TestPreviewReadOnlyAllowsReadAndSessionLifecycle(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "read", method: http.MethodGet, path: "/console/api/summary"},
		{name: "login", method: http.MethodPost, path: "/console/session"},
		{name: "logout", method: http.MethodDelete, path: "/console/session"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusNoContent)
			})

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rr := httptest.NewRecorder()
			previewReadOnly(true, next).ServeHTTP(rr, req)

			if !called {
				t.Fatal("next handler was not called")
			}
			if rr.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
			}
		})
	}
}

func TestPreviewReadOnlyBlocksPlatformOrganizationProvisioning(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusCreated)
	})

	req := httptest.NewRequest(http.MethodPost, "/console/api/admin/organizations/provision", nil)
	rr := httptest.NewRecorder()
	previewReadOnly(true, next).ServeHTTP(rr, req)

	if called {
		t.Fatal("provisioning handler was called in read-only preview")
	}
	if rr.Code != http.StatusLocked {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusLocked)
	}
}
