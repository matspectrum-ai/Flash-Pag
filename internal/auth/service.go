package auth

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrInvalidUsername    = errors.New("invalid username")
	ErrUserExists         = errors.New("username already exists")
	ErrUserBlocked        = errors.New("user is not active")
)

const (
	minUsernameLen = 3
	maxUsernameLen = 32
	sessionTTL     = 24 * time.Hour
)

type User struct {
	ID       string
	Username string
	Status   string
}

type Credential struct {
	UserID       string
	PasswordHash string
	MustChange   bool
}

// Store is the persistence boundary for first-party authentication.
// Implementations must make RegisterUser atomic across the identity and credential rows.
type Store interface {
	FindUserByUsername(ctx context.Context, usernameNormalized string) (User, error)
	CreateUser(ctx context.Context, user User, credential Credential) error
	GetCredential(ctx context.Context, userID string) (Credential, error)
	CreateSession(ctx context.Context, userID, tokenHash, ipHash, userAgentHash string, expiresAt time.Time) error
	RevokeSession(ctx context.Context, tokenHash string, revokedAt time.Time) error
	FindSessionUser(ctx context.Context, tokenHash string, now time.Time) (User, error)
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Register(ctx context.Context, username, password string) (User, error) {
	normalized, err := NormalizeUsername(username)
	if err != nil {
		return User{}, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	userID, err := NewIdentityID()
	if err != nil {
		return User{}, err
	}
	user := User{ID: userID, Username: username, Status: "active"}
	err = s.store.CreateUser(ctx, user, Credential{UserID: userID, PasswordHash: hash})
	if err != nil {
		if errors.Is(err, ErrUserExists) {
			return User{}, ErrUserExists
		}
		return User{}, err
	}
	return user, nil
}

func (s *Service) Authenticate(ctx context.Context, username, password, ipHash, userAgentHash string) (User, string, time.Time, error) {
	normalized, err := NormalizeUsername(username)
	if err != nil {
		return User{}, "", time.Time{}, ErrInvalidCredentials
	}
	user, err := s.store.FindUserByUsername(ctx, normalized)
	if err != nil {
		// Run the same Argon2id verifier for unknown usernames so the cheap lookup
		// path does not expose an obvious timing distinction from a known user.
		_, _ = VerifyPassword(password, dummyPasswordHash)
		return User{}, "", time.Time{}, ErrInvalidCredentials
	}
	if user.Status != "active" {
		_, _ = VerifyPassword(password, dummyPasswordHash)
		return User{}, "", time.Time{}, ErrInvalidCredentials
	}
	credential, err := s.store.GetCredential(ctx, user.ID)
	if err != nil || credential.PasswordHash == "" {
		_, _ = VerifyPassword(password, dummyPasswordHash)
		return User{}, "", time.Time{}, ErrInvalidCredentials
	}
	valid, err := VerifyPassword(password, credential.PasswordHash)
	if err != nil || !valid {
		return User{}, "", time.Time{}, ErrInvalidCredentials
	}
	token, err := NewSessionToken()
	if err != nil {
		return User{}, "", time.Time{}, err
	}
	now := s.now()
	expiresAt := now.Add(sessionTTL)
	if err := s.store.CreateSession(ctx, user.ID, HashSessionToken(token), ipHash, userAgentHash, expiresAt); err != nil {
		return User{}, "", time.Time{}, err
	}
	return user, token, expiresAt, nil
}

func (s *Service) AuthenticateSession(ctx context.Context, token string) (User, error) {
	if strings.TrimSpace(token) == "" {
		return User{}, ErrInvalidCredentials
	}
	user, err := s.store.FindSessionUser(ctx, HashSessionToken(token), s.now())
	if err != nil || user.Status != "active" {
		return User{}, ErrInvalidCredentials
	}
	return user, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	return s.store.RevokeSession(ctx, HashSessionToken(token), s.now())
}

func NormalizeUsername(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if len(value) < minUsernameLen || len(value) > maxUsernameLen {
		return "", ErrInvalidUsername
	}
	for i, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			if i == 0 || i == len(value)-1 {
				continue
			}
			continue
		}
		return "", ErrInvalidUsername
	}
	if value[0] == '.' || value[0] == '_' || value[0] == '-' || value[len(value)-1] == '.' || value[len(value)-1] == '_' || value[len(value)-1] == '-' {
		return "", ErrInvalidUsername
	}
	return value, nil
}

func NewIdentityID() (string, error) {
	token, err := NewSessionToken()
	if err != nil {
		return "", err
	}
	return HashSessionToken(token)[:32], nil
}

const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=4$0n3az3UG+4fpTxsOhSj2iw$2mUDZHb9EsbznMPlIgvft/f7v05+ntX+Qtm8UpWZFBk"
