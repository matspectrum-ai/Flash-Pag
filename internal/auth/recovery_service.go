package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/recovery"
)

const firstPartyRecoveryTTL = 15 * time.Minute

var (
	ErrRecoveryUnavailable = errors.New("recovery information is invalid or expired")
	ErrRecoveryRateLimited = errors.New("recovery is temporarily unavailable")
	ErrRecoveryPassword    = errors.New("password is invalid")
)

type RecoveryService struct {
	store     RecoveryStore
	serverKey []byte
	now       func() time.Time
}

type RecoveryKitState struct {
	UserID      string
	KeyID       string
	Filename    string
	ContentBase64 string
}

type RecoveryChallengeState struct {
	ID        string
	Token     string
	UserID    string
	KeyID     string
	ExpiresAt time.Time
}

func NewRecoveryService(store RecoveryStore, serverKey []byte) *RecoveryService {
	key := append([]byte(nil), serverKey...)
	return &RecoveryService{store: store, serverKey: key, now: func() time.Time { return time.Now().UTC() }}
}

func (s *RecoveryService) CreateKit(ctx context.Context, userID string) (RecoveryKitState, error) {
	if s == nil || s.store == nil || len(s.serverKey) < 32 || strings.TrimSpace(userID) == "" {
		return RecoveryKitState{}, ErrRecoveryUnavailable
	}
	kit, data, err := recovery.Generate(userID, s.serverKey)
	if err != nil {
		return RecoveryKitState{}, ErrRecoveryUnavailable
	}
	verifier, err := recovery.Verifier(s.serverKey, kit.Secret[:])
	if err != nil {
		return RecoveryKitState{}, ErrRecoveryUnavailable
	}
	if err := s.store.RotateRecoveryKit(ctx, userID, kit.KeyID, verifier); err != nil {
		return RecoveryKitState{}, err
	}
	return RecoveryKitState{
		UserID:        userID,
		KeyID:         kit.KeyID,
		Filename:      "account-recovery-" + userID + ".recovery",
		ContentBase64: hex.EncodeToString(data),
	}, nil
}

func (s *RecoveryService) BeginChallenge(ctx context.Context, identifier string, kitData []byte, ipHash string) (RecoveryChallengeState, error) {
	if s == nil || s.store == nil || len(s.serverKey) < 32 {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	identifier = strings.ToLower(strings.TrimSpace(identifier))
	if identifier == "" || len(kitData) == 0 || len(kitData) > 4096 {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	subjectHash, err := recovery.RateHash(s.serverKey, "subject", identifier)
	if err != nil {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	ipHash, err = recovery.RateHash(s.serverKey, "ip", strings.TrimSpace(ipHash))
	if err != nil {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	allowed, err := s.store.AllowRecoveryAttempt(ctx, subjectHash, ipHash, 5, 20)
	if err != nil {
		return RecoveryChallengeState{}, err
	}
	if !allowed {
		return RecoveryChallengeState{}, ErrRecoveryRateLimited
	}
	kit, err := recovery.Parse(kitData, s.serverKey)
	if err != nil || !strings.EqualFold(strings.TrimSpace(kit.AccountID), identifier) {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	record, err := s.store.GetRecoveryKit(ctx, kit.AccountID, kit.KeyID)
	if err != nil || record.Version != 1 || record.Status != "active" {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	verifier, err := recovery.Verifier(s.serverKey, kit.Secret[:])
	if err != nil || len(record.SecretVerifier) != len(verifier) || subtle.ConstantTimeCompare([]byte(verifier), []byte(record.SecretVerifier)) != 1 {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	var rawToken [32]byte
	if _, err := rand.Read(rawToken[:]); err != nil {
		return RecoveryChallengeState{}, ErrRecoveryUnavailable
	}
	token := hex.EncodeToString(rawToken[:])
	tokenSum := sha256.Sum256([]byte(token))
	expiresAt := s.now().Add(firstPartyRecoveryTTL)
	challengeID, err := s.store.CreateRecoveryChallenge(ctx, kit.AccountID, kit.KeyID, hex.EncodeToString(tokenSum[:]), expiresAt)
	if err != nil {
		return RecoveryChallengeState{}, err
	}
	return RecoveryChallengeState{ID: challengeID, Token: token, UserID: kit.AccountID, KeyID: kit.KeyID, ExpiresAt: expiresAt}, nil
}

func (s *RecoveryService) ResetPassword(ctx context.Context, challengeID, token, userID, keyID, password, passwordConfirm string) error {
	if s == nil || s.store == nil {
		return ErrRecoveryUnavailable
	}
	if len(password) < 8 || len(password) > 128 || password != passwordConfirm {
		return ErrRecoveryPassword
	}
	if strings.TrimSpace(challengeID) == "" || strings.TrimSpace(token) == "" || strings.TrimSpace(userID) == "" || strings.TrimSpace(keyID) == "" {
		return ErrRecoveryUnavailable
	}
	tokenSum := sha256.Sum256([]byte(token))
	claim, err := s.store.BeginRecoveryReset(ctx, challengeID, hex.EncodeToString(tokenSum[:]))
	if err != nil {
		return ErrRecoveryUnavailable
	}
	if claim.Status != "consuming" || claim.UserID != userID || claim.KeyID != keyID || claim.AttemptID == "" {
		return ErrRecoveryUnavailable
	}
	hash, err := HashPassword(password)
	if err != nil {
		_, _ = s.store.AbortRecoveryReset(ctx, challengeID, claim.UserID, claim.KeyID, claim.AttemptID)
		return ErrRecoveryPassword
	}
	applied, err := s.store.ApplyRecoveryReset(ctx, challengeID, claim.UserID, claim.KeyID, claim.AttemptID, hash)
	if err != nil {
		_, _ = s.store.AbortRecoveryReset(ctx, challengeID, claim.UserID, claim.KeyID, claim.AttemptID)
		return err
	}
	if !applied {
		_, _ = s.store.AbortRecoveryReset(ctx, challengeID, claim.UserID, claim.KeyID, claim.AttemptID)
		return ErrRecoveryUnavailable
	}
	return nil
}

func RecoveryTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
