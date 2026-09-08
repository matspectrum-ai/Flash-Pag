package supabase

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Count returns an exact PostgREST row count without materializing the result set.
// It uses Range 0-0 so the response body stays bounded while Content-Range carries
// the exact total requested through Prefer: count=exact.
func (c *Client) Count(ctx context.Context, path string, q url.Values) (int64, error) {
	u := c.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("apikey", c.secretKey)
	if strings.HasPrefix(c.secretKey, "eyJ") {
		req.Header.Set("Authorization", "Bearer "+c.secretKey)
	}
	req.Header.Set("Prefer", "count=exact")
	req.Header.Set("Range", "0-0")

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, &Error{Status: resp.StatusCode, Body: string(raw)}
	}

	contentRange := strings.TrimSpace(resp.Header.Get("Content-Range"))
	slash := strings.LastIndex(contentRange, "/")
	if slash < 0 || slash == len(contentRange)-1 || contentRange[slash+1:] == "*" {
		return 0, fmt.Errorf("postgrest count missing from Content-Range %q", contentRange)
	}
	count, err := strconv.ParseInt(contentRange[slash+1:], 10, 64)
	if err != nil || count < 0 {
		return 0, fmt.Errorf("invalid postgrest count in Content-Range %q", contentRange)
	}
	return count, nil
}
