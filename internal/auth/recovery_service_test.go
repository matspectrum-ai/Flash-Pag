package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/recovery"
)

type recoveryStoreStub struct {
	kit             RecoveryKitRecord
	allow           bool
	challengeID     string
	challenge       RecoveryChallenge
	applyCalls      int
	abortCalls      int
	lastPasswordHash string
}

func (s *recoveryStoreStub) GetRecoveryKit(context.Context, string, string) (RecoveryKitRecord, error) {
	if s.kit.Status == "" {
		return RecoveryKitRecord{}, ErrRecoveryUnavailable
	}
	return s.kit, nil
}

func (s *recoveryStoreStub) CreateRecoveryChallenge(context.Context, string, string, string, time.Time) (string, error) {
	if s.challengeID == "" {
		return "", errors.New("challenge id not configured")
	}
	return s.challengeID, nil
}

func (s *recoveryStoreStub) BeginRecoveryReset(context.Context, string, string) (RecoveryChallenge, error) {
	if s.challenge.ID == "" {
		return RecoveryChallenge{}, ErrRecoveryUnavailable
	}
	return s.challenge, nil
}

func (s *recoveryStoreStub) ApplyRecoveryReset(_ context.Context, _ string, _ string, _ string, _ string, passwordHash string) (bool, error) {
	s.applyCalls++
	s.lastPasswordHash = passwordHash
	return true, nil
}

func (s *recoveryStoreStub) AbortRecoveryReset(context.Context, string, string, string, string) (bool, error) {
	s.abortCalls++
	return true, nil
}

func (s *recoveryStoreStub) AllowRecoveryAttempt(context.Context, string, string, int, int) (bool, error) {
	return s.allow, nil
}

func TestRecoveryServiceBeginChallengeVerifiesKitBeforeIssuingToken(t *testing.T) {
	serverKey := bytesOf('k', 32)
	kit, encoded, err := recovery.Generate("11111111-1111-4111-8111-111111111111", serverKey)
	if err != nil {
		t.Fatalf("generate recovery kit: %v", err)
	}
	verifier, err := recovery.Verifier(serverKey, kit.Secret[:])
	if err != nil {
		t.Fatalf("generate verifier: %v", err)
	}

	stub := &recoveryStoreStub{
		kit: RecoveryKitRecord{
			UserID:         kit.AccountID,
			KeyID:          kit.KeyID,
			Version:        1,
			SecretVerifier: verifier,
			Status:         "active",
		},
		allow:       true,
		challengeID: "22222222-2222-4222-8222-222222222222",
	}
	service := NewRecoveryService(stub, serverKey)
	service.now = func() time.Time { return time.Unix(1000, 0).UTC() }

	state, err := service.BeginChallenge(context.Background(), kit.AccountID, encoded, "203.0.113.10")
	if err != nil {
		t.Fatalf("begin challenge: %v", err)
	}
	if state.ID != stub.challengeID || state.UserID != kit.AccountID || state.KeyID != kit.KeyID {
		t.Fatalf("challenge state = %#v", state)
	}
	if state.Token == "" || state.ExpiresAt != time.Unix(1900, 0).UTC() {
		t.Fatalf("challenge token/expiry invalid: token=%q expires=%s", state.Token, state.ExpiresAt)
	}
}

func TestRecoveryServiceBeginChallengeRejectsInvalidCredential(t *testing.T) {
	serverKey := bytesOf('k', 32)
	kit, encoded, err := recovery.Generate("11111111-1111-4111-8111-111111111111", serverKey)
	if err != nil {
		t.Fatalf("generate recovery kit: %v", err)
	}

	stub := &recoveryStoreStub{allow: true, challengeID: "22222222-2222-4222-8222-222222222222"}
	service := NewRecoveryService(stub, serverKey)

	if _, err := service.BeginChallenge(context.Background(), kit.AccountID, encoded, "203.0.113.10"); !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("invalid recovery credential error = %v, want ErrRecoveryUnavailable", err)
	}
}

func TestRecoveryServiceResetPasswordUsesAtomicStoreOperation(t *testing.T) {
	stub := &recoveryStoreStub{
		challenge: RecoveryChallenge{
			ID:        "22222222-2222-4222-8222-222222222222",
			UserID:    "11111111-1111-4111-8111-111111111111",
			KeyID:     "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			Status:    "consuming",
			AttemptID: "33333333-3333-4333-8333-333333333333",
		},
	}
	service := NewRecoveryService(stub, bytesOf('k', 32))

	err := service.ResetPassword(
		context.Background(),
		stub.challenge.ID,
		"recovery-token",
		stub.challenge.UserID,
		stub.challenge.KeyID,
		"correct horse battery",
		"correct horse battery",
	)
	if err != nil {
		t.Fatalf("reset password: %v", err)
	}
	if stub.applyCalls != 1 {
		t.Fatalf("apply recovery reset calls = %d, want 1", stub.applyCalls)
	}
	if stub.lastPasswordHash == "" || stub.lastPasswordHash == "correct horse battery" {
		t.Fatalf("password was not hashed before store application")
	}
	if stub.abortCalls != 0 {
		t.Fatalf("abort recovery reset calls = %d, want 0", stub.abortCalls)
	}
}

func TestRecoveryServiceResetPasswordRejectsMismatchBeforeClaim(t *testing.T) {
	stub := &recoveryStoreStub{challenge: RecoveryChallenge{ID: "22222222-2222-4222-8222-222222222222"}}
	service := NewRecoveryService(stub, bytesOf('k', 32))

	err := service.ResetPassword(
		context.Background(),
		stub.challenge.ID,
		"recovery-token",
		"11111111-1111-4111-8111-111111111111",
		"password-one",
		"password-two",
	)
	if !errors.Is(err, ErrRecoveryPassword) {
		t.Fatalf("password mismatch error = %v, want ErrRecoveryPassword", err)
	}
	if stub.applyCalls != 0 || stub.abortCalls != 0 {
		t.Fatalf("store mutated on invalid password: apply=%d abort=%d", stub.applyCalls, stub.abortCalls)
	}
}

func bytesOf(value byte, size int) []byte {
	result := make([]byte, size)
	for i := range result {
		result[i] = value
	}
	return result
}
