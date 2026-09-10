package config

import (
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	Addr                   string
	PublicURL              string
	SupabaseURL            string
	SupabaseSecretKey      string
	SupabasePublishableKey string
	DatabaseURL            string
	FirstPartyAuthEnabled  bool
	CookieSecure           bool
	PreviewReadOnly        bool
	MasterKey              []byte
	WebhookPollInterval    time.Duration
}

func Load() (Config, error) {
	firstPartyAuthEnabled := strings.EqualFold(env("APP_FIRST_PARTY_AUTH_ENABLED", "false"), "true")
	cookieSecureDefault := "false"
	if firstPartyAuthEnabled {
		cookieSecureDefault = "true"
	}

	cfg := Config{
		Addr:                   env("APP_ADDR", ":8080"),
		PublicURL:              strings.TrimRight(env("APP_PUBLIC_URL", "http://localhost:8080"), "/"),
		SupabaseURL:            strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseSecretKey:      os.Getenv("SUPABASE_SECRET_KEY"),
		SupabasePublishableKey: os.Getenv("SUPABASE_PUBLISHABLE_KEY"),
		DatabaseURL:            strings.TrimSpace(os.Getenv("DATABASE_URL")),
		FirstPartyAuthEnabled:  firstPartyAuthEnabled,
		CookieSecure:           strings.EqualFold(env("COOKIE_SECURE", cookieSecureDefault), "true"),
		PreviewReadOnly:        strings.EqualFold(env("APP_PREVIEW_READ_ONLY", "false"), "true"),
		WebhookPollInterval:    5 * time.Second,
	}
	if cfg.SupabaseURL == "" || cfg.SupabaseSecretKey == "" || cfg.SupabasePublishableKey == "" {
		return Config{}, errors.New("SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are required")
	}
	if cfg.FirstPartyAuthEnabled && cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required when APP_FIRST_PARTY_AUTH_ENABLED is true")
	}
	if v := os.Getenv("APP_MASTER_KEY_B64"); v != "" {
		raw, err := base64.StdEncoding.DecodeString(v)
		if err != nil || len(raw) != 32 {
			return Config{}, errors.New("APP_MASTER_KEY_B64 must be base64 for exactly 32 bytes")
		}
		cfg.MasterKey = raw
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
