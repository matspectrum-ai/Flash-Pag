package pixhub

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

func testConn(t *testing.T, extra map[string]string) provider.Connection {
	t.Helper()
	creds := map[string]string{
		"client_id":     "pub_test",
		"client_secret": "sec_test",
	}
	for k, v := range extra {
		creds[k] = v
	}
	raw, err := json.Marshal(creds)
	if err != nil {
		t.Fatal(err)
	}
	return provider.Connection{ID: "conn_test", ProviderCode: "pixhub", Credentials: raw}
}

func TestCreateCharge(t *testing.T) {
	var authCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth":
			authCalls.Add(1)
			if got := r.Header.Get("Authorization"); got == "" || got[:6] != "Basic " {
				t.Fatalf("missing basic auth: %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"token":"jwt-test","expiresIn":60000}`))
		case "/api/v1/pix/in/qrcode":
			if r.Header.Get("Authorization") != "Bearer jwt-test" {
				t.Fatalf("unexpected bearer token")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["amountInCents"] != float64(1500) {
				t.Fatalf("amount = %#v", body["amountInCents"])
			}
			if body["postbackUrl"] != "https://gateway.test/providers/pixhub/webhooks/conn_test?token=abc" {
				t.Fatalf("postback = %#v", body["postbackUrl"])
			}
			customer := body["customer"].(map[string]any)
			if customer["documentType"] != "cpf" || customer["document"] != "12345678901" {
				t.Fatalf("customer = %#v", customer)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"trx_123","pix":{"emv":"000201PIX"},"status":"pending","fees":0}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := NewWithClient(server.URL, server.Client())
	conn := testConn(t, nil)
	result, err := p.CreateCharge(context.Background(), conn, provider.ChargeRequest{
		OperationID: "11111111-1111-1111-1111-111111111111",
		AmountMinor: 1500,
		Currency:    "BRL",
		Description: "Servico",
		Customer: &provider.Customer{
			Name:     "Cliente Teste",
			Email:    "cliente@example.com",
			Document: "123.456.789-01",
		},
		WebhookURL: "https://gateway.test/providers/pixhub/webhooks/conn_test?token=abc",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExternalID != "trx_123" || result.Status != "pending" || result.QRCode != "000201PIX" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if authCalls.Load() != 1 {
		t.Fatalf("auth calls = %d", authCalls.Load())
	}
}

func TestCreateTransferUsesProviderIdempotency(t *testing.T) {
	var authCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth":
			authCalls.Add(1)
			_, _ = w.Write([]byte(`{"success":true,"token":"jwt-test","expiresIn":60000}`))
		case "/api/v1/pix/out/pixkey":
			if got := r.Header.Get("x-idempotency-key"); got != "22222222-2222-2222-2222-222222222222" {
				t.Fatalf("idempotency = %q", got)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["amount"] != float64(4200) || body["pixKey"] != "destino@example.com" {
				t.Fatalf("body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"transfer_123","status":"completed","amount":4200}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := NewWithClient(server.URL, server.Client())
	result, err := p.CreateTransfer(context.Background(), testConn(t, nil), provider.TransferRequest{
		OperationID: "22222222-2222-2222-2222-222222222222",
		AmountMinor: 4200,
		Currency:    "BRL",
		PixKey:      "destino@example.com",
		Description: "Pagamento",
		WebhookURL:  "https://gateway.test/callback",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExternalID != "transfer_123" || result.Status != "succeeded" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if authCalls.Load() != 1 {
		t.Fatalf("auth calls = %d", authCalls.Load())
	}
}

func TestTokenCache(t *testing.T) {
	var authCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth":
			authCalls.Add(1)
			_, _ = w.Write([]byte(`{"success":true,"token":"jwt-test","expiresIn":60000}`))
		case "/api/v1/pix/out/pixkey":
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"transfer_123","status":"pending"}}`))
		}
	}))
	defer server.Close()
	p := NewWithClient(server.URL, server.Client())
	conn := testConn(t, nil)
	for i := 0; i < 2; i++ {
		_, err := p.CreateTransfer(context.Background(), conn, provider.TransferRequest{OperationID: "33333333-3333-3333-3333-333333333333", AmountMinor: 100, Currency: "BRL", PixKey: "a@b.com"})
		if err != nil {
			t.Fatal(err)
		}
	}
	if authCalls.Load() != 1 {
		t.Fatalf("expected cached auth token, calls = %d", authCalls.Load())
	}
}

func TestVerifyWebhookSignature(t *testing.T) {
	body := []byte(`{"id":"evt_1","type":"transaction","event":"transaction_paid","scope":"user","transaction":{"id":"trx_1","amount":5000,"status":"paid"}}`)
	timestamp := "1725550000"
	secret := "whsec_test"
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))
	p := New()
	evt, err := p.VerifyWebhook(context.Background(), testConn(t, map[string]string{"webhook_secret": secret}), map[string][]string{
		"PixHub-Signature": {"t=" + timestamp + ",v1=" + sig},
	}, body)
	if err != nil {
		t.Fatal(err)
	}
	if evt.EventID != "evt_1" || evt.ExternalID != "trx_1" || evt.Kind != "pix_in" || evt.Status != "succeeded" || evt.AmountMinor != 5000 {
		t.Fatalf("unexpected event: %#v", evt)
	}
}

func TestVerifyWebhookTokenFallback(t *testing.T) {
	body := []byte(`{"id":"evt_2","type":"transfer","event":"transfer_canceled","scope":"user","transfer":{"id":"transfer_9","amount":7000,"status":"canceled"}}`)
	p := New()
	evt, err := p.VerifyWebhook(context.Background(), testConn(t, map[string]string{"webhook_token": "token_123"}), map[string][]string{
		"X-FlashPag-Webhook-Token": {"token_123"},
	}, body)
	if err != nil {
		t.Fatal(err)
	}
	if evt.ExternalID != "transfer_9" || evt.Kind != "" || evt.Status != "failed" || evt.AmountMinor != 7000 {
		t.Fatalf("unexpected event: %#v", evt)
	}
}

func TestVerifyWebhookRejectsBadSignature(t *testing.T) {
	body := []byte(`{"id":"evt_3","event":"transaction_paid","transaction":{"id":"trx_3","amount":100,"status":"paid"}}`)
	p := New()
	_, err := p.VerifyWebhook(context.Background(), testConn(t, map[string]string{"webhook_secret": "secret"}), map[string][]string{
		"PixHub-Signature": {"t=1,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
	}, body)
	if err == nil {
		t.Fatal("expected invalid signature error")
	}
}

func TestCreateChargeRejectsMissingCustomer(t *testing.T) {
	p := New()
	_, err := p.CreateCharge(context.Background(), testConn(t, nil), provider.ChargeRequest{AmountMinor: 100, Currency: "BRL"})
	if err == nil || !provider.IsFinal(err) {
		t.Fatalf("expected final validation error, got %v", err)
	}
}
