package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
)

const sessionTokenBytes = 32

// NewSessionToken returns a high-entropy opaque bearer token for browser sessions.
func NewSessionToken() (string, error) {
	buf := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", errors.New("generate session token")
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashSessionToken returns the only representation that should be persisted server-side.
func HashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
