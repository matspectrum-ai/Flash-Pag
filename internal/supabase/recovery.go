package supabase

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type RecoveryKitRow struct {
	UserID         string `json:"user_id"`
	KeyID          string `json:"key_id"`
	Version        int    `json:"version"`
	SecretVerifier string `json:"secret_verifier"`
	Status         string `json:"status"`
}

type RecoveryChallengeRow struct {
	ID string `json:"id"`
}

type RecoveryResetClaim struct {
	UserID string `json:"user_id"`
	KeyID  string `json:"key_id"`
	Status string `json:"status"`
}

func (c *Client) adminAuthRequest(ctx context.Context, method, path string, body any, out any) error {
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
	req.Header.Set("apikey", c.secretKey)
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
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
			return fmt.Errorf("decode auth admin response: %w", err)
		}
	}
	return nil
}

func (c *Client) AdminGetUserByID(ctx context.Context, userID string) (AuthUser, error) {
	var out AuthUser
	err := c.adminAuthRequest(ctx, http.MethodGet, "/auth/v1/admin/users/"+url.PathEscape(userID), nil, &out)
	return out, err
}

func (c *Client) AdminUpdateUserPassword(ctx context.Context, userID, password string) error {
	return c.adminAuthRequest(ctx, http.MethodPut, "/auth/v1/admin/users/"+url.PathEscape(userID), map[string]string{"password": password}, nil)
}

func (c *Client) AuthSessionActive(ctx context.Context, accessToken string) (bool, error) {
	parts := strings.Split(accessToken, ".")
	if len(parts) != 3 {
		return false, fmt.Errorf("invalid access token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false, fmt.Errorf("decode access token: %w", err)
	}
	var claims struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.SessionID == "" {
		return false, fmt.Errorf("access token has no session id")
	}
	var active bool
	err = c.Do(ctx, http.MethodPost, "/rest/v1/rpc/flashpag_auth_session_active", nil, map[string]string{"p_session_id": claims.SessionID}, "", &active)
	return active, err
}

func (c *Client) RotateRecoveryKit(ctx context.Context, userID, keyID, verifier string) error {
	return c.Do(ctx, http.MethodPost, "/rest/v1/rpc/flashpag_rotate_recovery_kit", nil, map[string]string{
		"p_user_id": userID, "p_key_id": keyID, "p_secret_verifier": verifier,
	}, "", nil)
}

func (c *Client) RecoveryKit(ctx context.Context, userID, keyID string) (RecoveryKitRow, error) {
	var rows []RecoveryKitRow
	q := url.Values{
		"user_id": {"eq." + userID},
		"key_id":  {"eq." + keyID},
		"status":  {"eq.active"},
		"select":  {"user_id,key_id,version,secret_verifier,status"},
		"limit":   {"1"},
	}
	if err := c.Do(ctx, http.MethodGet, "/rest/v1/account_recovery_kits", q, nil, "", &rows); err != nil {
		return RecoveryKitRow{}, err
	}
	if len(rows) != 1 {
		return RecoveryKitRow{}, fmt.Errorf("recovery kit not found")
	}
	return rows[0], nil
}

func (c *Client) CreateRecoveryChallenge(ctx context.Context, userID, keyID, tokenHash string, expiresAt time.Time) (RecoveryChallengeRow, error) {
	var rows []RecoveryChallengeRow
	body := map[string]any{"user_id": userID, "key_id": keyID, "token_hash": tokenHash, "status": "verified", "expires_at": expiresAt.UTC().Format(time.RFC3339Nano)}
	err := c.Do(ctx, http.MethodPost, "/rest/v1/account_recovery_challenges", nil, body, "return=representation", &rows)
	if err != nil {
		return RecoveryChallengeRow{}, err
	}
	if len(rows) != 1 {
		return RecoveryChallengeRow{}, fmt.Errorf("recovery challenge was not created")
	}
	return rows[0], nil
}

func (c *Client) BeginRecoveryReset(ctx context.Context, challengeID, tokenHash string) (RecoveryResetClaim, error) {
	var rows []RecoveryResetClaim
	err := c.Do(ctx, http.MethodPost, "/rest/v1/rpc/flashpag_begin_recovery_reset", nil, map[string]string{
		"p_challenge_id": challengeID, "p_token_hash": tokenHash,
	}, "", &rows)
	if err != nil {
		return RecoveryResetClaim{}, err
	}
	if len(rows) != 1 {
		return RecoveryResetClaim{}, fmt.Errorf("recovery challenge is invalid or expired")
	}
	return rows[0], nil
}

func (c *Client) FinalizeRecoveryReset(ctx context.Context, challengeID, userID, keyID string) (bool, error) {
	var out bool
	err := c.Do(ctx, http.MethodPost, "/rest/v1/rpc/flashpag_finalize_recovery_reset", nil, map[string]string{
		"p_challenge_id": challengeID, "p_user_id": userID, "p_key_id": keyID,
	}, "", &out)
	return out, err
}

func (c *Client) AbortRecoveryReset(ctx context.Context, challengeID, userID, keyID string) (bool, error) {
	var out bool
	err := c.Do(ctx, http.MethodPost, "/rest/v1/rpc/flashpag_abort_recovery_reset", nil, map[string]string{
		"p_challenge_id": challengeID, "p_user_id": userID, "p_key_id": keyID,
	}, "", &out)
	return out, err
}

func (c *Client) RecoveryRateLimit(ctx context.Context, subjectHash, ipHash string, subjectLimit, ipLimit int) (bool, error) {
	var out bool
	err := c.Do(ctx, http.MethodPost, "/rest/v1/rpc/flashpag_recovery_rate_limit", nil, map[string]any{
		"p_subject_hash": subjectHash, "p_ip_hash": ipHash, "p_subject_limit": subjectLimit, "p_ip_limit": ipLimit,
	}, "", &out)
	return out, err
}

func (c *Client) AdminResetMFAFactors(ctx context.Context, userID string) error {
	var factors []struct {
		ID string `json:"id"`
	}
	if err := c.adminAuthRequest(ctx, http.MethodGet, "/auth/v1/admin/users/"+url.PathEscape(userID)+"/factors", nil, &factors); err != nil {
		return err
	}
	for _, factor := range factors {
		if strings.TrimSpace(factor.ID) == "" {
			return fmt.Errorf("auth factor has no id")
		}
		if err := c.adminAuthRequest(ctx, http.MethodDelete, "/auth/v1/admin/users/"+url.PathEscape(userID)+"/factors/"+url.PathEscape(factor.ID), nil, nil); err != nil {
			return err
		}
	}
	return nil
}
