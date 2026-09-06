package webhook

import "testing"

func TestSignature(t *testing.T) {
	s := Signature("secret", 123, []byte("{}"))
	if !Verify("secret", 123, []byte("{}"), s) {
		t.Fatal("signature should verify")
	}
	if Verify("bad", 123, []byte("{}"), s) {
		t.Fatal("bad secret verified")
	}
}
