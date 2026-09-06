package httpapi

import (
	"errors"
	"net/http"

	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
)

// consoleReconcileTransaction performs a read-only provider lookup and then applies
// the provider's authoritative status to the local ledger. It never creates a new
// payment identity or a second outbound transfer.
func (s *Server) consoleReconcileTransaction(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}

	tx, err := s.fetchTransaction(r.Context(), orgID, r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "transaction_not_found", "transaction not found")
		return
	}
	if tx.Status == "succeeded" || tx.Status == "failed" {
		writeJSON(w, 200, tx)
		return
	}
	if tx.ProviderConnectionID == nil || *tx.ProviderConnectionID == "" || tx.ProviderExternalID == nil || *tx.ProviderExternalID == "" {
		writeError(w, 422, "reconciliation_unavailable", "transaction has no provider connection or external id")
		return
	}

	impl, exists := s.providers.Get(tx.ProviderCode)
	if !exists {
		writeError(w, 422, "provider_not_installed", "provider adapter is not installed")
		return
	}
	reconciler, exists := impl.(provider.Reconciler)
	if !exists {
		writeError(w, 422, "reconciliation_unsupported", "provider does not support read-only reconciliation")
		return
	}
	conn, err := s.providerConnection(r.Context(), orgID, tx.ProviderCode, *tx.ProviderConnectionID)
	if err != nil {
		writeError(w, 422, "connection_load_failed", err.Error())
		return
	}
	result, err := reconciler.Reconcile(r.Context(), conn, tx.Kind, *tx.ProviderExternalID)
	if err != nil {
		writeError(w, 502, "provider_reconciliation_failed", err.Error())
		return
	}
	if result.ExternalID != "" && result.ExternalID != *tx.ProviderExternalID {
		writeError(w, 409, "provider_identity_conflict", "provider returned a different transaction identity")
		return
	}
	if result.Status != "pending" && result.Status != "succeeded" && result.Status != "failed" {
		writeError(w, 502, "provider_status_invalid", "provider returned an unsupported reconciliation status")
		return
	}

	if len(result.Raw) > 0 {
		if err := s.patchTransaction(r.Context(), tx.ID, map[string]any{"provider_payload": result.Raw}); err != nil {
			writeError(w, 500, "provider_payload_update_failed", err.Error())
			return
		}
	}

	previousStatus := tx.Status
	if result.Status == "pending" {
		// Once the PSP confirms that the operation exists and is still pending, a local
		// ambiguous state can safely become pending. Outbound funds remain reserved.
		if tx.Status == "ambiguous" {
			if err := s.patchTransaction(r.Context(), tx.ID, map[string]any{
				"status":          "pending",
				"failure_code":    nil,
				"failure_message": nil,
			}); err != nil {
				writeError(w, 500, "reconciliation_update_failed", err.Error())
				return
			}
		}
	} else {
		if err := s.applyProviderStatus(r.Context(), tx, result.Status, "provider_reconciled", "provider status resolved by read-only reconciliation"); err != nil {
			writeError(w, 409, "illegal_transition", err.Error())
			return
		}
	}

	fresh, err := s.fetchTransaction(r.Context(), orgID, tx.ID)
	if err != nil {
		writeError(w, 500, "transaction_reload_failed", err.Error())
		return
	}
	if fresh.Status != previousStatus {
		s.enqueueTransactionWebhook(r.Context(), fresh)
	}
	if fresh.Status == "ambiguous" {
		writeError(w, 409, "reconciliation_unresolved", errors.New("provider status remains ambiguous").Error())
		return
	}
	writeJSON(w, 200, fresh)
}
