package auth

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFirstPartyMembershipBridgeBackfillsAndReads(t *testing.T) {
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

	resetMembershipBridgeFixture(t, ctx, pool)
	applyMembershipBridgeFixture(t, ctx, pool)
	defer resetMembershipBridgeFixture(t, ctx, pool)

	const userID = "11111111-1111-4111-8111-111111111111"
	const merchantID = "22222222-2222-4222-8222-222222222222"
	const organizationID = "33333333-3333-4333-8333-333333333333"
	for _, args := range []struct {
		sql  string
		args []any
	}{
		{`insert into auth.users (id, email) values ($1::uuid, 'mateus@example.com')`, []any{userID}},
		{`insert into app_users (id, username, username_normalized, legacy_auth_user_id, legacy_email) values ($1::uuid, 'mateus', 'mateus', $1::uuid, 'mateus@example.com')`, []any{userID}},
		{`insert into merchants (id, name) values ($1::uuid, 'Test Merchant')`, []any{merchantID}},
		{`insert into organizations (id, merchant_id, name, slug) values ($1::uuid, $2::uuid, 'Test Org', 'test-org')`, []any{organizationID, merchantID}},
		{`insert into merchant_users (merchant_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')`, []any{merchantID, userID}},
		{`insert into platform_admins (user_id, role) values ($1::uuid, 'admin')`, []any{userID}},
	} {
		if _, err := pool.Exec(ctx, args.sql, args.args...); err != nil {
			t.Fatalf("seed bridge fixture: %v", err)
		}
	}

	var appUserID string
	if err := pool.QueryRow(ctx, `select app_user_id::text from merchant_users where merchant_id = $1::uuid and user_id = $2::uuid`, merchantID, userID).Scan(&appUserID); err != nil {
		t.Fatalf("read merchant app user link: %v", err)
	}
	if appUserID != userID {
		t.Fatalf("merchant app_user_id = %q, want %q", appUserID, userID)
	}

	var platformRole string
	if err := pool.QueryRow(ctx, `select role from platform_admins where app_user_id = $1::uuid`, userID).Scan(&platformRole); err != nil {
		t.Fatalf("read platform admin bridge: %v", err)
	}
	if platformRole != "admin" {
		t.Fatalf("platform admin role = %q, want admin", platformRole)
	}

	var gotUserID, username, legacyEmail, role string
	if err := pool.QueryRow(ctx, `select user_id::text, username, legacy_email, role from merchant_members_for_organization_first_party($1::uuid)`, organizationID).Scan(&gotUserID, &username, &legacyEmail, &role); err != nil {
		t.Fatalf("first-party membership function: %v", err)
	}
	if gotUserID != userID || username != "mateus" || legacyEmail != "mateus@example.com" || role != "owner" {
		t.Fatalf("first-party membership result = %q/%q/%q/%q", gotUserID, username, legacyEmail, role)
	}

	var adminUserID, adminFunctionRole string
	if err := pool.QueryRow(ctx, `select user_id::text, role from platform_admin_for_first_party_user($1::uuid)`, userID).Scan(&adminUserID, &adminFunctionRole); err != nil {
		t.Fatalf("first-party platform admin function: %v", err)
	}
	if adminUserID != userID || adminFunctionRole != "admin" {
		t.Fatalf("platform admin function result = %q/%q", adminUserID, adminFunctionRole)
	}
}

func applyMembershipBridgeFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))
	for _, stmt := range []string{
		`create schema if not exists auth`,
		`create table auth.users (id uuid primary key, email text)`,
		`create table app_users (id uuid primary key, username text not null, username_normalized text not null unique, legacy_auth_user_id uuid, legacy_email text)`,
		`create table merchants (id uuid primary key, name text not null)`,
		`create table organizations (id uuid primary key, merchant_id uuid not null references merchants(id), name text not null, slug text not null unique)`,
		`create table merchant_users (merchant_id uuid not null references merchants(id), user_id uuid not null references auth.users(id), role text not null, created_at timestamptz not null default now(), primary key (merchant_id, user_id))`,
		`create table platform_admins (user_id uuid primary key references auth.users(id), role text not null, created_at timestamptz not null default now())`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("create bridge fixture schema: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$`); err != nil {
		t.Fatalf("create bridge fixture roles: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "migrations", "0022_first_party_membership_links.sql"))
	if err != nil {
		t.Fatalf("read 0022 migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(data)); err != nil {
		t.Fatalf("apply 0022 migration: %v", err)
	}
}

func resetMembershipBridgeFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	for _, stmt := range []string{
		`drop function if exists public.merchant_members_for_organization_first_party(uuid)`,
		`drop function if exists public.platform_admin_for_first_party_user(uuid)`,
		`drop table if exists public.platform_admins cascade`,
		`drop table if exists public.merchant_users cascade`,
		`drop table if exists public.organizations cascade`,
		`drop table if exists public.merchants cascade`,
		`drop table if exists public.app_users cascade`,
		`drop schema if exists auth cascade`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("reset bridge fixture: %v", err)
		}
	}
}
