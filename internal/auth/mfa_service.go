package auth

import (
	"context"
	"errors"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
)

var (
	ErrMFANotEnrolled     = errors.New("mfa not enrolled")
	ErrMFAAlreadyEnrolled = errors.New("mfa already enrolled")
	ErrMFAInvalidCode     = errors.New("invalid mfa code")
	ErrMFAReplay          = errors.New("mfa code already used")
	ErrMFAInvalidSession  = errors.New("invalid mfa session")
)

type MFAStore interface {
	GetTOTPFactor(ctx context.Context, userID string) (TOTPFactor, error)
	CreateTOTPFactor(ctx context.Context, factor TOTPFactor) error
	EnableTOTPFactor(ctx context.Context, userID string, verifiedAt time.Time, step int64) error
	ConsumeTOTPCode(ctx context.Context, userID string, step int64, usedAt time.Time) error
	ElevateSession(ctx context.Context, tokenHash string, verifiedAt time.Time) error
}

type TOTPFactor struct {
	UserID           string
	SecretCiphertext string
	Issuer           string
	AccountLabel     string
	Enabled          bool
	LastUsedStep     *int64
}

type MFAService struct {
	store MFAStore
	box   *cryptobox.Box
	now   func() time.Time
}

func NewMFAService(store MFAStore, box *cryptobox.Box) *MFAService {
	return &MFAService{store: store, box: box, now: func() time.Time { return time.Now().UTC() }}
}

func (s *MFAService) BeginEnrollment(ctx context.Context, userID, accountLabel string) (string, string, error) {
	if userID == "" || accountLabel == "" || s.box == nil {
		return "", "", errors.New("invalid mfa enrollment request")
	}
	if factor, err := s.store.GetTOTPFactor(ctx, userID); err == nil && factor.Enabled {
		return "", "", ErrMFAAlreadyEnrolled
	}
	secret, err := GenerateTOTPSecret()
	if err != nil {
		return "", "", err
	}
	ciphertext, err := s.box.Seal([]byte(secret))
	if err != nil {
		return "", "", err
	}
	factor := TOTPFactor{UserID: userID, SecretCiphertext: ciphertext, Issuer: "Flash Pag", AccountLabel: accountLabel}
	if err := s.store.CreateTOTPFactor(ctx, factor); err != nil {
		return "", "", err
	}
	uri, err := BuildTOTPURI(secret, factor.Issuer, factor.AccountLabel)
	if err != nil {
		return "", "", err
	}
	return secret, uri, nil
}

func (s *MFAService) VerifyEnrollment(ctx context.Context, userID, code string) error {
	factor, err := s.store.GetTOTPFactor(ctx, userID)
	if err != nil || factor.SecretCiphertext == "" {
		return ErrMFANotEnrolled
	}
	secret, err := s.box.Open(factor.SecretCiphertext)
	if err != nil {
		return errors.New("mfa secret unavailable")
	}
	step, ok, err := VerifyTOTP(string(secret), code, s.now())
	if err != nil || !ok {
		return ErrMFAInvalidCode
	}
	if factor.LastUsedStep != nil && step <= *factor.LastUsedStep {
		return ErrMFAReplay
	}
	return s.store.EnableTOTPFactor(ctx, userID, s.now(), step)
}

func (s *MFAService) VerifyAndElevate(ctx context.Context, userID, tokenHash, code string) error {
	factor, err := s.store.GetTOTPFactor(ctx, userID)
	if err != nil || !factor.Enabled || factor.SecretCiphertext == "" {
		return ErrMFANotEnrolled
	}
	secret, err := s.box.Open(factor.SecretCiphertext)
	if err != nil {
		return errors.New("mfa secret unavailable")
	}
	step, ok, err := VerifyTOTP(string(secret), code, s.now())
	if err != nil || !ok {
		return ErrMFAInvalidCode
	}
	if factor.LastUsedStep != nil && step <= *factor.LastUsedStep {
		return ErrMFAReplay
	}
	verifiedAt := s.now()
	if err := s.store.ConsumeTOTPCode(ctx, userID, step, verifiedAt); err != nil {
		if errors.Is(err, ErrMFAReplay) {
			return ErrMFAReplay
		}
		return err
	}
	if err := s.store.ElevateSession(ctx, tokenHash, verifiedAt); err != nil {
		return ErrMFAInvalidSession
	}
	return nil
}
