package mock

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

type Provider struct{}

func New() *Provider             { return &Provider{} }
func (p *Provider) Code() string { return "mock" }

func (p *Provider) CreateCharge(_ context.Context, _ provider.Connection, in provider.ChargeRequest) (provider.ChargeResult, error) {
	if in.AmountMinor <= 0 {
		return provider.ChargeResult{}, &provider.FinalError{Err: errors.New("amount must be positive")}
	}
	ext := "mock_charge_" + strings.ReplaceAll(in.OperationID, "-", "")
	return provider.ChargeResult{ExternalID: ext, Status: "pending", QRCode: "MOCKPIX:" + ext}, nil
}

func (p *Provider) CreateTransfer(_ context.Context, _ provider.Connection, in provider.TransferRequest) (provider.TransferResult, error) {
	if in.AmountMinor <= 0 || in.PixKey == "" {
		return provider.TransferResult{}, &provider.FinalError{Err: errors.New("invalid transfer")}
	}
	ext := "mock_transfer_" + strings.ReplaceAll(in.OperationID, "-", "")
	return provider.TransferResult{ExternalID: ext, Status: "pending"}, nil
}

func (p *Provider) VerifyWebhook(_ context.Context, conn provider.Connection, headers map[string][]string, body []byte) (provider.WebhookEvent, error) {
	var creds struct {
		WebhookSecret string `json:"webhook_secret"`
	}
	if len(conn.Credentials) == 0 || json.Unmarshal(conn.Credentials, &creds) != nil || creds.WebhookSecret == "" {
		return provider.WebhookEvent{}, errors.New("mock webhook secret not configured")
	}
	got := first(headers, "X-Mock-Signature")
	mac := hmac.New(sha256.New, []byte(creds.WebhookSecret))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(got), []byte(want)) {
		return provider.WebhookEvent{}, errors.New("invalid webhook signature")
	}
	var evt provider.WebhookEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return provider.WebhookEvent{}, fmt.Errorf("decode mock webhook: %w", err)
	}
	evt.Raw = append([]byte(nil), body...)
	if evt.EventID == "" || evt.ExternalID == "" {
		return provider.WebhookEvent{}, errors.New("missing event identity")
	}
	return evt, nil
}
func first(h map[string][]string, key string) string {
	for k, v := range h {
		if strings.EqualFold(k, key) && len(v) > 0 {
			return v[0]
		}
	}
	return ""
}
