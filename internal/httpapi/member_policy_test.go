package httpapi

import "testing"

func TestMemberRoleAssignableBy(t *testing.T) {
	tests := []struct {
		name   string
		actor  string
		target string
		want   bool
	}{
		{"owner can assign owner", "owner", "owner", true},
		{"owner can assign admin", "owner", "admin", true},
		{"owner can assign member", "owner", "member", true},
		{"owner can assign viewer", "owner", "viewer", true},
		{"admin cannot assign owner", "admin", "owner", false},
		{"admin cannot assign admin", "admin", "admin", false},
		{"admin can assign member", "admin", "member", true},
		{"admin can assign viewer", "admin", "viewer", true},
		{"member cannot assign", "member", "viewer", false},
		{"viewer cannot assign", "viewer", "member", false},
		{"invalid role rejected", "owner", "root", false},
		{"platform admin can assign owner", "platform_admin", "owner", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := memberRoleAssignableBy(tt.actor, tt.target); got != tt.want {
				t.Fatalf("memberRoleAssignableBy(%q,%q) = %v, want %v", tt.actor, tt.target, got, tt.want)
			}
		})
	}
}

func TestMemberTargetManageableBy(t *testing.T) {
	if memberTargetManageableBy("admin", "admin") {
		t.Fatal("admin must not manage another admin")
	}
	if memberTargetManageableBy("admin", "owner") {
		t.Fatal("admin must not manage an owner")
	}
	if !memberTargetManageableBy("admin", "member") {
		t.Fatal("admin should manage members")
	}
	if !memberTargetManageableBy("owner", "owner") {
		t.Fatal("owner should be allowed to manage owners; last-owner guard is enforced separately")
	}
}

func TestNormalizeMemberRole(t *testing.T) {
	if got := normalizeMemberRole(""); got != "member" {
		t.Fatalf("empty role normalized to %q", got)
	}
	if got := normalizeMemberRole(" Viewer "); got != "viewer" {
		t.Fatalf("viewer normalized to %q", got)
	}
}
