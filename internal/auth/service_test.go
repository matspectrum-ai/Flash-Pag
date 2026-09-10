package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type memoryStore struct {
	users       map[string]User
	credentials map[string]Credential
	sessions    map[string]sessionRow
}

type sessionRow struct {
	userID    string
	expiresAt time.Time
	revokedAt *time.Time
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:       map[string]User{},
		credentials: map[string]Credential{},
		sessions:    map[string]sessionRow{},
	}
}

func (m *memoryStore) FindUserByUsername(_ context.Context, username string) (User, error) {
	user, ok := m.users[username]
	if !ok {
		return User{}, errors.New("not found")
	}
	return user, nil
}

func (m *memoryStore) CreateUser(_ context.Context, user User, credential Credential) error {
	if _, exists := m.users[user.Username]; exists {
		return ErrUserExists
	}
	m.users[user.Username] = user
	m.credentials[user.ID] = credential
	return nil
}

func (m *memoryStore) GetCredential(_ context.Context, userID string) (Credential, error) {
	credential, ok := m.credentials[userID]
	if !ok {
		return Credential{}, errors.New("not found")
	}
	return credential, nil
}

func (m *memoryStore) CreateSession(_ context.Context, userID, tokenHash, _, _ string, expiresAt time.Time) error {
	m.sessions[tokenHash] = sessionRow{userID: userID, expiresAt: expiresAt}
	return nil
}

func (m *memoryStore) RevokeSession(_ context.Context, tokenHash string, revokedAt time.Time) error {
	row, ok := m.sessions[tokenHash]
	if !ok {
		return nil
	}
	row.revokedAt = &revokedAt
	m.sessions[tokenHash] = row
	return nil
}

func (m *memoryStore) FindSessionUser(_ context.Context, tokenHash string, now time.Time) (User, error) {
	row, ok := m.sessions[tokenHash]
	if !ok || row.revokedAt != nil || !now.Before(row.expiresAt) {
		return User{}, errors.New("invalid session")
	}
	for _, user := range m.users {
		if user.ID == row.userID {
			return user, nil
		}
	}
	return User{}, errors.New("user not found")
}

func TestNormalizeUsername(t *testing.T) {
	got, err := NormalizeUsername("  Mateus.Silva  ")
	if err != nil || got != "mateus.silva" {
		t.Fatalf("NormalizeUsername() = %q, %v", got, err)
	}
	for _, invalid := range []string{"ab", ".mateus", "mateus_", "mateus espaço", "éuser"} {
		if _, err := NormalizeUsername(invalid); !errors.Is(err, ErrInvalidUsername) {
			t.Fatalf("NormalizeUsername(%q) error = %v", invalid, err)
		}
	}
}

func TestServiceRegisterAndAuthenticate(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store)

	user, err := service.Register(context.Background(), "  Mateus  ", "correct horse battery staple")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if user.Username != "mateus" || user.ID == "" {
		t.Fatalf("Register() returned invalid user: %+v", user)
	}
	if _, err := service.Register(context.Background(), "MATEUS", "another valid password"); !errors.Is(err, ErrUserExists) {
		t.Fatalf("duplicate Register() error = %v", err)
	}

	fixedNow := time.Date(2026, 9, 10, 15, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }
	authenticated, token, expiresAt, err := service.Authenticate(context.Background(), "MATEUS", "correct horse battery staple", "ip", "ua")
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if authenticated.ID != user.ID || token == "" || !expiresAt.Equal(fixedNow.Add(sessionTTL)) {
		t.Fatalf("Authenticate() returned invalid result: user=%+v token-empty=%t expires=%v", authenticated, token == "", expiresAt)
	}
	if _, err := service.Authenticate(context.Background(), "mateus", "wrong password", "ip", "ua"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("invalid password error = %v", err)
	}
	if _, err := service.Authenticate(context.Background(), "unknown", "wrong password", "ip", "ua"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("unknown username error = %v", err)
	}

	sessionUser, err := service.AuthenticateSession(context.Background(), token)
	if err != nil || sessionUser.ID != user.ID {
		t.Fatalf("AuthenticateSession() = %+v, %v", sessionUser, err)
	}
	if err := service.Logout(context.Background(), token); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	if _, err := service.AuthenticateSession(context.Background(), token); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("revoked session error = %v", err)
	}
}
