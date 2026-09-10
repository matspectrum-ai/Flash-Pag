package auth

import (
	"strconv"
	"testing"
	"time"
)

func TestGenerateTOTPSecretAndURI(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("GenerateTOTPSecret() error = %v", err)
	}
	if len(secret) < 32 {
		t.Fatalf("secret length = %d, expected at least 32 Base32 characters", len(secret))
	}
	uri, err := BuildTOTPURI(secret, "Flash Pag", "mateus")
	if err != nil {
		t.Fatalf("BuildTOTPURI() error = %v", err)
	}
	if uri == "" || uri[:14] != "otpauth://totp/" {
		t.Fatalf("unexpected otpauth URI: %q", uri)
	}
}

func TestVerifyTOTPAllowsAdjacentStep(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1700000000, 0).UTC()
	step := now.Unix() / 30
	decoded, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatalf("decodeTOTPSecret() error = %v", err)
	}
	code := totpCode(decoded, step-1, func() hash.Hash { return sha1.New() })
	gotStep, ok, err := VerifyTOTP(secret, code, now)
	if err != nil {
		t.Fatalf("VerifyTOTP() error = %v", err)
	}
	if !ok || gotStep != step-1 {
		t.Fatalf("VerifyTOTP() = (%d, %t), want (%d, true)", gotStep, ok, step-1)
	}
}

func TestVerifyTOTPCorrectCodeAndRejectsWrongCode(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1700000000, 0).UTC()
	step := now.Unix() / 30
	decoded, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatalf("decodeTOTPSecret() error = %v", err)
	}
	code := totpCode(decoded, step, func() hash.Hash { return sha1.New() })
	gotStep, ok, err := VerifyTOTP(secret, code, now)
	if err != nil || !ok || gotStep != step {
		t.Fatalf("valid VerifyTOTP() = (%d, %t, %v), want (%d, true, nil)", gotStep, ok, err, step)
	}
	wrong := "000000"
	if wrong == code {
		wrong = "999999"
	}
	if _, ok, err := VerifyTOTP(secret, wrong, now); err != nil || ok {
		t.Fatalf("wrong VerifyTOTP() = (%t, %v), want (false, nil)", ok, err)
	}
	if len(strconv.Itoa(step)) == 0 {
		t.Fatal("unreachable")
	}
}
