package supabase

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func (c *Client) DeleteAuthUser(ctx context.Context, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/auth/v1/admin/users/"+url.PathEscape(userID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.secretKey)
	if strings.HasPrefix(c.secretKey, "eyJ") {
		req.Header.Set("Authorization", "Bearer "+c.secretKey)
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
	return nil
}
