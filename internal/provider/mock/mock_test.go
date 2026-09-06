package mock

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
	"testing"
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
