package provider

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
)

type Connection struct {
	ID           string
	ProviderCode string
	Credentials  json.RawMessage
}

type ChargeRequest struct {
	OperationID string
	AmountMinor int64
	Currency    string
	Description string
}

type ChargeResult struct {
	ExternalID string          `json:"external_id"`
	Status     string          `json:"status"`
	QRCode     string          `json:"qr_code,omitempty"`
	Raw        json.RawMessage `json:"raw,omitempty"`
}

type TransferRequest struct {
	OperationID string
	AmountMinor int64
	Currency    string
	PixKey      string
	Description string
}

type TransferResult struct {
	ExternalID string          `json:"external_id"`
	Status     string          `json:"status"`
	Raw        json.RawMessage `json:"raw,omitempty"`
}

type WebhookEvent struct {
	EventID     string          `json:"event_id"`
	ExternalID  string          `json:"external_id"`
	Kind        string          `json:"kind"`   // pix_in | transfer | withdrawal
	Status      string          `json:"status"` // succeeded | failed | pending
	AmountMinor int64           `json:"amount_minor"`
	Raw         json.RawMessage `json:"raw,omitempty"`
}

type Provider interface {
	Code() string
	CreateCharge(context.Context, Connection, ChargeRequest) (ChargeResult, error)
	CreateTransfer(context.Context, Connection, TransferRequest) (TransferResult, error)
	VerifyWebhook(context.Context, Connection, map[string][]string, []byte) (WebhookEvent, error)
}

type FinalError struct{ Err error }

func (e *FinalError) Error() string { return e.Err.Error() }
func (e *FinalError) Unwrap() error { return e.Err }
func IsFinal(err error) bool        { var e *FinalError; return errors.As(err, &e) }

type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

func NewRegistry(ps ...Provider) *Registry {
	r := &Registry{providers: map[string]Provider{}}
	for _, p := range ps {
		r.providers[p.Code()] = p
	}
	return r
}
func (r *Registry) Get(code string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[code]
	return p, ok
}
func (r *Registry) Codes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.providers))
	for k := range r.providers {
		out = append(out, k)
	}
	return out
}
