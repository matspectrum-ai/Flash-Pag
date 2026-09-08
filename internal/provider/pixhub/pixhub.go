package pixhub

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

const defaultBaseURL = "https://api.usepixhub.com"

type Provider struct {
	baseURL string
	client  *http.Client
	mu      sync.Mutex
	tokens  map[string]cachedToken
}

type cachedToken struct {
	value     string
	expiresAt time.Time
}

type credentials struct {
	ClientID      string `json:"client_id"`
	ClientSecret  string `json:"client_secret"`
	WebhookSecret string `json:"webhook_secret,omitempty"`
	WebhookToken  string `json:"webhook_token,omitempty"`
}

func New() *Provider {
	return NewWithClient(defaultBaseURL, &http.Client{Timeout: 12 * time.Second})
}

func NewWithClient(baseURL string, client *http.Client) *Provider {
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	return &Provider{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  client,
		tokens:  make(map[string]cachedToken),
	}
}

func (p *Provider) Code() string { return "pixhub" }

func (p *Provider) CheckConnection(ctx context.Context, conn provider.Connection) (provider.ConnectionStatus, error) {
	status, raw, err := p.request(ctx, conn, http.MethodGet, "/api/v1/balance", nil, "")
	if err != nil {
		return provider.ConnectionStatus{}, err
	}
	if status < 200 || status >= 300 {
		return provider.ConnectionStatus{}, classifyHTTP(status, raw)
	}
	var out struct {
		Success bool `json:"success"`
		Data    struct {
			Pix struct {
				Balance string `json:"balance"`
			} `json:"pix"`
			PixBlocked struct {
				Balance string `json:"balance"`
			} `json:"pixBlocked"`
			Reserve struct {
				Balance string `json:"balance"`
			} `json:"reserve"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub decode balance response: %w", err)
	}
	if !out.Success {
		return provider.ConnectionStatus{}, errors.New("pixhub balance response was unsuccessful")
	}
	available, err := decimalBRLToMinor(out.Data.Pix.Balance)
	if err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub available balance: %w", err)
	}
	blocked, err := decimalBRLToMinor(out.Data.PixBlocked.Balance)
	if err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub blocked balance: %w", err)
	}
	reserve, err := decimalBRLToMinor(out.Data.Reserve.Balance)
	if err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub reserve balance: %w", err)
	}
	return provider.ConnectionStatus{
		Provider: "pixhub", Healthy: true, Currency: "BRL",
		AvailableMinor: available, BlockedMinor: blocked, ReserveMinor: reserve,
	}, nil
}

func (p *Provider) Reconcile(ctx context.Context, conn provider.Connection, kind, externalID string) (provider.ReconcileResult, error) {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return provider.ReconcileResult{}, finalf("Pixhub reconciliation requires provider external id")
	}
	var path string
	switch kind {
	case "pix_in":
		path = "/api/v1/pix/in/qrcode/" + url.PathEscape(externalID)
	case "transfer", "withdrawal":
		path = "/api/v1/pix/out/pixkey/" + url.PathEscape(externalID)
	default:
		return provider.ReconcileResult{}, finalf("Pixhub does not reconcile transaction kind %q", kind)
	}
	statusCode, raw, err := p.request(ctx, conn, http.MethodGet, path, nil, "")
	if err != nil {
		return provider.ReconcileResult{}, err
	}
	if statusCode < 200 || statusCode >= 300 {
		return provider.ReconcileResult{}, classifyHTTP(statusCode, raw)
	}
	var out struct {
		Success bool `json:"success"`
		Data    struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return provider.ReconcileResult{}, fmt.Errorf("pixhub decode reconciliation response: %w", err)
	}
	if !out.Success || out.Data.ID == "" {
		return provider.ReconcileResult{}, errors.New("pixhub returned an incomplete reconciliation response")
	}
	if out.Data.ID != externalID {
		return provider.ReconcileResult{}, errors.New("pixhub reconciliation returned a different external id")
	}
	status := transferStatus(out.Data.Status)
	if kind == "pix_in" {
		status = chargeStatus(out.Data.Status)
	}
	return provider.ReconcileResult{ExternalID: out.Data.ID, Status: status, Raw: append(json.RawMessage(nil), raw...)}, nil
}

func (p *Provider) CreateCharge(ctx context.Context, conn provider.Connection, in provider.ChargeRequest) (provider.ChargeResult, error) {
	if in.AmountMinor < 100 || strings.ToUpper(in.Currency) != "BRL" {
		return provider.ChargeResult{}, finalf("Pixhub requires BRL charges of at least 100 centavos")
	}
	if in.Customer == nil {
		return provider.ChargeResult{}, finalf("Pixhub requires customer_id with CPF or CNPJ")
	}
	doc := digits(in.Customer.Document)
	docType := documentType(doc)
	if docType == "" {
		return provider.ChargeResult{}, finalf("Pixhub customer document must be a valid CPF/CNPJ length")
	}

	payload := map[string]any{
		"amountInCents": in.AmountMinor,
		"customer": map[string]any{
			"documentType": docType,
			"document":     doc,
		},
	}
	if in.Description != "" {
		payload["description"] = trim140(in.Description)
	}
	if in.WebhookURL != "" {
		payload["postbackUrl"] = in.WebhookURL
	}
	customer := payload["customer"].(map[string]any)
	if in.Customer.Name != "" {
		customer["name"] = in.Customer.Name
	}
	if in.Customer.Email != "" {
		customer["email"] = in.Customer.Email
	}
	if in.Customer.Phone != "" {
		customer["phone"] = in.Customer.Phone
	}

	status, raw, err := p.request(ctx, conn, http.MethodPost, "/api/v1/pix/in/qrcode", payload, "")
	if err != nil {
		return provider.ChargeResult{}, err
	}
	if status < 200 || status >= 300 {
		return provider.ChargeResult{}, classifyHTTP(status, raw)
	}
	var out struct {
		Success bool `json:"success"`
		Data    struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Pix    struct {
				EMV    string `json:"emv"`
				QRCode string `json:"qrCode"`
			} `json:"pix"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return provider.ChargeResult{}, fmt.Errorf("pixhub decode charge response: %w", err)
	}
	if !out.Success || out.Data.ID == "" || out.Data.Pix.EMV == "" {
		return provider.ChargeResult{}, errors.New("pixhub returned an incomplete charge response")
	}
	return provider.ChargeResult{
		ExternalID: out.Data.ID,
		Status:     chargeStatus(out.Data.Status),
		QRCode:     out.Data.Pix.EMV,
		Raw:        append(json.RawMessage(nil), raw...),
	}, nil
}

func (p *Provider) CreateTransfer(ctx context.Context, conn provider.Connection, in provider.TransferRequest) (provider.TransferResult, error) {
	if in.AmountMinor <= 0 || strings.ToUpper(in.Currency) != "BRL" || strings.TrimSpace(in.PixKey) == "" {
		return provider.TransferResult{}, finalf("Pixhub transfer requires amount, BRL and pix key")
	}
	if strings.TrimSpace(in.OperationID) == "" {
		return provider.TransferResult{}, finalf("Pixhub transfer requires operation id for idempotency")
	}
	payload := map[string]any{
		"pixKey":   strings.TrimSpace(in.PixKey),
		"amount":   in.AmountMinor,
		"currency": "BRL",
	}
	if in.Description != "" {
		payload["description"] = trim140(in.Description)
	}
	if in.WebhookURL != "" {
		payload["postbackUrl"] = in.WebhookURL
	}

	status, raw, err := p.request(ctx, conn, http.MethodPost, "/api/v1/pix/out/pixkey", payload, in.OperationID)
	if err != nil {
		return provider.TransferResult{}, err
	}
	if status < 200 || status >= 300 {
		return provider.TransferResult{}, classifyHTTP(status, raw)
	}
	var out struct {
		Success bool `json:"success"`
		Data    struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return provider.TransferResult{}, fmt.Errorf("pixhub decode transfer response: %w", err)
	}
	if !out.Success || out.Data.ID == "" {
		return provider.TransferResult{}, errors.New("pixhub returned an incomplete transfer response")
	}
	return provider.TransferResult{
		ExternalID: out.Data.ID,
		Status:     transferStatus(out.Data.Status),
		Raw:        append(json.RawMessage(nil), raw...),
	}, nil
}

func (p *Provider) VerifyWebhook(_ context.Context, conn provider.Connection, headers map[string][]string, body []byte) (provider.WebhookEvent, error) {
	creds, err := decodeCredentials(conn)
	if err != nil {
		return provider.WebhookEvent{}, err
	}
	if err := verifyCallbackAuth(creds, headers, body); err != nil {
		return provider.WebhookEvent{}, err
	}

	var payload struct {
		ID          string `json:"id"`
		Type        string `json:"type"`
		Event       string `json:"event"`
		Transaction *struct {
			ID     string `json:"id"`
			Amount int64  `json:"amount"`
			Status string `json:"status"`
		} `json:"transaction"`
		Transfer *struct {
			ID     string `json:"id"`
			Amount int64  `json:"amount"`
			Status string `json:"status"`
		} `json:"transfer"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return provider.WebhookEvent{}, fmt.Errorf("pixhub decode webhook: %w", err)
	}
	if payload.ID == "" || payload.Event == "" {
		return provider.WebhookEvent{}, errors.New("pixhub webhook is missing event identity")
	}

	evt := provider.WebhookEvent{EventID: payload.ID, Raw: append(json.RawMessage(nil), body...)}
	switch {
	case payload.Transaction != nil:
		evt.ExternalID = payload.Transaction.ID
		evt.Kind = "pix_in"
		evt.AmountMinor = payload.Transaction.Amount
		evt.Status = webhookChargeStatus(payload.Event, payload.Transaction.Status)
	case payload.Transfer != nil:
		evt.ExternalID = payload.Transfer.ID
		// PIX OUT is shared by local transfer and withdrawal. Leaving Kind empty lets
		// the gateway match by the provider external id without creating a false conflict.
		evt.AmountMinor = payload.Transfer.Amount
		evt.Status = webhookTransferStatus(payload.Event, payload.Transfer.Status)
	default:
		return provider.WebhookEvent{}, errors.New("pixhub webhook does not contain a transaction or transfer")
	}
	if evt.ExternalID == "" {
		return provider.WebhookEvent{}, errors.New("pixhub webhook is missing provider transaction id")
	}
	return evt, nil
}

func (p *Provider) request(ctx context.Context, conn provider.Connection, method, path string, payload any, idempotencyKey string) (int, []byte, error) {
	token, err := p.token(ctx, conn, false)
	if err != nil {
		return 0, nil, err
	}
	status, raw, err := p.do(ctx, method, path, token, payload, idempotencyKey)
	if err != nil {
		return 0, nil, err
	}
	if status != http.StatusUnauthorized {
		return status, raw, nil
	}
	// A 401 is an explicit rejection, so retrying once with a fresh token cannot
	// duplicate the financial operation. Network/5xx failures are never retried here.
	token, err = p.token(ctx, conn, true)
	if err != nil {
		return status, raw, err
	}
	return p.do(ctx, method, path, token, payload, idempotencyKey)
}

func (p *Provider) do(ctx context.Context, method, path, token string, payload any, idempotencyKey string) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, p.baseURL+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		req.Header.Set("x-idempotency-key", idempotencyKey)
	}
	res, err := p.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("pixhub request outcome unknown: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("pixhub read response: %w", err)
	}
	return res.StatusCode, raw, nil
}

func (p *Provider) token(ctx context.Context, conn provider.Connection, force bool) (string, error) {
	creds, err := decodeCredentials(conn)
	if err != nil {
		return "", err
	}
	cacheKey := conn.ID + "|" + creds.ClientID
	now := time.Now()
	p.mu.Lock()
	if !force {
		if cached, ok := p.tokens[cacheKey]; ok && now.Before(cached.expiresAt) {
			p.mu.Unlock()
			return cached.value, nil
		}
	}
	delete(p.tokens, cacheKey)
	p.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/api/auth", nil)
	if err != nil {
		return "", err
	}
	basic := base64.StdEncoding.EncodeToString([]byte(creds.ClientID + ":" + creds.ClientSecret))
	req.Header.Set("Authorization", "Basic "+basic)
	res, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("pixhub authentication failed: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return "", fmt.Errorf("pixhub authentication read failed: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", classifyHTTP(res.StatusCode, raw)
	}
	var out struct {
		Success   bool   `json:"success"`
		Token     string `json:"token"`
		ExpiresIn int64  `json:"expiresIn"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("pixhub decode authentication response: %w", err)
	}
	if !out.Success || out.Token == "" {
		return "", finalf("Pixhub authentication returned no token")
	}
	ttl := time.Duration(out.ExpiresIn) * time.Millisecond
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	if ttl > 10*time.Second {
		ttl -= 10 * time.Second
	}
	p.mu.Lock()
	p.tokens[cacheKey] = cachedToken{value: out.Token, expiresAt: now.Add(ttl)}
	p.mu.Unlock()
	return out.Token, nil
}

func decodeCredentials(conn provider.Connection) (credentials, error) {
	var creds credentials
	if len(conn.Credentials) == 0 || json.Unmarshal(conn.Credentials, &creds) != nil {
		return credentials{}, finalf("Pixhub credentials are not configured")
	}
	if strings.TrimSpace(creds.ClientID) == "" || strings.TrimSpace(creds.ClientSecret) == "" {
		return credentials{}, finalf("Pixhub client_id and client_secret are required")
	}
	return creds, nil
}

func verifyCallbackAuth(creds credentials, headers map[string][]string, body []byte) error {
	signature := first(headers, "PixHub-Signature")
	if signature != "" && creds.WebhookSecret != "" {
		timestamp, got, ok := parseSignature(signature)
		if !ok {
			return errors.New("invalid Pixhub webhook signature format")
		}
		if validSignature(timestamp, got, creds.WebhookSecret, body) {
			return nil
		}
		var compact bytes.Buffer
		if json.Compact(&compact, body) == nil && validSignature(timestamp, got, creds.WebhookSecret, compact.Bytes()) {
			return nil
		}
		return errors.New("invalid Pixhub webhook signature")
	}
	// Pixhub documents signatures for registered webhook objects, but postbackUrl
	// callbacks are not guaranteed to carry a signatureSecret. Flash Pag therefore
	// appends an encrypted per-connection bearer token to postbackUrl as a fallback.
	if creds.WebhookToken != "" {
		got := first(headers, "X-FlashPag-Webhook-Token")
		if hmac.Equal([]byte(got), []byte(creds.WebhookToken)) {
			return nil
		}
	}
	return errors.New("Pixhub webhook is not authenticated")
}

func parseSignature(v string) (timestamp, sig string, ok bool) {
	for _, part := range strings.Split(v, ",") {
		part = strings.TrimSpace(part)
		switch {
		case strings.HasPrefix(part, "t="):
			timestamp = strings.TrimPrefix(part, "t=")
		case strings.HasPrefix(part, "v1="):
			sig = strings.TrimPrefix(part, "v1=")
		}
	}
	_, err := hex.DecodeString(sig)
	return timestamp, sig, timestamp != "" && sig != "" && err == nil
}

func validSignature(timestamp, got, secret string, body []byte) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(strings.ToLower(got)), []byte(want))
}

func classifyHTTP(status int, raw []byte) error {
	var apiErr struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &apiErr)
	msg := strings.TrimSpace(apiErr.Message)
	if msg == "" {
		msg = http.StatusText(status)
	}
	if apiErr.Error != "" {
		msg = apiErr.Error + ": " + msg
	}
	err := fmt.Errorf("pixhub HTTP %d: %s", status, msg)
	if status >= 400 && status < 500 {
		return &provider.FinalError{Err: err}
	}
	return err
}

func chargeStatus(v string) string {
	switch strings.ToLower(v) {
	case "paid":
		return "succeeded"
	case "canceled":
		return "failed"
	default:
		return "pending"
	}
}

func transferStatus(v string) string {
	switch strings.ToLower(v) {
	case "completed", "paid":
		return "succeeded"
	case "canceled", "refused", "banking_refused", "banking_error", "error":
		return "failed"
	default:
		return "pending"
	}
}

func webhookChargeStatus(event, status string) string {
	switch strings.ToLower(event) {
	case "transaction_paid":
		return "succeeded"
	case "transaction_refunded":
		// Refund ledgering is deliberately outside this MVP. Persist the provider event
		// without mutating an already-settled credit until a reversal journal exists.
		return "pending"
	}
	return chargeStatus(status)
}

func webhookTransferStatus(event, status string) string {
	switch strings.ToLower(event) {
	case "transfer_completed":
		return "succeeded"
	case "transfer_canceled":
		return "failed"
	}
	return transferStatus(status)
}

func decimalBRLToMinor(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("empty decimal amount")
	}
	negative := strings.HasPrefix(value, "-")
	if negative {
		value = strings.TrimPrefix(value, "-")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, fmt.Errorf("invalid decimal amount %q", value)
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid decimal amount %q", value)
	}
	fraction := "00"
	if len(parts) == 2 {
		switch len(parts[1]) {
		case 1:
			fraction = parts[1] + "0"
		case 2:
			fraction = parts[1]
		default:
			return 0, fmt.Errorf("invalid decimal amount %q", value)
		}
	}
	cents, err := strconv.ParseInt(fraction, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid decimal amount %q", value)
	}
	if whole > (int64(^uint64(0)>>1)-cents)/100 {
		return 0, errors.New("decimal amount overflows int64")
	}
	minor := whole*100 + cents
	if negative {
		minor = -minor
	}
	return minor, nil
}

func documentType(document string) string {
	switch len(document) {
	case 11:
		return "cpf"
	case 14:
		return "cnpj"
	default:
		return ""
	}
}

func digits(v string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, v)
}

func trim140(v string) string {
	r := []rune(v)
	if len(r) > 140 {
		r = r[:140]
	}
	return string(r)
}

func first(h map[string][]string, key string) string {
	for k, values := range h {
		if strings.EqualFold(k, key) && len(values) > 0 {
			return values[0]
		}
	}
	return ""
}

func finalf(format string, args ...any) error {
	return &provider.FinalError{Err: fmt.Errorf(format, args...)}
}
