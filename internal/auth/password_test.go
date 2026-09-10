package auth

import "testing"

func TestHashPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if hash == "" || hash == "correct horse battery staple" {
		t.Fatal("password hash was not generated")
	}
	ok, err := VerifyPassword("correct horse battery staple", hash)
	if err != nil || !ok {
		t.Fatalf("VerifyPassword(valid) = %v, %v", ok, err)
	}
	ok, err = VerifyPassword("wrong password", hash)
	if err != nil || ok {
		t.Fatalf("VerifyPassword(invalid) = %v, %v", ok, err)
	}
}

func TestHashPasswordRejectsInvalidLength(t *testing.T) {
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("expected short password to fail")
	}
	long := make([]byte, 129)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := HashPassword(string(long)); err == nil {
		t.Fatal("expected long password to fail")
	}
}

func TestVerifyPasswordRejectsMalformedHash(t *testing.T) {
	cases := []string{"", "$argon2id$v=19$m=65536,t=3,p=4$bad$bad", "$bcrypt$10$bad"}
	for _, hash := range cases {
		if _, err := VerifyPassword("password123", hash); err == nil {
			t.Fatalf("expected malformed hash %q to fail", hash)
		}
	}
}
