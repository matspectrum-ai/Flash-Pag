package mock

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

func TestWebhookVerification(t *testing.T) {
	p := New()
	body := []byte(`{"event_id":"evt_1","external_id":"x","kind":"pix_in","status":"succeeded","amount_minor":100}`)
	mac := hmac.New(sha256.New, []byte("s"))
	mac.Write(body)
	h := map[string][]string{"X-Mock-Signature": {hex.EncodeToString(mac.Sum(nil))}}
	_, err := p.VerifyWebhook(context.Background(), provider.Connection{Credentials: []byte(`{"webhook_secret":"s"}`)}, h, body)
	if err != nil {
		t.Fatal(err)
	}
}

func TestReconcileChargeSucceeds(t *testing.T) {
	p := New()
	got, err := p.Reconcile(context.Background(), provider.Connection{}, "pix_in", "mock_charge_123")
	if err != nil {
		t.Fatal(err)
	}
	if got.ExternalID != "mock_charge_123" || got.Status != "succeeded" {
		t.Fatalf("unexpected reconciliation result: %+v", got)
	}
	if len(got.Raw) == 0 {
		t.Fatal("expected mock reconciliation evidence")
	}
}

func TestReconcileOutboundSucceeds(t *testing.T) {
	p := New()
	for _, kind := range []string{"transfer", "withdrawal"} {
		got, err := p.Reconcile(context.Background(), provider.Connection{}, kind, "mock_transfer_123")
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if got.Status != "succeeded" {
			t.Fatalf("%s: expected succeeded, got %q", kind, got.Status)
		}
	}
}

func TestReconcileRejectsMismatchedIdentity(t *testing.T) {
	p := New()
	if _, err := p.Reconcile(context.Background(), provider.Connection{}, "pix_in", "mock_transfer_123"); err == nil {
		t.Fatal("expected mismatched provider identity to fail")
	}
	if _, err := p.Reconcile(context.Background(), provider.Connection{}, "refund", "mock_charge_123"); err == nil {
		t.Fatal("expected unsupported operation kind to fail")
	}
}
