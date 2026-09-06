package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
	"github.com/matspectrum-ai/Flash-Pag/internal/supabase"
)

type Worker struct {
	sb       *supabase.Client
	box      *cryptobox.Box
	client   *http.Client
	interval time.Duration
	log      *slog.Logger
}

type delivery struct {
	ID             string          `json:"id"`
	EndpointID     string          `json:"endpoint_id"`
	OrganizationID string          `json:"organization_id"`
	EventID        string          `json:"event_id"`
	EventType      string          `json:"event_type"`
	Payload        json.RawMessage `json:"payload"`
	AttemptCount   int             `json:"attempt_count"`
}

type endpoint struct {
	ID               string `json:"id"`
	URL              string `json:"url"`
	SecretCiphertext string `json:"secret_ciphertext"`
	Status           string `json:"status"`
}

func NewWorker(sb *supabase.Client, box *cryptobox.Box, interval time.Duration, log *slog.Logger) *Worker {
	return &Worker{sb: sb, box: box, interval: interval, log: log, client: &http.Client{Timeout: 10 * time.Second}}
}

func (w *Worker) Run(ctx context.Context) {
	if w.box == nil {
		w.log.Warn("webhook worker disabled: APP_MASTER_KEY_B64 is not configured")
		return
	}
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	var rows []delivery
	if err := w.sb.Do(ctx, http.MethodPost, "/rest/v1/rpc/claim_webhook_deliveries", nil, map[string]any{"p_limit": 20}, "", &rows); err != nil {
		w.log.Error("claim webhook deliveries", "err", err)
		return
	}
	for _, d := range rows {
		w.deliver(ctx, d)
	}
}

func (w *Worker) deliver(ctx context.Context, d delivery) {
	q := url.Values{"id": {"eq." + d.EndpointID}, "select": {"id,url,secret_ciphertext,status"}}
	var eps []endpoint
	if err := w.sb.Do(ctx, http.MethodGet, "/rest/v1/webhook_endpoints", q, nil, "", &eps); err != nil || len(eps) != 1 {
		w.fail(ctx, d, 0, "endpoint lookup failed")
		return
	}
	ep := eps[0]
	if ep.Status != "active" {
		w.fail(ctx, d, 0, "endpoint disabled")
		return
	}
	secret, err := w.box.Open(ep.SecretCiphertext)
	if err != nil {
		w.fail(ctx, d, 0, "endpoint secret decrypt failed")
		return
	}
	envelope, _ := json.Marshal(map[string]any{"id": d.EventID, "type": d.EventType, "data": json.RawMessage(d.Payload), "created_at": time.Now().UTC().Format(time.RFC3339Nano)})
	ts := time.Now().Unix()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep.URL, bytes.NewReader(envelope))
	if err != nil {
		w.fail(ctx, d, 0, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "FlashPag-Webhooks/1.0")
	req.Header.Set("X-FlashPag-Event-Id", d.EventID)
	req.Header.Set("X-FlashPag-Timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("X-FlashPag-Signature", Signature(string(secret), ts, envelope))
	resp, err := w.client.Do(req)
	if err != nil {
		w.fail(ctx, d, 0, err.Error())
		return
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		patch := map[string]any{"status": "succeeded", "last_status": resp.StatusCode, "last_error": nil, "locked_at": nil, "delivered_at": time.Now().UTC().Format(time.RFC3339Nano)}
		q := url.Values{"id": {"eq." + d.ID}}
		if err := w.sb.Do(ctx, http.MethodPatch, "/rest/v1/webhook_deliveries", q, patch, "", nil); err != nil {
			w.log.Error("mark webhook success", "id", d.ID, "err", err)
		}
		return
	}
	w.fail(ctx, d, resp.StatusCode, fmt.Sprintf("remote returned %d", resp.StatusCode))
}

func (w *Worker) fail(ctx context.Context, d delivery, status int, message string) {
	delay := time.Duration(1<<min(d.AttemptCount, 10)) * time.Minute
	patch := map[string]any{"status": "failed", "last_status": status, "last_error": message, "locked_at": nil, "next_attempt_at": time.Now().Add(delay).UTC().Format(time.RFC3339Nano)}
	q := url.Values{"id": {"eq." + d.ID}}
	if err := w.sb.Do(ctx, http.MethodPatch, "/rest/v1/webhook_deliveries", q, patch, "", nil); err != nil {
		w.log.Error("mark webhook failure", "id", d.ID, "err", err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
