package recovery

import (
	"bytes"
	"testing"
)

func TestGenerateParseRoundTrip(t *testing.T) {
	serverKey := bytes.Repeat([]byte{7}, 32)
	kit, data, err := Generate("123e4567-e89b-12d3-a456-426614174000", serverKey)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != fileSize {
		t.Fatalf("unexpected size: %d", len(data))
	}
	parsed, err := Parse(data, serverKey)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.AccountID != kit.AccountID || parsed.KeyID != kit.KeyID || parsed.Secret != kit.Secret {
		t.Fatal("round trip mismatch")
	}
}

func TestParseRejectsTamperAndDowngrade(t *testing.T) {
	serverKey := bytes.Repeat([]byte{9}, 32)
	_, data, err := Generate("123e4567-e89b-12d3-a456-426614174000", serverKey)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if _, err := Parse(data, serverKey); err == nil {
		t.Fatal("tampered kit accepted")
	}
	_, data, err = Generate("123e4567-e89b-12d3-a456-426614174000", serverKey)
	if err != nil {
		t.Fatal(err)
	}
	data[8] = 0
	if _, err := Parse(data, serverKey); err != ErrUnsupported {
		t.Fatalf("expected unsupported version, got %v", err)
	}
}

func TestVerifierChangesWithSecret(t *testing.T) {
	serverKey := bytes.Repeat([]byte{3}, 32)
	kit, _, err := Generate("123e4567-e89b-12d3-a456-426614174000", serverKey)
	if err != nil {
		t.Fatal(err)
	}
	a, err := Verifier(serverKey, kit.Secret[:])
	if err != nil {
		t.Fatal(err)
	}
	kit.Secret[0] ^= 1
	b, err := Verifier(serverKey, kit.Secret[:])
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("verifier did not change")
	}
}

func TestRateHashIsDomainSeparated(t *testing.T) {
	serverKey := bytes.Repeat([]byte{5}, 32)
	a, err := RateHash(serverKey, "subject", "same")
	if err != nil {
		t.Fatal(err)
	}
	b, err := RateHash(serverKey, "ip", "same")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("rate hashes are not domain separated")
	}
}
