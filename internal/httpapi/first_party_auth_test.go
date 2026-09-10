package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

type firstPartyMemoryStore struct {
	users       map[string]auth.User
	credentials map[string]auth.Credential
	sessions    map[string]firstPartySessionRow
}

type firstPartySessionRow struct {
	userID    string
	expiresAt time.Time
	revokedAt *time.Time
}

func newFirstPartyMemoryStore() *firstPartyMemoryStore {
	return &firstPartyMemoryStore{
		users:       map[string]auth.User{},
		credentials: map[string]auth.Credential{},
		sessions:    map[string]firstPartySessionRow{},
	}
}

func (m *firstPartyMemoryStore) FindUserByUsername(_ context.Context, username string) (auth.User, error) {
	user, ok := m.users[username]
	if !ok {
		return auth.User{}, auth.ErrInvalidCredentials
	}
	return user, nil
}

func (m *firstPartyMemoryStore) CreateUser(_ context.Context, user auth.User, credential auth.Credential) error {
	if _, ok := m.users[user.Username]; ok {
		return auth.ErrUserExists
	}
	m.users[user.Username] = user
	m.credentials[user.ID] = credential
	return nil
}

func (m *firstPartyMemoryStore) GetCredential(_ context.Context, userID string) (auth.Credential, error) {
	credential, ok := m.credentials[userID]
	if !ok {
		return auth.Credential{}, auth.ErrInvalidCredentials
	}
	return credential, nil
}

func (m *firstPartyMemoryStore) CreateSession(_ context.Context, userID, tokenHash, _, _ string, expiresAt time.Time) error {
	m.sessions[tokenHash] = firstPartySessionRow{userID: userID, expiresAt: expiresAt}
	return nil
}

func (m *firstPartyMemoryStore) RevokeSession(_ context.Context, tokenHash string, revokedAt time.Time) error {
	row, ok := m.sessions[tokenHash]
	if !ok {
		return nil
	}
	row.revokedAt = &revokedAt
	m.sessions[tokenHash] = row
	return nil
}

func (m *firstPartyMemoryStore) FindSessionUser(_ context.Context, tokenHash string, now time.Time) (auth.User, error) {
	row, ok := m.sessions[tokenHash]
	if !ok || row.revokedAt != nil || !now.Before(row.expiresAt) {
		return auth.User{}, auth.ErrInvalidCredentials
	}
	for _, user := range m.users {
		if user.ID == row.userID {
			return user, nil
		}
	}
	return auth.User{}, errors.New("user not found")
}

func newFirstPartyTestServer(store *firstPartyMemoryStore) *Server {
	service := auth.NewService(store)
	return New(config.Config{FirstPartyAuthEnabled: true}, nil, nil, provider.NewRegistry(), nil, service)
}

func TestFirstPartyAuthDisabledReturnsNotFound(t *testing.T) {
	s := New(config.Config{}, nil, nil, provider.NewRegistry(), nil)
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestFirstPartyLoginMeLogoutLifecycle(t *testing.T) {
	store := newFirstPartyMemoryStore()
	passwordHash, err := auth.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	store.users["mateus"] = auth.User{ID: "11111111-1111-4111-8111-111111111111", Username: "mateus", Status: "active"}
	store.credentials[store.users["mateus"].ID] = auth.Credential{UserID: store.users["mateus"].ID, PasswordHash: passwordHash}
	s := newFirstPartyTestServer(store)

	loginReq := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"username":"Mateus","password":"correct horse battery staple"}`))
	loginReq.RemoteAddr = "203.0.113.10:54321"
	loginReq.Header.Set("User-Agent", "test-agent")
	loginResp := httptest.NewRecorder()
	s.Handler().ServeHTTP(loginResp, loginReq)
	if loginResp.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d; body=%s", loginResp.Code, http.StatusOK, loginResp.Body.String())
	}
	cookie := loginResp.Result().Cookies()
	if len(cookie) != 1 || cookie[0].Name != firstPartySessionCookie || cookie[0].Value == "" || !cookie[0].HttpOnly || cookie[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected session cookie: %#v", cookie)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	meReq.AddCookie(cookie[0])
	meResp := httptest.NewRecorder()
	s.Handler().ServeHTTP(meResp, meReq)
	if meResp.Code != http.StatusOK || !strings.Contains(meResp.Body.String(), `"username":"mateus"`) {
		t.Fatalf("me status/body = %d/%s", meResp.Code, meResp.Body.String())
	}

	logoutReq := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	logoutReq.AddCookie(cookie[0])
	logoutResp := httptest.NewRecorder()
	s.Handler().ServeHTTP(logoutResp, logoutReq)
	if logoutResp.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d, want %d", logoutResp.Code, http.StatusNoContent)
	}

	meAfterLogoutReq := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	meAfterLogoutReq.AddCookie(cookie[0])
	meAfterLogoutResp := httptest.NewRecorder()
	s.Handler().ServeHTTP(meAfterLogoutResp, meAfterLogoutReq)
	if meAfterLogoutResp.Code != http.StatusUnauthorized {
		t.Fatalf("me after logout status = %d, want %d", meAfterLogoutResp.Code, http.StatusUnauthorized)
	}
}

func TestFirstPartyLoginFailureDoesNotSetCookie(t *testing.T) {
	store := newFirstPartyMemoryStore()
	passwordHash, err := auth.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	store.users["mateus"] = auth.User{ID: "22222222-2222-4222-8222-222222222222", Username: "mateus", Status: "active"}
	store.credentials[store.users["mateus"].ID] = auth.Credential{UserID: store.users["mateus"].ID, PasswordHash: passwordHash}
	s := newFirstPartyTestServer(store)

	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"username":"mateus","password":"wrong password"}`))
	resp := httptest.NewRecorder()
	s.Handler().ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusUnauthorized)
	}
	if got := resp.Result().Cookies(); len(got) != 0 {
		t.Fatalf("unexpected cookies on failed login: %#v", got)
	}
}
