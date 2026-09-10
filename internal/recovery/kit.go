package recovery

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	version       byte = 1
	secretSize         = 32
	keyIDSize          = 16
	accountIDSize      = 36
	headerSize         = 8 + 1 + 3 + accountIDSize + keyIDSize + secretSize
	tagSize            = 32
	fileSize           = headerSize + tagSize
)

var magic = [8]byte{'F', 'L', 'A', 'S', 'H', 'P', 'A', 'G'}

var (
	ErrInvalidKit  = errors.New("invalid recovery kit")
	ErrUnsupported = errors.New("unsupported recovery kit version")
	ErrInvalidKey  = errors.New("invalid recovery verification key")
)

type Kit struct {
	AccountID string
	KeyID     string
	Secret    [secretSize]byte
}

// Generate creates a versioned bearer recovery credential. The secret is 256 bits
// from crypto/rand; the server never stores it, only a keyed verifier derived from it.
func Generate(accountID string, serverKey []byte) (Kit, []byte, error) {
	if !validAccountID(accountID) || len(serverKey) < 32 {
		return Kit{}, nil, ErrInvalidKey
	}
	var kit Kit
	kit.AccountID = strings.ToLower(accountID)
	rawKeyID := make([]byte, keyIDSize)
	if _, err := rand.Read(rawKeyID); err != nil {
		return Kit{}, nil, fmt.Errorf("generate recovery key id: %w", err)
	}
	kit.KeyID = hex.EncodeToString(rawKeyID)
	if _, err := rand.Read(kit.Secret[:]); err != nil {
		return Kit{}, nil, fmt.Errorf("generate recovery secret: %w", err)
	}
	data, err := kit.Encode(serverKey)
	if err != nil {
		return Kit{}, nil, err
	}
	return kit, data, nil
}

func (k Kit) Encode(serverKey []byte) ([]byte, error) {
	if len(serverKey) < 32 || !validAccountID(k.AccountID) || len(k.KeyID) != keyIDSize*2 {
		return nil, ErrInvalidKit
	}
	keyID, err := hex.DecodeString(k.KeyID)
	if err != nil || len(keyID) != keyIDSize {
		return nil, ErrInvalidKit
	}
	buf := make([]byte, fileSize)
	copy(buf[:8], magic[:])
	buf[8] = version
	copy(buf[12:12+accountIDSize], []byte(k.AccountID))
	copy(buf[12+accountIDSize:12+accountIDSize+keyIDSize], keyID)
	copy(buf[12+accountIDSize+keyIDSize:headerSize], k.Secret[:])
	tag := mac(serverKey, buf[:headerSize])
	copy(buf[headerSize:], tag)
	return buf, nil
}

func Parse(data, serverKey []byte) (Kit, error) {
	if len(serverKey) < 32 || len(data) != fileSize {
		return Kit{}, ErrInvalidKit
	}
	if string(data[:8]) != string(magic[:]) {
		return Kit{}, ErrInvalidKit
	}
	if data[8] != version {
		return Kit{}, ErrUnsupported
	}
	if data[9] != 0 || data[10] != 0 || data[11] != 0 {
		return Kit{}, ErrInvalidKit
	}
	accountID := string(data[12 : 12+accountIDSize])
	if !validAccountID(accountID) {
		return Kit{}, ErrInvalidKit
	}
	keyID := hex.EncodeToString(data[12+accountIDSize : 12+accountIDSize+keyIDSize])
	var secret [secretSize]byte
	copy(secret[:], data[12+accountIDSize+keyIDSize:headerSize])
	want := mac(serverKey, data[:headerSize])
	if !hmac.Equal(want, data[headerSize:]) {
		return Kit{}, ErrInvalidKit
	}
	return Kit{AccountID: accountID, KeyID: keyID, Secret: secret}, nil
}

func Verifier(serverKey []byte, secret []byte) (string, error) {
	if len(serverKey) < 32 || len(secret) != secretSize {
		return "", ErrInvalidKey
	}
	macValue := hmac.New(sha256.New, serverKey)
	macValue.Write([]byte("flashpag-recovery-secret-v1:"))
	macValue.Write(secret)
	return hex.EncodeToString(macValue.Sum(nil)), nil
}

func mac(serverKey, data []byte) []byte {
	h := hmac.New(sha256.New, serverKey)
	h.Write([]byte("flashpag-recovery-file-v1:"))
	h.Write(data)
	return h.Sum(nil)
}

func validAccountID(value string) bool {
	if len(value) != accountIDSize {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f') && !(c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
