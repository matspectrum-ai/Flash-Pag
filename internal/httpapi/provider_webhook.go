package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"
)

func (s *Server) providerWebhook(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("provider")
	connectionID := r.PathValue("connectionID")
	impl, ok := s.providers.Get(code)
	if !ok {
		writeError(w, 404, "provider_not_installed", "provider adapter is not installed")
		return
	}
	q := url.Values{"id": {"eq." + connectionID}, "provider_code": {"eq." + code}, "status": {"eq.active"}, "select": {"id,organization_id,provider_code,label,credentials_ciphertext,config,status"}, "limit": {"1"}}
	var rows []providerConnectionRow
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/provider_connections", q, nil, "", &rows); err != nil || len(rows) != 1 {
		writeError(w, 404, "connection_not_found", "active provider connection not found")
		return
	}
	row := rows[0]
	conn, err := s.providerConnection(r.Context(), row.OrganizationID, code, row.ID)
	if err != nil {
		writeError(w, 500, "connection_error", err.Error())
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, 400, "invalid_body", err.Error())
		return
	}
	headers := map[string][]string(r.Header)
	if token := r.URL.Query().Get("token"); token != "" {
		headers["X-FlashPag-Webhook-Token"] = []string{token}
	}
	evt, err := impl.VerifyWebhook(r.Context(), conn, headers, body)
	if err != nil {
		writeError(w, 401, "invalid_webhook", err.Error())
		return
	}
	if evt.Status != "pending" && evt.Status != "succeeded" && evt.Status != "failed" {
		writeError(w, 422, "invalid_event_status", "unsupported provider event status")
		return
	}
	// Persist provider evidence before trusting it to mutate financial state. A redelivery
	// that was already processed is acknowledged without producing another client event.
	payload := evt.Raw
	if len(payload) == 0 {
		payload = json.RawMessage(body)
	}
	type providerEventRow struct {
		ID          string  `json:"id"`
		ProcessedAt *string `json:"processed_at"`
	}
	var evidence []providerEventRow
	err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/provider_events", nil, map[string]any{"provider_connection_id": connectionID, "provider_event_id": evt.EventID, "payload": payload}, "resolution=ignore-duplicates,return=representation", &evidence)
	if err != nil {
		writeError(w, 500, "provider_evidence_persist_failed", err.Error())
		return
	}
	if len(evidence) == 0 {
		q := url.Values{"provider_connection_id": {"eq." + connectionID}, "provider_event_id": {"eq." + evt.EventID}, "select": {"id,processed_at"}, "limit": {"1"}}
		if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/provider_events", q, nil, "", &evidence); err != nil || len(evidence) != 1 {
			writeError(w, 500, "provider_evidence_lookup_failed", "provider event evidence could not be loaded")
			return
		}
		if evidence[0].ProcessedAt != nil {
			writeJSON(w, 200, map[string]any{"received": true, "duplicate": true})
			return
		}
	}
	evidenceID := evidence[0].ID
	tq := url.Values{"provider_connection_id": {"eq." + connectionID}, "provider_external_id": {"eq." + evt.ExternalID}, "select": {"id,organization_id,account_id,customer_id,provider_connection_id,provider_code,provider_external_id,kind,direction,status,amount_minor,currency,description,pix_key,qr_code,failure_code,failure_message,created_at,updated_at"}, "limit": {"1"}}
	var txs []transaction
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/transactions", tq, nil, "", &txs); err != nil || len(txs) != 1 {
		writeError(w, 404, "transaction_not_found", "provider external id is unknown")
		return
	}
	tx := txs[0]
	if evt.Kind != "" && evt.Kind != tx.Kind {
		writeError(w, 409, "event_conflict", "provider event kind conflicts with local transaction")
		return
	}
	if evt.AmountMinor > 0 && evt.AmountMinor != tx.AmountMinor {
		writeError(w, 409, "event_conflict", "provider event amount conflicts with local transaction")
		return
	}
	if evt.Status != "pending" {
		if err := s.applyProviderStatus(r.Context(), tx, evt.Status, "provider_webhook", "provider reported failure"); err != nil {
			writeError(w, 409, "illegal_transition", err.Error())
			return
		}
	}
	tx, _ = s.fetchTransaction(r.Context(), tx.OrganizationID, tx.ID)
	s.enqueueTransactionWebhook(r.Context(), tx)
	if err := s.sb.Do(r.Context(), http.MethodPatch, "/rest/v1/provider_events", url.Values{"id": {"eq." + evidenceID}}, map[string]any{"processed_at": time.Now().UTC().Format(time.RFC3339Nano)}, "", nil); err != nil {
		writeError(w, 500, "provider_evidence_finalize_failed", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"received": true})
}
