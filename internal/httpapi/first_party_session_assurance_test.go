package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
)

func (m *firstPartyMemoryStore) FindSession(_ context.Context, tokenHash string, now time.Time) (auth.Session, error) {
	row, ok := m.sessions[tokenHash]
	if !ok || row.revokedAt != nil || !now.Before(row.expiresAt) {
		return auth.Session{}, auth.ErrInvalidCredentials
	}
	for _, user := range m.users {
		if user.ID == row.userID {
			return auth.Session{User: user, AAL: "aal1"}, nil
		}
	}
	return auth.Session{}, auth.ErrInvalidCredentials
}

func TestFirstPartySessionAssuranceLookup(t *testing.T) {
	store := newFirstPartyMemoryStore()
	user := auth.User{ID: "33333333-3333-4333-8333-333333333333", Username: "mateus", Status: "active"}
	store.users[user.Username] = user
	rawToken := "raw-token"
	store.sessions[auth.HashSessionToken(rawToken)] = firstPartySessionRow{userID: user.ID, expiresAt: time.Now().UTC().Add(time.Hour)}

	service := auth.NewService(store)
	session, err := service.AuthenticateSessionState(context.Background(), rawToken)
	if err != nil {
		t.Fatalf("AuthenticateSessionState() error = %v", err)
	}
	if session.User.ID != user.ID || session.AAL != "aal1" {
		t.Fatalf("session = %+v, want user %s at aal1", session, user.ID)
	}
}
