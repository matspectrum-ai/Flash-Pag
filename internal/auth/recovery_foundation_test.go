package auth

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFirstPartyRecoveryFoundationLifecycle(t *testing.T) {
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

	if _, err := pool.Exec(ctx, `do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$`); err != nil {
		t.Fatalf("create recovery fixture roles: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	applyRecoveryFoundationFixture(t, ctx, tx)
	const userID = "11111111-1111-4111-8111-111111111111"
	const keyID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const verifier = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	const challengeTokenHash = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

	if _, err := tx.Exec(ctx, `insert into app_users (id, username, username_normalized, status) values ($1::uuid, 'mateus', 'mateus', 'active')`, userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := tx.Exec(ctx, `select public.flashpag_rotate_app_recovery_kit($1::uuid, $2, $3)`, userID, keyID, verifier); err != nil {
		t.Fatalf("rotate recovery kit: %v", err)
	}

	var status string
	if err := tx.QueryRow(ctx, `select status from app_account_recovery_kits where user_id = $1::uuid`, userID).Scan(&status); err != nil {
		t.Fatalf("read recovery kit: %v", err)
	}
	if status != "active" {
		t.Fatalf("recovery kit status = %q, want active", status)
	}

	var challengeID string
	if err := tx.QueryRow(ctx, `insert into app_account_recovery_challenges(user_id, key_id, token_hash, expires_at) values ($1::uuid, $2, $3, now() + interval '15 minutes') returning id::text`, userID, keyID, challengeTokenHash).Scan(&challengeID); err != nil {
		t.Fatalf("create recovery challenge: %v", err)
	}

	var claimUserID, claimKeyID, claimStatus string
	if err := tx.QueryRow(ctx, `select user_id::text, key_id, status from public.flashpag_begin_app_recovery_reset($1::uuid, $2)`, challengeID, challengeTokenHash).Scan(&claimUserID, &claimKeyID, &claimStatus); err != nil {
		t.Fatalf("begin recovery reset: %v", err)
	}
	if claimUserID != userID || claimKeyID != keyID || claimStatus != "consuming" {
		t.Fatalf("recovery claim = %q/%q/%q", claimUserID, claimKeyID, claimStatus)
	}

	var finalized bool
	if err := tx.QueryRow(ctx, `select public.flashpag_finalize_app_recovery_reset($1::uuid, $2::uuid, $3)`, challengeID, userID, keyID).Scan(&finalized); err != nil {
		t.Fatalf("finalize recovery reset: %v", err)
	}
	if !finalized {
		t.Fatal("finalize recovery reset = false, want true")
	}

	if err := tx.QueryRow(ctx, `select status from app_account_recovery_challenges where id = $1::uuid`, challengeID).Scan(&status); err != nil {
		t.Fatalf("read challenge status: %v", err)
	}
	if status != "consumed" {
		t.Fatalf("challenge status = %q, want consumed", status)
	}
	if err := tx.QueryRow(ctx, `select status from app_account_recovery_kits where user_id = $1::uuid`, userID).Scan(&status); err != nil {
		t.Fatalf("read used kit status: %v", err)
	}
	if status != "used" {
		t.Fatalf("recovery kit status after finalize = %q, want used", status)
	}

	if err := tx.Rollback(ctx); err != nil && err != pgx.ErrTxClosed {
		t.Fatalf("rollback transaction: %v", err)
	}
}

func applyRecoveryFoundationFixture(t *testing.T, ctx context.Context, tx pgx.Tx) {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))
	for _, stmt := range []string{
		`create extension if not exists pgcrypto`,
		`create table app_users (id uuid primary key, username text not null, username_normalized text not null unique, status text not null)`,
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			t.Fatalf("create recovery fixture schema: %v", err)
		}
	}
	data, err := os.ReadFile(filepath.Join(root, "migrations", "0023_first_party_recovery_foundation.sql"))
	if err != nil {
		t.Fatalf("read 0023 migration: %v", err)
	}
	if _, err := tx.Exec(ctx, string(data)); err != nil {
		t.Fatalf("apply 0023 migration: %v", err)
	}
}
