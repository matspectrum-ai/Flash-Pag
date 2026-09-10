package supabase

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminResetMFAFactorsDeletesFactorsThroughAuthAdminAPI(t *testing.T) {
	userID := "11111111-1111-1111-1111-111111111111"
	factorIDs := []string{
		"22222222-2222-2222-2222-222222222222",
		"33333333-3333-3333-3333-333333333333",
	}

	deleted := make(map[string]bool)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer service-role-test" {
			t.Fatalf("missing admin authorization header")
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/auth/v1/admin/users/"+userID+"/factors":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]string{
				{"id": factorIDs[0]},
				{"id": factorIDs[1]},
			})
		case r.Method == http.MethodDelete && r.URL.Path == "/auth/v1/admin/users/"+userID+"/factors/"+factorIDs[0]:
			deleted[factorIDs[0]] = true
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodDelete && r.URL.Path == "/auth/v1/admin/users/"+userID+"/factors/"+factorIDs[1]:
			deleted[factorIDs[1]] = true
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := New(server.URL, "service-role-test", "publishable-test")
	if err := client.AdminResetMFAFactors(context.Background(), userID); err != nil {
		t.Fatalf("AdminResetMFAFactors() error = %v", err)
	}
	for _, factorID := range factorIDs {
		if !deleted[factorID] {
			t.Errorf("factor %s was not deleted", factorID)
		}
	}
}

func TestAdminResetMFAFactorsStopsOnDeleteFailure(t *testing.T) {
	userID := "11111111-1111-1111-1111-111111111111"
	firstFactor := "22222222-2222-2222-2222-222222222222"
	secondFactor := "33333333-3333-3333-3333-333333333333"
	secondDeleteCalled := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode([]map[string]string{{"id": firstFactor}, {"id": secondFactor}})
			return
		}
		if r.Method == http.MethodDelete && r.URL.Path == "/auth/v1/admin/users/"+userID+"/factors/"+firstFactor {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if r.Method == http.MethodDelete && r.URL.Path == "/auth/v1/admin/users/"+userID+"/factors/"+secondFactor {
			secondDeleteCalled = true
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := New(server.URL, "service-role-test", "publishable-test")
	if err := client.AdminResetMFAFactors(context.Background(), userID); err == nil {
		t.Fatal("AdminResetMFAFactors() error = nil, want error")
	}
	if secondDeleteCalled {
		t.Fatal("AdminResetMFAFactors() continued after factor deletion failure")
	}
}
