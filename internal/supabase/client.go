package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL        string
	secretKey      string
	publishableKey string
	http           *http.Client
}

type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string { return fmt.Sprintf("supabase status=%d body=%s", e.Status, e.Body) }

type AuthUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type SignUpResult struct {
	UserID        string
	AccessToken   string
	ExpiresIn     int64
	NeedsConfirm  bool
	AlreadyExists bool
}

func New(baseURL, secretKey, publishableKey string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"), secretKey: secretKey, publishableKey: publishableKey,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Do(ctx context.Context, method, path string, q url.Values, body any, prefer string, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	u := c.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, r)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.secretKey)
	// Legacy service_role keys are JWTs and still expect Authorization. New sb_secret keys use apikey only.
	if strings.HasPrefix(c.secretKey, "eyJ") {
		req.Header.Set("Authorization", "Bearer "+c.secretKey)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("decode supabase response: %w", err)
		}
	}
	return nil
}

func (c *Client) AuthUser(ctx context.Context, accessToken string) (AuthUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/auth/v1/user", nil)
	if err != nil {
		return AuthUser{}, err
	}
	req.Header.Set("apikey", c.publishableKey)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := c.http.Do(req)
	if err != nil {
		return AuthUser{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return AuthUser{}, &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	var u AuthUser
	if err := json.Unmarshal(raw, &u); err != nil {
		return AuthUser{}, err
	}
	return u, nil
}

func (c *Client) PasswordLogin(ctx context.Context, email, password string) (accessToken string, expiresIn int64, err error) {
	payload := map[string]string{"email": email, "password": password}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/auth/v1/token?grant_type=password", bytes.NewReader(b))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("apikey", c.publishableKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	var v struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", 0, err
	}
	return v.AccessToken, v.ExpiresIn, nil
}

type MFAFactor struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Status       string `json:"status"`
	FriendlyName string `json:"friendly_name"`
}

type MFAFactors struct {
	All  []MFAFactor `json:"all"`
	TOTP []MFAFactor `json:"totp"`
}

type MFAEnrollment struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	FriendlyName string `json:"friendly_name"`
	TOTP         struct {
		QRCode string `json:"qr_code"`
		Secret string `json:"secret"`
		URI    string `json:"uri"`
	} `json:"totp"`
}

type MFAChallenge struct {
	ID string `json:"id"`
}

type MFASession struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (c *Client) authRequest(ctx context.Context, accessToken, method, path string, body any, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.publishableKey)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("decode auth response: %w", err)
		}
	}
	return nil
}

func (c *Client) ListMFAFactors(ctx context.Context, accessToken string) (MFAFactors, error) {
	// The Auth API exposes the current user, including MFA factor metadata.
	// This avoids depending on PostgREST exposing the internal auth schema.
	var out struct {
		Factors []struct {
			ID           string `json:"id"`
			FactorType   string `json:"factor_type"`
			Status       string `json:"status"`
			FriendlyName string `json:"friendly_name"`
		} `json:"factors"`
	}
	if err := c.authRequest(ctx, accessToken, http.MethodGet, "/auth/v1/user", nil, &out); err != nil {
		return MFAFactors{}, err
	}
	factors := make([]MFAFactor, 0, len(out.Factors))
	totp := make([]MFAFactor, 0, len(out.Factors))
	for _, factor := range out.Factors {
		f := MFAFactor{ID: factor.ID, Type: factor.FactorType, Status: factor.Status, FriendlyName: factor.FriendlyName}
		factors = append(factors, f)
		if factor.FactorType == "totp" && factor.Status == "verified" {
			totp = append(totp, f)
		}
	}
	return MFAFactors{All: factors, TOTP: totp}, nil
}

func (c *Client) UnenrollMFA(ctx context.Context, accessToken, factorID string) error {
	return c.authRequest(ctx, accessToken, http.MethodDelete, "/auth/v1/factors/"+url.PathEscape(factorID), nil, nil)
}

func (c *Client) EnrollTOTP(ctx context.Context, accessToken, issuer string) (MFAEnrollment, error) {
	// A failed enrollment leaves an unverified factor in Supabase. Remove only
	// those inactive TOTP factors before starting a fresh enrollment; verified
	// authenticators are never touched. This keeps retries idempotent and avoids
	// friendly-name conflicts from abandoned setup attempts.
	if factors, err := c.ListMFAFactors(ctx, accessToken); err == nil {
		for _, factor := range factors.All {
			if factor.Type == "totp" && factor.Status != "verified" {
				if err := c.UnenrollMFA(ctx, accessToken, factor.ID); err != nil {
					return MFAEnrollment{}, err
				}
			}
		}
	} else {
		return MFAEnrollment{}, err
	}

	var out MFAEnrollment
	body := map[string]string{"factor_type": "totp", "issuer": issuer}
	err := c.authRequest(ctx, accessToken, http.MethodPost, "/auth/v1/factors", body, &out)
	return out, err
}

func (c *Client) ChallengeMFA(ctx context.Context, accessToken, factorID string) (MFAChallenge, error) {
	var out MFAChallenge
	err := c.authRequest(ctx, accessToken, http.MethodPost, "/auth/v1/factors/"+url.PathEscape(factorID)+"/challenge", nil, &out)
	return out, err
}

func (c *Client) VerifyMFA(ctx context.Context, accessToken, factorID, challengeID, code string) (MFASession, error) {
	var out MFASession
	body := map[string]string{"challenge_id": challengeID, "code": code}
	err := c.authRequest(ctx, accessToken, http.MethodPost, "/auth/v1/factors/"+url.PathEscape(factorID)+"/verify", body, &out)
	return out, err
}

func (c *Client) SignUp(ctx context.Context, email, password string) (SignUpResult, error) {
	payload := map[string]string{"email": strings.TrimSpace(email), "password": password}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/auth/v1/signup", bytes.NewReader(b))
	if err != nil {
		return SignUpResult{}, err
	}
	req.Header.Set("apikey", c.publishableKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return SignUpResult{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return SignUpResult{}, &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	var v struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		User        struct {
			ID         string            `json:"id"`
			Identities []json.RawMessage `json:"identities"`
		} `json:"user"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return SignUpResult{}, err
	}
	if v.User.ID == "" {
		return SignUpResult{}, fmt.Errorf("signup returned no user id")
	}
	return SignUpResult{
		UserID:        v.User.ID,
		AccessToken:   v.AccessToken,
		ExpiresIn:     v.ExpiresIn,
		NeedsConfirm:  v.AccessToken == "",
		AlreadyExists: v.User.Identities != nil && len(v.User.Identities) == 0,
	}, nil
}

func (c *Client) StorageUpload(ctx context.Context, bucket, objectPath, contentType string, data []byte) error {
	u := c.baseURL + "/storage/v1/object/" + escapeStoragePath(bucket, objectPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(data))
	if err != nil {
		return err
	}
	c.storageAuth(req)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("x-upsert", "false")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	return nil
}

func (c *Client) StorageDownload(ctx context.Context, bucket, objectPath string) ([]byte, string, error) {
	u := c.baseURL + "/storage/v1/object/" + escapeStoragePath(bucket, objectPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, "", err
	}
	c.storageAuth(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	return raw, resp.Header.Get("Content-Type"), nil
}

func (c *Client) StorageDelete(ctx context.Context, bucket, objectPath string) error {
	u := c.baseURL + "/storage/v1/object/" + escapeStoragePath(bucket, objectPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
	if err != nil {
		return err
	}
	c.storageAuth(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &Error{Status: resp.StatusCode, Body: string(raw)}
	}
	return nil
}

func (c *Client) storageAuth(req *http.Request) {
	req.Header.Set("apikey", c.secretKey)
	// Hosted Supabase understands secret keys through the apikey header. Legacy service_role
	// keys are JWTs and can also be presented as the Storage bearer token.
	if strings.HasPrefix(c.secretKey, "eyJ") {
		req.Header.Set("Authorization", "Bearer "+c.secretKey)
	}
}

func escapeStoragePath(bucket, objectPath string) string {
	parts := append([]string{bucket}, strings.Split(strings.Trim(objectPath, "/"), "/")...)
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}
