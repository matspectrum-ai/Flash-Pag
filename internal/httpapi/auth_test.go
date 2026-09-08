package httpapi

import "testing"

func TestRoleAllowed(t *testing.T) {
	tests := []struct {
		role    string
		allowed []string
		want    bool
	}{
		{"owner", []string{"owner", "admin"}, true},
		{"admin", []string{"owner", "admin"}, true},
		{"member", []string{"owner", "admin"}, false},
		{"viewer", []string{"owner", "admin", "member"}, false},
		{"platform_admin", []string{"owner"}, true},
	}
	for _, tt := range tests {
		if got := roleAllowed(tt.role, tt.allowed...); got != tt.want {
			t.Fatalf("roleAllowed(%q, %v)=%v want %v", tt.role, tt.allowed, got, tt.want)
		}
	}
}
