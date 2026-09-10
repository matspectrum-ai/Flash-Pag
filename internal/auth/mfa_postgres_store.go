package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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

func (s *PostgresMFAStore) EnableTOTPFactor(ctx context.Context, userID string, verifiedAt time.Time, step int64) error {
	var consumed bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_consume_totp_code($1::uuid, $2, $3)
	`, userID, step, verifiedAt.UTC()).Scan(&consumed)
	if err != nil {
		return fmt.Errorf("enable totp factor: %w", err)
	}
	if !consumed {
		return ErrMFAReplay
	}
	_, err = s.pool.Exec(ctx, `
		update public.app_totp_factors
		   set enabled_at = $2,
		       disabled_at = null,
		       updated_at = $2
		 where user_id = $1::uuid
		   and disabled_at is null
	`, userID, verifiedAt.UTC())
	if err != nil {
		return fmt.Errorf("activate totp factor: %w", err)
	}
	return nil
}

func (s *PostgresMFAStore) ConsumeTOTPCode(ctx context.Context, userID string, step int64, usedAt time.Time) error {
	var consumed bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_consume_totp_code($1::uuid, $2, $3)
	`, userID, step, usedAt.UTC()).Scan(&consumed)
	if err != nil {
		return fmt.Errorf("consume totp code: %w", err)
	}
	if !consumed {
		return ErrMFAReplay
	}
	return nil
}

func (s *PostgresMFAStore) ElevateSession(ctx context.Context, tokenHash string, verifiedAt time.Time) error {
	var elevated bool
	err := s.pool.QueryRow(ctx, `
		select public.flashpag_elevate_auth_session($1, $2)
	`, tokenHash, verifiedAt.UTC()).Scan(&elevated)
	if err != nil {
		return fmt.Errorf("elevate auth session: %w", err)
	}
	if !elevated {
		return ErrMFAInvalidSession
	}
	return nil
}
