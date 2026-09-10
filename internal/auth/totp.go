package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	totpSecretBytes = 20
	totpDigits      = 6
	totpPeriod      = 30 * time.Second
)

// GenerateTOTPSecret returns a 160-bit random secret encoded in RFC 4648 Base32
// without padding, suitable for provisioning in an authenticator application.
func GenerateTOTPSecret() (string, error) {
	secret := make([]byte, totpSecretBytes)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate totp secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret), nil
}

func BuildTOTPURI(secret, issuer, accountLabel string) (string, error) {
	secret = strings.ToUpper(strings.TrimSpace(secret))
	if _, err := decodeTOTPSecret(secret); err != nil {
		return "", err
	}
	issuer = strings.TrimSpace(issuer)
	accountLabel = strings.TrimSpace(accountLabel)
	if issuer == "" || accountLabel == "" {
		return "", errors.New("issuer and account label are required")
	}
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", strconv.Itoa(totpDigits))
	q.Set("period", strconv.FormatInt(int64(totpPeriod/time.Second), 10))
	return "otpauth://totp/" + url.PathEscape(issuer+":"+accountLabel) + "?" + q.Encode(), nil
}

// VerifyTOTP verifies a code for the current timestep and one adjacent timestep
// in either direction. The returned step is the accepted moving counter and is
// intended to be persisted atomically to prevent code replay.
func VerifyTOTP(secret, code string, now time.Time) (int64, bool, error) {
	decoded, err := decodeTOTPSecret(secret)
	if err != nil {
		return 0, false, err
	}
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return 0, false, nil
	}
	if _, err := strconv.Atoi(code); err != nil {
		return 0, false, nil
	}
	current := now.UTC().Unix() / int64(totpPeriod/time.Second)
	for _, delta := range []int64{0, -1, 1} {
		step := current + delta
		if step < 0 {
			continue
		}
		if constantTimeCodeEqual(totpCode(decoded, step), code) {
			return step, true, nil
		}
	}
	return 0, false, nil
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	secret = strings.ToUpper(strings.TrimSpace(secret))
	if secret == "" {
		return nil, errors.New("totp secret is required")
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		return nil, fmt.Errorf("invalid totp secret: %w", err)
	}
	if len(decoded) < 16 {
		return nil, errors.New("totp secret is too short")
	}
	return decoded, nil
}

func totpCode(secret []byte, step int64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset])&0x7f)<<24 |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])
	return fmt.Sprintf("%06d", value%1000000)
}

func constantTimeCodeEqual(got, want string) bool {
	if len(got) != len(want) {
		return false
	}
	var diff byte
	for i := range got {
		diff |= got[i] ^ want[i]
	}
	return diff == 0
}
