package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

type withdrawalDestinationInput struct {
	Label          string `json:"label"`
	PixKeyType     string `json:"pix_key_type"`
	PixKey         string `json:"pix_key"`
	BankName       string `json:"bank_name"`
	Branch         string `json:"branch"`
	AccountNumber  string `json:"account_number"`
	AccountType    string `json:"account_type"`
	HolderName     string `json:"holder_name"`
	HolderDocument string `json:"holder_document"`
}

func maskWithdrawalKey(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 8 {
		return "••••" + key
	}
	return key[:4] + "••••" + key[len(key)-4:]
}

func (s *Server) consoleWithdrawalDestinations(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, http.StatusForbidden, "organization_forbidden", "organization access denied")
		return
	}
	q := url.Values{"organization_id": {"eq." + orgID}, "status": {"eq.active"}, "select": {"id,label,pix_key_type,pix_key_masked,bank_name,branch_last4,account_last4,account_type,is_default,status,created_at,updated_at"}, "order": {"created_at.desc"}}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/withdrawal_destinations", q, nil, "", &rows); err != nil {
		writeError(w, 500, "withdrawal_destinations_load_failed", "destinations could not be loaded")
		return
	}
	writeJSON(w, 200, map[string]any{"data": rows})
}

func (s *Server) consoleCreateWithdrawalDestination(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	var in withdrawalDestinationInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "invalid_json", err.Error())
		return
	}
	in.Label = strings.TrimSpace(in.Label)
	in.PixKey = strings.TrimSpace(in.PixKey)
	in.BankName = strings.TrimSpace(in.BankName)
	in.Branch = strings.TrimSpace(in.Branch)
	in.AccountNumber = strings.TrimSpace(in.AccountNumber)
	in.HolderName = strings.TrimSpace(in.HolderName)
	in.HolderDocument = strings.TrimSpace(in.HolderDocument)
	in.PixKeyType = strings.ToLower(strings.TrimSpace(in.PixKeyType))
	in.AccountType = strings.ToLower(strings.TrimSpace(in.AccountType))
	if in.Label == "" || in.PixKey == "" || in.BankName == "" || in.AccountNumber == "" || in.AccountType == "" {
		writeError(w, 422, "destination_fields_required", "label, pix_key, bank_name, account_number and account_type are required")
		return
	}
	if in.AccountType != "checking" && in.AccountType != "savings" && in.AccountType != "payment" {
		writeError(w, 422, "account_type_invalid", "account_type must be checking, savings or payment")
		return
	}
	if in.PixKeyType == "" {
		in.PixKeyType = "other"
	}
	if in.PixKeyType != "cpf" && in.PixKeyType != "cnpj" && in.PixKeyType != "email" && in.PixKeyType != "phone" && in.PixKeyType != "evp" && in.PixKeyType != "other" {
		writeError(w, 422, "pix_key_type_invalid", "unsupported Pix key type")
		return
	}
	if s.box == nil {
		writeError(w, 500, "encryption_unavailable", "secure destination storage is not configured")
		return
	}
	details, err := json.Marshal(in)
	if err != nil {
		writeError(w, 500, "destination_encode_failed", "destination could not be encoded")
		return
	}
	ciphertext, err := s.box.Seal(details)
	if err != nil {
		writeError(w, 500, "destination_encrypt_failed", "destination could not be encrypted")
		return
	}
	body := map[string]any{"organization_id": orgID, "label": in.Label, "pix_key_type": in.PixKeyType, "pix_key_masked": maskWithdrawalKey(in.PixKey), "bank_name": in.BankName, "branch_last4": last4(in.Branch), "account_last4": last4(in.AccountNumber), "account_type": in.AccountType, "details_ciphertext": ciphertext, "is_default": true, "status": "active"}
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/withdrawal_destinations", nil, body, "return=representation", &rows); err != nil || len(rows) != 1 {
		writeError(w, 422, "destination_create_failed", "withdrawal destination could not be saved")
		return
	}
	_ = s.recordSecurityEvent(r.Context(), consoleP(r.Context()).UserID, orgID, "withdrawal.destination.create", "succeeded")
	writeJSON(w, 201, rows[0])
}

func (s *Server) consoleDeleteWithdrawalDestination(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, 400, "destination_required", "destination id is required")
		return
	}
	q := url.Values{"organization_id": {"eq." + orgID}, "id": {"eq." + id}}
	if err := s.sb.Do(r.Context(), http.MethodPatch, "/rest/v1/withdrawal_destinations", q, map[string]any{"status": "disabled", "is_default": false}, "", nil); err != nil {
		writeError(w, 422, "destination_disable_failed", "withdrawal destination could not be disabled")
		return
	}
	_ = s.recordSecurityEvent(r.Context(), consoleP(r.Context()).UserID, orgID, "withdrawal.destination.disable", "succeeded")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) withdrawalPixKey(r *http.Request, orgID, destinationID string) (string, error) {
	q := url.Values{"organization_id": {"eq." + orgID}, "id": {"eq." + destinationID}, "status": {"eq.active"}, "select": {"details_ciphertext"}, "limit": {"1"}}
	var rows []struct {
		DetailsCiphertext string `json:"details_ciphertext"`
	}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/withdrawal_destinations", q, nil, "", &rows); err != nil || len(rows) != 1 {
		return "", errors.New("withdrawal destination not found")
	}
	if s.box == nil {
		return "", errors.New("secure destination storage unavailable")
	}
	raw, err := s.box.Open(rows[0].DetailsCiphertext)
	if err != nil {
		return "", errors.New("withdrawal destination could not be decrypted")
	}
	var in withdrawalDestinationInput
	if err := json.Unmarshal(raw, &in); err != nil || strings.TrimSpace(in.PixKey) == "" {
		return "", errors.New("withdrawal destination is invalid")
	}
	return strings.TrimSpace(in.PixKey), nil
}

func last4(v string) string {
	v = strings.TrimSpace(v)
	if len(v) <= 4 {
		return v
	}
	return v[len(v)-4:]
}
