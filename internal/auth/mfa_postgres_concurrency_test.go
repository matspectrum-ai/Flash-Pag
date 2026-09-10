package auth

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresMFAStoreConcurrentReplay(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}

	resetMFATestSchema(t, ctx, pool)
	applyMFATestSchema(t, ctx, pool)
	defer resetMFATestSchema(t, ctx, pool)

	const userID = "11111111-1111-4111-8111-111111111111"
	const sessionHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := pool.Exec(ctx, `
		insert into app_users (id, username, username_normalized, status)
		values ($1::uuid, 'mfa-test', 'mfa-test', 'active');
		insert into app_sessions (user_id, token_hash, expires_at, last_seen_at, aal)
		values ($1::uuid, $2, now() + interval '1 hour', now(), 'aal1');
		insert into app_totp_factors (user_id, secret_ciphertext, issuer, account_label, enabled_at, last_used_step)
		values ($1::uuid, 'ciphertext', 'Flash Pag', 'mfa-test', now(), null);
	`, userID, sessionHash); err != nil {
		t.Fatalf("seed schema: %v", err)
	}

	store := NewPostgresMFAStore(pool)
	verifiedAt := time.Now().UTC().Truncate(time.Microsecond)
	results := make(chan error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- store.ConsumeTOTPAndElevate(ctx, userID, sessionHash, 123456, verifiedAt)
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	success, replayOrInvalid := 0, 0
	for err := range results {
		switch err {
		case nil:
			success++
		case ErrMFAReplay, ErrMFAInvalidSession:
			replayOrInvalid++
		default:
			t.Fatalf("unexpected concurrent result: %v", err)
		}
	}
	if success != 1 || replayOrInvalid != 1 {
		t.Fatalf("concurrent results success=%d replay_or_invalid=%d", success, replayOrInvalid)
	}

	var aal string
	if err := pool.QueryRow(ctx, `select aal from app_sessions where token_hash = $1`, sessionHash).Scan(&aal); err != nil {
		t.Fatalf("read session assurance: %v", err)
	}
	if aal != "aal2" {
		t.Fatalf("session aal = %q, want aal2", aal)
	}

	var usedStep int64
	if err := pool.QueryRow(ctx, `select last_used_step from app_totp_factors where user_id = $1::uuid`, userID).Scan(&usedStep); err != nil {
		t.Fatalf("read replay step: %v", err)
	}
	if usedStep != 123456 {
		t.Fatalf("last_used_step = %d, want 123456", usedStep)
	}
}

func applyMFATestSchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))
	for _, stmt := range []string{
		`create extension if not exists pgcrypto;`,
		`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;`,
		`create table app_users (id uuid primary key, username text not null, username_normalized text not null unique, status text not null);`,
		`create table app_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, token_hash text not null unique, expires_at timestamptz not null, last_seen_at timestamptz not null, revoked_at timestamptz, aal text not null default 'aal1', mfa_verified_at timestamptz);`,
		`create table app_totp_factors (user_id uuid primary key, secret_ciphertext text not null, issuer text not null, account_label text not null, enabled_at timestamptz, disabled_at timestamptz, last_used_step bigint, last_used_at timestamptz, updated_at timestamptz default now());`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("create fixture schema: %v", err)
		}
	}
	for _, migration := range []string{"0019_first_party_mfa_assurance.sql", "0021_first_party_mfa_atomic_step.sql"} {
		data, err := os.ReadFile(filepath.Join(root, "migrations", migration))
		if err != nil {
			t.Fatalf("read %s: %v", migration, err)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("apply %s: %v", migration, err)
		}
	}
}

func resetMFATestSchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	for _, stmt := range []string{
		`drop function if exists public.flashpag_consume_totp_and_elevate_session(uuid, text, bigint, timestamptz);`,
		`drop function if exists public.flashpag_confirm_totp_enrollment(uuid, bigint, timestamptz);`,
		`drop table if exists public.app_totp_factors cascade;`,
		`drop table if exists public.app_sessions cascade;`,
		`drop table if exists public.app_users cascade;`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("reset MFA fixture: %v", err)
		}
	}
}
