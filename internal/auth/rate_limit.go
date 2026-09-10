package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"
)

const (
	loginRateWindow  = 15 * time.Minute
	loginRateLimit   = 5
	loginBlockPeriod = 15 * time.Minute
)

type LoginRateLimiter interface {
	AllowLogin(ctx context.Context, keyHash, usernameHash, ipHash string, now time.Time) (bool, error)
	RecordLoginFailure(ctx context.Context, keyHash, usernameHash, ipHash string, now time.Time) error
	ResetLoginFailures(ctx context.Context, keyHash string) error
}

func RateLimitKey(usernameNormalized, ipHash string) string {
	u := sha256.Sum256([]byte(usernameNormalized))
	uh := hex.EncodeToString(u[:])
	return sha256Hex(uh + ":" + strings.TrimSpace(ipHash))
}

func UsernameHash(usernameNormalized string) string {
	return sha256Hex(usernameNormalized)
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
