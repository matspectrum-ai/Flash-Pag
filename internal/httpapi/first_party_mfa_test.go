package httpapi

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

type firstPartyMFAMemoryStore struct {
	*firstPartyMemoryStore
	factor *auth.TOTPFactor
}

func (m *firstPartyMFAMemoryStore) GetTOTPFactor(_ context.Context, userID string) (auth.TOTPFactor, error) {
	if m.factor == nil || m.factor.UserID != userID {
		return auth.TOTPFactor{}, auth.ErrMFANotEnrolled
	}
	return *m.factor, nil
}

func (m *firstPartyMFAMemoryStore) CreateTOTPFactor(_ context.Context, factor auth.TOTPFactor) error {
	copy := factor
	m.factor = &copy
	return nil
}

func (m *firstPartyMFAMemoryStore) ConfirmTOTPEnrollment(_ context.Context, userID string, step int64, _ time.Time) error {
	if m.factor == nil || m.factor.UserID != userID {
		return auth.ErrMFANotEnrolled
	}
	if m.factor.LastUsedStep != nil && step <= *m.factor.LastUsedStep {
		return auth.ErrMFAReplay
	}
	m.factor.Enabled = true
	m.factor.LastUsedStep = &step
	return nil
}

func (m *firstPartyMFAMemoryStore) ConsumeTOTPAndElevate(_ context.Context, userID, tokenHash string, step int64, _ time.Time) error {
	if m.factor == nil || m.factor.UserID != userID || !m.factor.Enabled {
		return auth.ErrMFANotEnrolled
	}
	if m.factor.LastUsedStep != nil && step <= *m.factor.LastUsedStep {
		return auth.ErrMFAReplay
	}
	row, ok := m.sessions[tokenHash]
	if !ok || row.revokedAt != nil {
		return auth.ErrMFAInvalidSession
	}
	m.factor.LastUsedStep = &step
	return nil
}

func newFirstPartyMFATestServer(store *firstPartyMFAMemoryStore) *Server {
	service := auth.NewService(store)
	key, err := base64.StdEncoding.DecodeString("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
	if err != nil {
		panic(err)
	}
	box, err := cryptobox.New(key)
	if err != nil {
		panic(err)
	}
	mfa := auth.NewMFAService(store, box)
	return NewWithMFA(config.Config{FirstPartyAuthEnabled: true}, nil, box, provider.NewRegistry(), nil, service, mfa)
}

func TestFirstPartyMFAStatusAndEnrollmentBoundary(t *testing.T) {
	store := &firstPartyMFAMemoryStore{firstPartyMemoryStore: newFirstPartyMemoryStore()}
	user := auth.User{ID: "44444444-4444-4444-8444-444444444444", Username: "mateus", Status: "active"}
	store.users[user.Username] = user
	store.sessions[auth.HashSessionToken("session")] = firstPartySessionRow{userID: user.ID, expiresAt: time.Now().UTC().Add(time.Hour)}
	s := newFirstPartyMFATestServer(store)

	req := httptest.NewRequest(http.MethodGet, "/auth/mfa/status", nil)
	req.AddCookie(&http.Cookie{Name: firstPartySessionCookie, Value: "session"})
	resp := httptest.NewRecorder()
	s.Handler().ServeHTTP(resp, req)
	if resp.Code != http.StatusOK || !strings.Contains(resp.Body.String(), `"enabled":false`) {
		t.Fatalf("status response = %d/%s", resp.Code, resp.Body.String())
	}

	enrollReq := httptest.NewRequest(http.MethodPost, "/auth/mfa/enroll", nil)
	enrollReq.AddCookie(&http.Cookie{Name: firstPartySessionCookie, Value: "session"})
	enrollResp := httptest.NewRecorder()
	s.Handler().ServeHTTP(enrollResp, enrollReq)
	if enrollResp.Code != http.StatusOK {
		t.Fatalf("enroll status = %d, body=%s", enrollResp.Code, enrollResp.Body.String())
	}
	if store.factor == nil || store.factor.SecretCiphertext == "" {
		t.Fatal("enrollment did not persist an encrypted factor")
	}
	if strings.Contains(enrollResp.Body.String(), store.factor.SecretCiphertext) {
		t.Fatal("raw ciphertext leaked in enrollment response")
	}
}

func TestFirstPartyMFAVerifyRejectsInvalidCode(t *testing.T) {
	store := &firstPartyMFAMemoryStore{firstPartyMemoryStore: newFirstPartyMemoryStore(), factor: &auth.TOTPFactor{UserID: "55555555-5555-4555-8555-555555555555", SecretCiphertext: "", Enabled: false}}
	user := auth.User{ID: store.factor.UserID, Username: "mateus", Status: "active"}
	store.users[user.Username] = user
	store.sessions[auth.HashSessionToken("session")] = firstPartySessionRow{userID: user.ID, expiresAt: time.Now().UTC().Add(time.Hour)}
	key, _ := base64.StdEncoding.DecodeString("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
	box, _ := cryptobox.New(key)
	ciphertext, _ := box.Seal([]byte("JBSWY3DPEHPK3PXP"))
	store.factor.SecretCiphertext = ciphertext
	s := NewWithMFA(config.Config{FirstPartyAuthEnabled: true}, nil, box, provider.NewRegistry(), nil, auth.NewService(store), auth.NewMFAService(store, box))

	req := httptest.NewRequest(http.MethodPost, "/auth/mfa/enroll/verify", strings.NewReader(`{"code":"000000"}`))
	req.AddCookie(&http.Cookie{Name: firstPartySessionCookie, Value: "session"})
	resp := httptest.NewRecorder()
	s.Handler().ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusUnauthorized)
	}
}
