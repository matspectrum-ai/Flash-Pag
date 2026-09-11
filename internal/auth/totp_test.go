package auth

import (
	"testing"
	"time"
)

const testTOTPSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestGenerateTOTPSecretAndURI(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("GenerateTOTPSecret() error = %v", err)
	}
	if len(secret) != 32 {
		t.Fatalf("secret length = %d, want 32", len(secret))
	}
	uri, err := BuildTOTPURI(secret, "Flash Pag", "mateus")
	if err != nil {
		t.Fatalf("BuildTOTPURI() error = %v", err)
	}
	if len(uri) < len("otpauth://totp/") || uri[:15] != "otpauth://totp/" {
		t.Fatalf("unexpected otpauth URI: %q", uri)
	}
}

func TestVerifyTOTPRFC6238Vector(t *testing.T) {
	step, ok, err := VerifyTOTP(testTOTPSecret, "287082", time.Unix(59, 0).UTC())
	if err != nil {
		t.Fatalf("VerifyTOTP() error = %v", err)
	}
	if !ok {
		t.Fatalf("VerifyTOTP() rejected RFC 6238 vector")
	}
	wantStep := int64(59 / 30)
	if step != wantStep {
		t.Fatalf("accepted step = %d, want %d", step, wantStep)
	}
}

func TestVerifyTOTPAllowsAdjacentStep(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	step := now.Unix() / 30
	decoded, err := decodeTOTPSecret(testTOTPSecret)
	if err != nil {
		t.Fatalf("decodeTOTPSecret() error = %v", err)
	}
	code := totpCode(decoded, step-1)
	gotStep, ok, err := VerifyTOTP(testTOTPSecret, code, now)
	if err != nil {
		t.Fatalf("VerifyTOTP() error = %v", err)
	}
	if !ok || gotStep != step-1 {
		t.Fatalf("VerifyTOTP() = (%d, %t), want (%d, true)", gotStep, ok, step-1)
	}
}

func TestVerifyTOTPCorrectCodeAndRejectsWrongCode(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	step := now.Unix() / 30
	decoded, err := decodeTOTPSecret(testTOTPSecret)
	if err != nil {
		t.Fatalf("decodeTOTPSecret() error = %v", err)
	}
	code := totpCode(decoded, step)
	gotStep, ok, err := VerifyTOTP(testTOTPSecret, code, now)
	if err != nil || !ok || gotStep != step {
		t.Fatalf("valid VerifyTOTP() = (%d, %t, %v), want (%d, true, nil)", gotStep, ok, err, step)
	}
	wrong := "000000"
	if wrong == code {
		wrong = "999999"
	}
	if _, ok, err := VerifyTOTP(testTOTPSecret, wrong, now); err != nil || ok {
		t.Fatalf("wrong VerifyTOTP() = (%t, %v), want (false, nil)", ok, err)
	}
}
