package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrInvalidUsername    = errors.New("invalid username")
	ErrUserExists         = errors.New("username already exists")
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
// Implementations must make CreateUser atomic across the identity and credential rows.
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
	user := User{ID: userID, Username: normalized, Status: "active"}
	if err := s.store.CreateUser(ctx, user, Credential{UserID: userID, PasswordHash: hash}); err != nil {
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
		// Verify against a fixed-cost hash so an unknown username does not take a
		// materially cheaper path than a known username.
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
	if value[0] == '.' || value[0] == '_' || value[0] == '-' || value[len(value)-1] == '.' || value[len(value)-1] == '_' || value[len(value)-1] == '-' {
		return "", ErrInvalidUsername
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			continue
		}
		return "", ErrInvalidUsername
	}
	return value, nil
}

func NewIdentityID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", errors.New("generate identity id")
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=4$0n3az3UG+4fpTxsOhSj2iw$2mUDZHb9EsbznMPlIgvft/f7v05+ntX+Qtm8UpWZFBk"
