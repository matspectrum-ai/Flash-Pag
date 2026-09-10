package auth

import (
	"testing"
	"time"
)

func TestSessionHasRecentMFA(t *testing.T) {
	now := time.Date(2026, 9, 10, 19, 0, 0, 0, time.UTC)
	s := NewService(newMemoryStore())
	s.now = func() time.Time { return now }

	verified := now.Add(-9 * time.Minute)
	if s.SessionHasRecentMFA(Session{AAL: "aal1", MFAVerifiedAt: &verified}) {
		t.Fatal("aal1 session incorrectly accepted as recent MFA")
	}
	if !s.SessionHasRecentMFA(Session{AAL: "aal2", MFAVerifiedAt: &verified}) {
		t.Fatal("recent aal2 session rejected")
	}

	stale := now.Add(-10*time.Minute - time.Second)
	if s.SessionHasRecentMFA(Session{AAL: "aal2", MFAVerifiedAt: &stale}) {
		t.Fatal("stale aal2 session accepted")
	}
	future := now.Add(time.Second)
	if s.SessionHasRecentMFA(Session{AAL: "aal2", MFAVerifiedAt: &future}) {
		t.Fatal("future MFA timestamp accepted")
	}
	if s.SessionHasRecentMFA(Session{AAL: "aal2"}) {
		t.Fatal("aal2 session without verification timestamp accepted")
	}
}
