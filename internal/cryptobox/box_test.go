package cryptobox

import "testing"

func TestRoundTrip(t *testing.T) {
	b, err := New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := b.Seal([]byte(`{"token":"secret"}`))
	if err != nil {
		t.Fatal(err)
	}
	dec, err := b.Open(enc)
	if err != nil {
		t.Fatal(err)
	}
	if string(dec) != `{"token":"secret"}` {
		t.Fatalf("unexpected %s", dec)
	}
}
