package config

import "testing"

const testMasterKeyB64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("SUPABASE_SECRET_KEY", "secret")
	t.Setenv("SUPABASE_PUBLISHABLE_KEY", "publishable")
	t.Setenv("APP_MASTER_KEY_B64", testMasterKeyB64)
}

func TestLoadFirstPartyAuthDefaultsCookieSecure(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_FIRST_PARTY_AUTH_ENABLED", "true")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("COOKIE_SECURE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.CookieSecure {
		t.Fatal("CookieSecure = false, want true when first-party auth is enabled")
	}
}

func TestLoadCookieSecureCanBeExplicitlyDisabledForNonProductionDev(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_FIRST_PARTY_AUTH_ENABLED", "true")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("COOKIE_SECURE", "false")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.CookieSecure {
		t.Fatal("CookieSecure = true, want explicit false override")
	}
}

func TestLoadRequiresDatabaseForFirstPartyAuth(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_FIRST_PARTY_AUTH_ENABLED", "true")
	t.Setenv("DATABASE_URL", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want missing DATABASE_URL error")
	}
}

func TestLoadRequiresMasterKeyForFirstPartyAuth(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_FIRST_PARTY_AUTH_ENABLED", "true")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_MASTER_KEY_B64", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want missing APP_MASTER_KEY_B64 error")
	}
}
