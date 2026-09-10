package auth

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
)

type mfaMemoryStore struct {
	factor     TOTPFactor
	hasFactor  bool
	sessionAAL string
}

func (m *mfaMemoryStore) GetTOTPFactor(context.Context, string) (TOTPFactor, error) {
	if !m.hasFactor {
		return TOTPFactor{}, ErrMFANotEnrolled
	}
	return m.factor, nil
}

func (m *mfaMemoryStore) CreateTOTPFactor(_ context.Context, factor TOTPFactor) error {
	if m.hasFactor {
		return ErrMFAAlreadyEnrolled
	}
	m.factor = factor
	m.hasFactor = true
	return nil
}

func (m *mfaMemoryStore) ConfirmTOTPEnrollment(_ context.Context, userID string, step int64, _ time.Time) error {
	if !m.hasFactor || m.factor.UserID != userID {
		return ErrMFANotEnrolled
	}
	if m.factor.LastUsedStep != nil && step <= *m.factor.LastUsedStep {
		return ErrMFAReplay
	}
	m.factor.Enabled = true
	m.factor.LastUsedStep = &step
	return nil
}

func (m *mfaMemoryStore) ConsumeTOTPAndElevate(_ context.Context, userID, tokenHash string, step int64, _ time.Time) error {
	if !m.hasFactor || !m.factor.Enabled || m.factor.UserID != userID {
		return ErrMFANotEnrolled
	}
	if tokenHash == "" {
		return ErrMFAInvalidSession
	}
	if m.factor.LastUsedStep != nil && step <= *m.factor.LastUsedStep {
		return ErrMFAReplay
	}
	m.factor.LastUsedStep = &step
	m.sessionAAL = "aal2"
	return nil
}

func TestMFAEnrollmentAndVerification(t *testing.T) {
	box, err := cryptobox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	store := &mfaMemoryStore{}
	s := NewMFAService(store, box)
	s.now = func() time.Time { return time.Unix(1700000000, 0).UTC() }

	secret, _, err := s.BeginEnrollment(context.Background(), "user-1", "mateus")
	if err != nil {
		t.Fatalf("BeginEnrollment() error = %v", err)
	}
	decoded, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	step := s.now().Unix() / 30
	code := totpCode(decoded, step)
	if err := s.VerifyEnrollment(context.Background(), "user-1", code); err != nil {
		t.Fatalf("VerifyEnrollment() error = %v", err)
	}
	if !store.factor.Enabled {
		t.Fatal("factor was not enabled")
	}
}

func TestMFAVerifyAndElevateRejectsReplay(t *testing.T) {
	box, err := cryptobox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	store := &mfaMemoryStore{}
	s := NewMFAService(store, box)
	s.now = func() time.Time { return time.Unix(1700000000, 0).UTC() }

	secret, _, err := s.BeginEnrollment(context.Background(), "user-2", "mateus")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	step := s.now().Unix() / 30
	firstCode := totpCode(decoded, step)
	if err := s.VerifyEnrollment(context.Background(), "user-2", firstCode); err != nil {
		t.Fatal(err)
	}

	if err := s.VerifyAndElevate(context.Background(), "user-2", "session-1", firstCode); err == nil {
		t.Fatal("expected replay rejection after enrollment consumed the timestep")
	}
	newCode := totpCode(decoded, step+1)
	s.now = func() time.Time { return time.Unix((step+1)*30, 0).UTC() }
	if err := s.VerifyAndElevate(context.Background(), "user-2", "session-1", newCode); err != nil {
		t.Fatalf("VerifyAndElevate() error = %v", err)
	}
	if store.sessionAAL != "aal2" {
		t.Fatalf("session assurance = %q, want aal2", store.sessionAAL)
	}
}

func TestMFAVerifyAndElevateRejectsEmptySession(t *testing.T) {
	box, err := cryptobox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	store := &mfaMemoryStore{}
	s := NewMFAService(store, box)
	s.now = func() time.Time { return time.Unix(1700000000, 0).UTC() }

	secret, _, err := s.BeginEnrollment(context.Background(), "user-4", "mateus")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	step := s.now().Unix() / 30
	if err := s.VerifyEnrollment(context.Background(), "user-4", totpCode(decoded, step)); err != nil {
		t.Fatal(err)
	}
	if err := s.VerifyAndElevate(context.Background(), "user-4", "", totpCode(decoded, step+1)); err != ErrMFAInvalidSession {
		t.Fatalf("VerifyAndElevate() error = %v, want %v", err, ErrMFAInvalidSession)
	}
}

func TestMFASecretIsEncryptedAtRest(t *testing.T) {
	box, err := cryptobox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	store := &mfaMemoryStore{}
	s := NewMFAService(store, box)
	secret, _, err := s.BeginEnrollment(context.Background(), "user-3", "mateus")
	if err != nil {
		t.Fatal(err)
	}
	if store.factor.SecretCiphertext == secret {
		t.Fatal("secret was persisted in plaintext")
	}
	opened, err := box.Open(store.factor.SecretCiphertext)
	if err != nil {
		t.Fatal(err)
	}
	if string(opened) != secret {
		t.Fatalf("decrypted secret mismatch: %q", fmt.Sprintf("%x", opened))
	}
}
