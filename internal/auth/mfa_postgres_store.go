package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresMFAStore struct {
	pool *pgxpool.Pool
}

func NewPostgresMFAStore(pool *pgxpool.Pool) *PostgresMFAStore {
	return &PostgresMFAStore{pool: pool}
}

func (s *PostgresMFAStore) GetTOTPFactor(ctx context.Context, userID string) (TOTPFactor, error) {
	var factor TOTPFactor
	var lastUsedStep *int64
	err := s.pool.QueryRow(ctx, `
		select user_id::text, secret_ciphertext, issuer, account_label,
		       enabled_at is not null and disabled_at is null, last_used_step
		from public.app_totp_factors
		where user_id = $1::uuid
		limit 1
	`, userID).Scan(&factor.UserID, &factor.SecretCiphertext, &factor.Issuer, &factor.AccountLabel, &factor.Enabled, &lastUsedStep)
	if errors.Is(err, pgx.ErrNoRows) {
		return TOTPFactor{}, ErrMFANotEnrolled
	}
	if err != nil {
		return TOTPFactor{}, fmt.Errorf("find totp factor: %w", err)
	}
	factor.LastUsedStep = lastUsedStep
	return factor, nil
}

func (s *PostgresMFAStore) CreateTOTPFactor(ctx context.Context, factor TOTPFactor) error {
	_, err := s.pool.Exec(ctx, `
		insert into public.app_totp_factors
			(user_id, secret_ciphertext, issuer, account_label)
		values ($1::uuid, $2, $3, $4)
	`, factor.UserID, factor.SecretCiphertext, factor.Issuer, factor.AccountLabel)
	if err != nil {
		return fmt.Errorf("create totp factor: %w", err)
	}
	return nil
}

func (s *PostgresMFAStore) ConfirmTOTPEnrollment(ctx context.Context, userID string, step int64, verifiedAt time.Time) error {
	var confirmed bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_confirm_totp_enrollment($1::uuid, $2, $3)
	`, userID, step, verifiedAt.UTC()).Scan(&confirmed)
	if err != nil {
		return fmt.Errorf("confirm totp enrollment: %w", err)
	}
	if !confirmed {
		return ErrMFAReplay
	}
	return nil
}

func (s *PostgresMFAStore) ConsumeTOTPAndElevate(ctx context.Context, userID, tokenHash string, step int64, verifiedAt time.Time) error {
	var elevated bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_consume_totp_and_elevate_session($1::uuid, $2, $3, $4)
	`, userID, tokenHash, step, verifiedAt.UTC()).Scan(&elevated)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "P0001" && pgErr.Message == "mfa_session_elevation_failed" {
			return ErrMFAInvalidSession
		}
		return fmt.Errorf("consume totp and elevate session: %w", err)
	}
	if !elevated {
		return ErrMFAReplay
	}
	return nil
}
