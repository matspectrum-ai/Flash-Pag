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

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func (s *PostgresStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresStore) FindUserByUsername(ctx context.Context, usernameNormalized string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `select id::text, username, status from public.app_users where username_normalized = $1 limit 1`, usernameNormalized).Scan(&user.ID, &user.Username, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("find auth user: %w", err)
	}
	return user, nil
}

func (s *PostgresStore) CreateUser(ctx context.Context, user User, credential Credential) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin auth user transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `insert into public.app_users (id, username, username_normalized, status) values ($1::uuid, $2, $3, $4)`, user.ID, user.Username, user.Username, user.Status); err != nil {
		return mapCreateUserError(err)
	}
	if _, err = tx.Exec(ctx, `insert into public.app_password_credentials (user_id, password_hash, must_change, changed_at) values ($1::uuid, $2, $3, now())`, credential.UserID, credential.PasswordHash, credential.MustChange); err != nil {
		return fmt.Errorf("create password credential: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit auth user transaction: %w", err)
	}
	return nil
}

func (s *PostgresStore) GetCredential(ctx context.Context, userID string) (Credential, error) {
	var credential Credential
	err := s.pool.QueryRow(ctx, `select user_id::text, coalesce(password_hash, ''), must_change from public.app_password_credentials where user_id = $1::uuid limit 1`, userID).Scan(&credential.UserID, &credential.PasswordHash, &credential.MustChange)
	if errors.Is(err, pgx.ErrNoRows) {
		return Credential{}, ErrInvalidCredentials
	}
	if err != nil {
		return Credential{}, fmt.Errorf("find password credential: %w", err)
	}
	return credential, nil
}

func (s *PostgresStore) CreateSession(ctx context.Context, userID, tokenHash, ipHash, userAgentHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `insert into public.app_sessions (user_id, token_hash, expires_at, last_seen_at, ip_hash, user_agent_hash) values ($1::uuid, $2, $3, now(), nullif($4, ''), nullif($5, ''))`, userID, tokenHash, expiresAt.UTC(), ipHash, userAgentHash)
	if err != nil {
		return fmt.Errorf("create auth session: %w", err)
	}
	return nil
}

func (s *PostgresStore) RevokeSession(ctx context.Context, tokenHash string, revokedAt time.Time) error {
	_, err := s.pool.Exec(ctx, `update public.app_sessions set revoked_at = coalesce(revoked_at, $2) where token_hash = $1 and revoked_at is null`, tokenHash, revokedAt.UTC())
	if err != nil {
		return fmt.Errorf("revoke auth session: %w", err)
	}
	return nil
}

func (s *PostgresStore) FindSession(ctx context.Context, tokenHash string, now time.Time) (Session, error) {
	var session Session
	var mfaVerifiedAt *time.Time
	err := s.pool.QueryRow(ctx, `update public.app_sessions s set last_seen_at = $2 from public.app_users u where s.user_id = u.id and s.token_hash = $1 and s.revoked_at is null and s.expires_at > $2 returning u.id::text, u.username, u.status, s.aal, s.mfa_verified_at`, tokenHash, now.UTC()).Scan(&session.User.ID, &session.User.Username, &session.User.Status, &session.AAL, &mfaVerifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, fmt.Errorf("find auth session: %w", err)
	}
	session.MFAVerifiedAt = mfaVerifiedAt
	return session, nil
}

func (s *PostgresStore) AllowLogin(ctx context.Context, keyHash, usernameHash, ipHash string, now time.Time) (bool, error) {
	var blockedUntil *time.Time
	var failures int
	err := s.pool.QueryRow(ctx, `select blocked_until, failures from public.app_auth_rate_limits where key_hash = $1`, keyHash).Scan(&blockedUntil, &failures)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("check auth rate limit: %w", err)
	}
	if blockedUntil != nil && now.Before(blockedUntil.UTC()) {
		return false, nil
	}
	return true, nil
}

func (s *PostgresStore) RecordLoginFailure(ctx context.Context, keyHash, usernameHash, ipHash string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
		insert into public.app_auth_rate_limits (key_hash, username_hash, ip_hash, window_started_at, failures, updated_at)
		values ($1, $2, $3, $4, 1, $4)
		on conflict (key_hash) do update set
			username_hash = excluded.username_hash,
			ip_hash = excluded.ip_hash,
			window_started_at = case when public.app_auth_rate_limits.window_started_at <= $4 - interval '15 minutes' then $4 else public.app_auth_rate_limits.window_started_at end,
			failures = case when public.app_auth_rate_limits.window_started_at <= $4 - interval '15 minutes' then 1 else public.app_auth_rate_limits.failures + 1 end,
			blocked_until = case when public.app_auth_rate_limits.window_started_at <= $4 - interval '15 minutes' then null when public.app_auth_rate_limits.failures + 1 >= 5 then $4 + interval '15 minutes' else public.app_auth_rate_limits.blocked_until end,
			updated_at = $4
	`, keyHash, usernameHash, ipHash, now.UTC())
	if err != nil {
		return fmt.Errorf("record auth failure: %w", err)
	}
	return nil
}

func (s *PostgresStore) ResetLoginFailures(ctx context.Context, keyHash string) error {
	_, err := s.pool.Exec(ctx, `delete from public.app_auth_rate_limits where key_hash = $1`, keyHash)
	if err != nil {
		return fmt.Errorf("reset auth rate limit: %w", err)
	}
	return nil
}

func mapCreateUserError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrUserExists
	}
	return fmt.Errorf("create auth user: %w", err)
}
