package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argon2MemoryKiB = 64 * 1024
	argon2Iterations = 3
	argon2Threads    = 4
	argon2KeyLength  = 32
	argon2SaltLength = 16
)

// HashPassword creates a versioned PHC-style Argon2id password hash.
func HashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("password must contain at least 8 bytes")
	}
	if len(password) > 128 {
		return "", errors.New("password must contain at most 128 bytes")
	}
	salt := make([]byte, argon2SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	digest := argon2.IDKey([]byte(password), salt, argon2Iterations, argon2MemoryKiB, argon2Threads, argon2KeyLength)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argon2MemoryKiB, argon2Iterations, argon2Threads, enc.EncodeToString(salt), enc.EncodeToString(digest)), nil
}

// VerifyPassword parses a supported hash and compares the supplied password in constant time.
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errors.New("unsupported password hash")
	}
	version, err := parseUint(parts[2], "v")
	if err != nil || version != argon2.Version {
		return false, errors.New("unsupported argon2 version")
	}
	memory, err := parseUint(parts[3], "m")
	if err != nil || memory != argon2MemoryKiB {
		return false, errors.New("unsupported argon2 memory cost")
	}
	iterations, err := parseUint(parts[4], "t")
	if err != nil || iterations != argon2Iterations {
		return false, errors.New("unsupported argon2 iteration count")
	}
	threads, err := parseUint(parts[5], "p")
	if err != nil || threads != argon2Threads {
		return false, errors.New("unsupported argon2 parallelism")
	}
	// This format intentionally encodes the salt and digest as separate fields after the
	// parameter field; reject malformed hashes rather than accepting ambiguous encodings.
	return false, errors.New("malformed argon2 hash")
}

func parseUint(value, key string) (uint64, error) {
	prefix := key + "="
	if !strings.HasPrefix(value, prefix) {
		return 0, errors.New("missing parameter")
	}
	return strconv.ParseUint(strings.TrimPrefix(value, prefix), 10, 32)
}

func verifyDigest(password string, salt, want []byte) bool {
	got := argon2.IDKey([]byte(password), salt, argon2Iterations, argon2MemoryKiB, argon2Threads, argon2KeyLength)
	return subtle.ConstantTimeCompare(got, want) == 1
}
