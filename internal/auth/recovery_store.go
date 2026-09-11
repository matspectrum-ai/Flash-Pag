package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RecoveryKitRecord struct {
	UserID         string
	KeyID          string
	Version        int16
	SecretVerifier string
	Status         string
}

type RecoveryChallenge struct {
	ID              string
	UserID          string
	KeyID           string
	Status          string
	AttemptID       string
	LeaseExpiresAt  time.Time
	ExpiresAt       time.Time
}

type RecoveryStore interface {
	GetRecoveryKit(ctx context.Context, userID, keyID string) (RecoveryKitRecord, error)
	CreateRecoveryChallenge(ctx context.Context, userID, keyID, tokenHash string, expiresAt time.Time) (string, error)
	BeginRecoveryReset(ctx context.Context, challengeID, tokenHash string) (RecoveryChallenge, error)
	ApplyRecoveryReset(ctx context.Context, challengeID, userID, keyID, attemptID, passwordHash string) (bool, error)
	AbortRecoveryReset(ctx context.Context, challengeID, userID, keyID, attemptID string) (bool, error)
	AllowRecoveryAttempt(ctx context.Context, subjectHash, ipHash string, subjectLimit, ipLimit int) (bool, error)
}

type PostgresRecoveryStore struct {
	pool *pgxpool.Pool
}

func NewPostgresRecoveryStore(pool *pgxpool.Pool) *PostgresRecoveryStore {
	return &PostgresRecoveryStore{pool: pool}
}

func (s *PostgresRecoveryStore) GetRecoveryKit(ctx context.Context, userID, keyID string) (RecoveryKitRecord, error) {
	var record RecoveryKitRecord
	err := s.pool.QueryRow(ctx, `
		select user_id::text, key_id, version, secret_verifier, status
		from public.app_account_recovery_kits
		where user_id = $1::uuid and key_id = $2 and status = 'active'
	`, userID, keyID).Scan(
		&record.UserID,
		&record.KeyID,
		&record.Version,
		&record.SecretVerifier,
		&record.Status,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RecoveryKitRecord{}, ErrRecoveryUnavailable
	}
	if err != nil {
		return RecoveryKitRecord{}, fmt.Errorf("get first-party recovery kit: %w", err)
	}
	return record, nil
}

func (s *PostgresRecoveryStore) CreateRecoveryChallenge(ctx context.Context, userID, keyID, tokenHash string, expiresAt time.Time) (string, error) {
	var challengeID string
	err := s.pool.QueryRow(ctx, `
		insert into public.app_account_recovery_challenges(user_id, key_id, token_hash, expires_at)
		values ($1::uuid, $2, $3, $4)
		returning id::text
	`, userID, keyID, tokenHash, expiresAt.UTC()).Scan(&challengeID)
	if err != nil {
		return "", fmt.Errorf("create first-party recovery challenge: %w", err)
	}
	return challengeID, nil
}

func (s *PostgresRecoveryStore) BeginRecoveryReset(ctx context.Context, challengeID, tokenHash string) (RecoveryChallenge, error) {
	var challenge RecoveryChallenge
	err := s.pool.QueryRow(ctx, `
		select user_id::text, key_id, status, attempt_id::text, lease_expires_at, expires_at
		from public.flashpag_begin_app_recovery_reset($1::uuid, $2)
	`, challengeID, tokenHash).Scan(
		&challenge.UserID,
		&challenge.KeyID,
		&challenge.Status,
		&challenge.AttemptID,
		&challenge.LeaseExpiresAt,
		&challenge.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RecoveryChallenge{}, ErrRecoveryUnavailable
	}
	if err != nil {
		return RecoveryChallenge{}, fmt.Errorf("begin first-party recovery reset: %w", err)
	}
	challenge.ID = challengeID
	return challenge, nil
}

func (s *PostgresRecoveryStore) ApplyRecoveryReset(ctx context.Context, challengeID, userID, keyID, attemptID, passwordHash string) (bool, error) {
	var applied bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_apply_app_recovery_reset($1::uuid, $2::uuid, $3, $4::uuid, $5)
	`, challengeID, userID, keyID, attemptID, passwordHash).Scan(&applied)
	if err != nil {
		return false, fmt.Errorf("apply first-party recovery reset: %w", err)
	}
	return applied, nil
}

func (s *PostgresRecoveryStore) AbortRecoveryReset(ctx context.Context, challengeID, userID, keyID, attemptID string) (bool, error) {
	var aborted bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_abort_app_recovery_reset($1::uuid, $2::uuid, $3, $4::uuid)
	`, challengeID, userID, keyID, attemptID).Scan(&aborted)
	if err != nil {
		return false, fmt.Errorf("abort first-party recovery reset: %w", err)
	}
	return aborted, nil
}

func (s *PostgresRecoveryStore) AllowRecoveryAttempt(ctx context.Context, subjectHash, ipHash string, subjectLimit, ipLimit int) (bool, error) {
	var allowed bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_app_recovery_rate_limit($1, $2, $3, $4)
	`, subjectHash, ipHash, subjectLimit, ipLimit).Scan(&allowed)
	if err != nil {
		return false, fmt.Errorf("check first-party recovery rate limit: %w", err)
	}
	return allowed, nil
}
