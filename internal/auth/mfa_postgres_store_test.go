package auth

import "testing"

// PostgreSQL-backed MFA behavior requires integration coverage against a real PostgreSQL
// instance because replay protection depends on row-level UPDATE atomicity. The unit
// service tests intentionally remain database-independent.
func TestPostgresMFAStoreRequiresDatabaseIntegration(t *testing.T) {
	t.Skip("requires disposable PostgreSQL integration environment")
}
