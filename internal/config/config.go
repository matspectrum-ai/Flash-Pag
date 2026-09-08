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
	CookieSecure           bool
	PreviewReadOnly        bool
	MasterKey              []byte
	WebhookPollInterval    time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Addr:                   env("APP_ADDR", ":8080"),
		PublicURL:              strings.TrimRight(env("APP_PUBLIC_URL", "http://localhost:8080"), "/"),
		SupabaseURL:            strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseSecretKey:      os.Getenv("SUPABASE_SECRET_KEY"),
		SupabasePublishableKey: os.Getenv("SUPABASE_PUBLISHABLE_KEY"),
		CookieSecure:           strings.EqualFold(env("COOKIE_SECURE", "false"), "true"),
		PreviewReadOnly:        strings.EqualFold(env("APP_PREVIEW_READ_ONLY", "false"), "true"),
		WebhookPollInterval:    5 * time.Second,
	}
	if cfg.SupabaseURL == "" || cfg.SupabaseSecretKey == "" || cfg.SupabasePublishableKey == "" {
		return Config{}, errors.New("SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are required")
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
