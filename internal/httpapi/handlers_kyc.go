package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/id"
)

const (
	kycBucket       = "merchant-kyc"
	maxKYCDocSize   = 15 << 20
	maxKYCMultipart = 16 << 20
)

var requiredKYCDocumentTypes = []string{"articles_of_association", "cnpj_card", "representative_id", "address_proof"}

type kycProfile struct {
	MerchantID                string  `json:"merchant_id"`
	Status                    string  `json:"status"`
	LegalName                 *string `json:"legal_name"`
	TradeName                 *string `json:"trade_name"`
	TaxID                     *string `json:"tax_id"`
	IncorporationDate         *string `json:"incorporation_date"`
	CompanyEmail              *string `json:"company_email"`
	CompanyPhone              *string `json:"company_phone"`
	AddressLine1              *string `json:"address_line1"`
	AddressLine2              *string `json:"address_line2"`
	District                  *string `json:"district"`
	City                      *string `json:"city"`
	State                     *string `json:"state"`
	PostalCode                *string `json:"postal_code"`
	Country                   *string `json:"country"`
	RepresentativeName        *string `json:"representative_name"`
	RepresentativeDocument    *string `json:"representative_document"`
	RepresentativeBirthDate   *string `json:"representative_birth_date"`
	RepresentativeRole        *string `json:"representative_role"`
	RepresentativeEmail       *string `json:"representative_email"`
	RepresentativePhone       *string `json:"representative_phone"`
	PublicNote                *string `json:"public_note"`
	CreatedAt                 string  `json:"created_at"`
	UpdatedAt                 string  `json:"updated_at"`
	SubmittedAt               *string `json:"submitted_at"`
	ReviewedAt                *string `json:"reviewed_at"`
	ApprovedAt                *string `json:"approved_at"`
	RejectedAt                *string `json:"rejected_at"`
}

type kycDocument struct {
	ID            string  `json:"id"`
	MerchantID    string  `json:"merchant_id"`
	DocumentType  string  `json:"document_type"`
	OriginalName  string  `json:"original_name"`
	StorageBucket string  `json:"storage_bucket"`
	StoragePath   string  `json:"storage_path"`
	MimeType      string  `json:"mime_type"`
	SizeBytes     int64   `json:"size_bytes"`
	SHA256        string  `json:"sha256"`
	Status        string  `json:"status"`
	AdminFeedback *string `json:"admin_feedback"`
	Version       int     `json:"version"`
	IsCurrent     bool    `json:"is_current"`
	UploadedAt    string  `json:"uploaded_at"`
	ReplacedAt    *string `json:"replaced_at"`
}

type kycProfileInput struct {
	LegalName               string `json:"legal_name"`
	TradeName               string `json:"trade_name"`
	TaxID                   string `json:"tax_id"`
	IncorporationDate       string `json:"incorporation_date"`
	CompanyEmail            string `json:"company_email"`
	CompanyPhone            string `json:"company_phone"`
	AddressLine1            string `json:"address_line1"`
	AddressLine2            string `json:"address_line2"`
	District                string `json:"district"`
	City                    string `json:"city"`
	State                   string `json:"state"`
	PostalCode              string `json:"postal_code"`
	Country                 string `json:"country"`
	RepresentativeName      string `json:"representative_name"`
	RepresentativeDocument  string `json:"representative_document"`
	RepresentativeBirthDate string `json:"representative_birth_date"`
	RepresentativeRole      string `json:"representative_role"`
	RepresentativeEmail     string `json:"representative_email"`
	RepresentativePhone     string `json:"representative_phone"`
}

type adminKYCDecisionInput struct {
	Decision     string `json:"decision"`
	PublicNote   string `json:"public_note"`
	InternalNote string `json:"internal_note"`
}

func (s *Server) consoleKYC(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := s.organizationWithRole(r, "owner", "admin", "platform_admin")
	if !ok {
		writeError(w, http.StatusForbidden, "kyc_forbidden", "only owners and administrators can access KYC data")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant could not be resolved")
		return
	}
	profile, err := s.kycProfileForMerchant(r, merchantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kyc_load_failed", "KYC profile could not be loaded")
		return
	}
	docs, _ := s.kycDocumentsForMerchant(r, merchantID, true)
	events, _ := s.kycPublicEventsForMerchant(r, merchantID)
	writeJSON(w, http.StatusOK, map[string]any{
		"profile":            profile,
		"documents":          docs,
		"events":             events,
		"required_documents": requiredKYCDocumentTypes,
	})
}

func (s *Server) consoleUpdateKYC(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := s.organizationWithRole(r, "owner", "admin", "platform_admin")
	if !ok {
		writeError(w, http.StatusForbidden, "kyc_forbidden", "only owners and administrators can edit KYC data")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant could not be resolved")
		return
	}
	profile, err := s.kycProfileForMerchant(r, merchantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kyc_load_failed", "KYC profile could not be loaded")
		return
	}
	if !kycEditableStatus(profile.Status) {
		writeError(w, http.StatusConflict, "kyc_locked", "KYC data is locked while it is being reviewed or after approval")
		return
	}
	var in kycProfileInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	patch := normalizeKYCProfileInput(in)
	patch["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	q := url.Values{"merchant_id": {"eq." + merchantID}, "select": {"*"}}
	var rows []kycProfile
	if err := s.sb.Do(r.Context(), http.MethodPatch, "/rest/v1/merchant_kyc_profiles", q, patch, "return=representation", &rows); err != nil || len(rows) != 1 {
		writeError(w, http.StatusUnprocessableEntity, "kyc_save_failed", "KYC profile could not be saved")
		return
	}
	writeJSON(w, http.StatusOK, rows[0])
}

func (s *Server) consoleUploadKYCDocument(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := s.organizationWithRole(r, "owner", "admin", "platform_admin")
	if !ok {
		writeError(w, http.StatusForbidden, "kyc_forbidden", "only owners and administrators can upload KYC documents")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant could not be resolved")
		return
	}
	profile, err := s.kycProfileForMerchant(r, merchantID)
	if err != nil || !kycEditableStatus(profile.Status) {
		writeError(w, http.StatusConflict, "kyc_locked", "documents can only be changed before or after a correction request")
		return
	}
	documentType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
	if !validKYCDocumentType(documentType) {
		writeError(w, http.StatusUnprocessableEntity, "document_type_invalid", "unsupported KYC document type")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxKYCMultipart)
	if err := r.ParseMultipartForm(maxKYCMultipart); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "document_too_large", "KYC document must be at most 15 MB")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "document_required", "multipart field 'file' is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxKYCDocSize+1))
	if err != nil || len(data) == 0 {
		writeError(w, http.StatusBadRequest, "document_read_failed", "KYC document could not be read")
		return
	}
	if len(data) > maxKYCDocSize {
		writeError(w, http.StatusRequestEntityTooLarge, "document_too_large", "KYC document must be at most 15 MB")
		return
	}
	mimeType := detectAllowedKYCMIME(data)
	if mimeType == "" {
		writeError(w, http.StatusUnsupportedMediaType, "document_type_unsupported", "only PDF, JPEG and PNG documents are accepted")
		return
	}
	docID, err := id.UUID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "document_id_failed", "could not allocate document id")
		return
	}
	storagePath := merchantID + "/" + docID
	if err := s.sb.StorageUpload(r.Context(), kycBucket, storagePath, mimeType, data); err != nil {
		writeError(w, http.StatusBadGateway, "document_storage_failed", "KYC document could not be stored securely")
		return
	}
	sum := sha256.Sum256(data)
	var saved kycDocument
	err = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/register_merchant_kyc_document", nil, map[string]any{
		"p_id": docID, "p_merchant_id": merchantID, "p_document_type": documentType,
		"p_original_name": safeOriginalFilename(header.Filename), "p_storage_path": storagePath,
		"p_mime_type": mimeType, "p_size_bytes": len(data), "p_sha256": hex.EncodeToString(sum[:]),
		"p_uploaded_by": consoleP(r.Context()).UserID,
	}, "", &saved)
	if err != nil {
		_ = s.sb.StorageDelete(r.Context(), kycBucket, storagePath)
		writeError(w, http.StatusUnprocessableEntity, "document_register_failed", "KYC document metadata could not be registered")
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Server) consoleDownloadKYCDocument(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := s.organizationWithRole(r, "owner", "admin", "platform_admin")
	if !ok {
		writeError(w, http.StatusForbidden, "kyc_forbidden", "KYC document access denied")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant could not be resolved")
		return
	}
	s.serveKYCDocument(w, r, merchantID, strings.TrimSpace(r.PathValue("id")))
}

func (s *Server) consoleSubmitKYC(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := s.organizationWithRole(r, "owner", "admin", "platform_admin")
	if !ok {
		writeError(w, http.StatusForbidden, "kyc_forbidden", "only owners and administrators can submit KYC")
		return
	}
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusNotFound, "merchant_not_found", "merchant could not be resolved")
		return
	}
	profile, err := s.kycProfileForMerchant(r, merchantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kyc_load_failed", "KYC profile could not be loaded")
		return
	}
	docs, err := s.kycDocumentsForMerchant(r, merchantID, true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kyc_documents_failed", "KYC documents could not be loaded")
		return
	}
	if missing := missingKYCRequirements(profile, docs); len(missing) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]any{
			"code": "kyc_incomplete", "message": "complete all required KYC fields and documents before submitting", "missing": missing,
		}})
		return
	}
	var saved kycProfile
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/submit_merchant_kyc", nil, map[string]any{
		"p_merchant_id": merchantID, "p_actor_user_id": consoleP(r.Context()).UserID,
	}, "", &saved); err != nil {
		writeError(w, http.StatusConflict, "kyc_submit_failed", "KYC could not be submitted from its current status")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) adminKYCQueue(w http.ResponseWriter, r *http.Request) {
	var rows []map[string]any
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/platform_kyc_queue", nil, map[string]any{}, "", &rows); err != nil {
		writeError(w, http.StatusInternalServerError, "kyc_queue_failed", "KYC queue could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (s *Server) adminKYCDetail(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	if merchantID == "" {
		writeError(w, http.StatusBadRequest, "merchant_required", "merchant id is required")
		return
	}
	profile, err := s.kycProfileForMerchant(r, merchantID)
	if err != nil {
		writeError(w, http.StatusNotFound, "kyc_not_found", "KYC profile not found")
		return
	}
	docs, _ := s.kycDocumentsForMerchant(r, merchantID, false)
	var merchant []map[string]any
	_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchants", url.Values{"id": {"eq." + merchantID}, "select": {"id,name,status,created_at"}, "limit": {"1"}}, nil, "", &merchant)
	var reviews []map[string]any
	_ = s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/kyc_reviews_with_email", nil, map[string]any{"p_merchant_id": merchantID}, "", &reviews)
	var events []map[string]any
	_ = s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_events", url.Values{"merchant_id": {"eq." + merchantID}, "select": {"id,event_type,from_status,to_status,metadata,created_at"}, "order": {"created_at.desc"}, "limit": {"100"}}, nil, "", &events)
	writeJSON(w, http.StatusOK, map[string]any{"merchant": firstMap(merchant), "profile": profile, "documents": docs, "reviews": reviews, "events": events})
}

func (s *Server) adminStartKYCReview(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	var in struct {
		InternalNote string `json:"internal_note"`
	}
	if err := decodeOptionalJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	var saved kycProfile
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/start_merchant_kyc_review", nil, map[string]any{
		"p_merchant_id": merchantID, "p_reviewer_user_id": consoleP(r.Context()).UserID, "p_internal_note": strings.TrimSpace(in.InternalNote),
	}, "", &saved); err != nil {
		writeError(w, http.StatusConflict, "kyc_review_failed", "KYC cannot enter review from its current status")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) adminDecideKYC(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	var in adminKYCDecisionInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	in.Decision = strings.ToLower(strings.TrimSpace(in.Decision))
	if in.Decision != "approved" && in.Decision != "needs_changes" && in.Decision != "rejected" {
		writeError(w, http.StatusUnprocessableEntity, "decision_invalid", "decision must be approved, needs_changes or rejected")
		return
	}
	if in.Decision != "approved" && strings.TrimSpace(in.PublicNote) == "" {
		writeError(w, http.StatusUnprocessableEntity, "public_note_required", "a merchant-visible observation is required for this decision")
		return
	}
	var saved kycProfile
	if err := s.sb.Do(r.Context(), http.MethodPost, "/rest/v1/rpc/decide_merchant_kyc", nil, map[string]any{
		"p_merchant_id": merchantID, "p_reviewer_user_id": consoleP(r.Context()).UserID,
		"p_decision": in.Decision, "p_public_note": strings.TrimSpace(in.PublicNote), "p_internal_note": strings.TrimSpace(in.InternalNote),
	}, "", &saved); err != nil {
		writeError(w, http.StatusConflict, "kyc_decision_failed", "KYC decision could not be applied from its current status")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) adminDownloadKYCDocument(w http.ResponseWriter, r *http.Request) {
	merchantID := strings.TrimSpace(r.PathValue("merchantID"))
	s.serveKYCDocument(w, r, merchantID, strings.TrimSpace(r.PathValue("id")))
}

func (s *Server) serveKYCDocument(w http.ResponseWriter, r *http.Request, merchantID, documentID string) {
	if merchantID == "" || documentID == "" {
		writeError(w, http.StatusBadRequest, "document_required", "merchant and document ids are required")
		return
	}
	var rows []kycDocument
	q := url.Values{"id": {"eq." + documentID}, "merchant_id": {"eq." + merchantID}, "select": {"*"}, "limit": {"1"}}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_documents", q, nil, "", &rows); err != nil || len(rows) != 1 {
		writeError(w, http.StatusNotFound, "document_not_found", "KYC document not found")
		return
	}
	data, contentType, err := s.sb.StorageDownload(r.Context(), rows[0].StorageBucket, rows[0].StoragePath)
	if err != nil {
		writeError(w, http.StatusBadGateway, "document_download_failed", "KYC document could not be loaded from secure storage")
		return
	}
	if contentType == "" {
		contentType = rows[0].MimeType
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", safeOriginalFilename(rows[0].OriginalName)))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) kycProfileForMerchant(r *http.Request, merchantID string) (kycProfile, error) {
	var rows []kycProfile
	q := url.Values{"merchant_id": {"eq." + merchantID}, "select": {"*"}, "limit": {"1"}}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_profiles", q, nil, "", &rows); err != nil {
		return kycProfile{}, err
	}
	if len(rows) != 1 {
		return kycProfile{}, fmt.Errorf("KYC profile not found")
	}
	return rows[0], nil
}

func (s *Server) kycDocumentsForMerchant(r *http.Request, merchantID string, currentOnly bool) ([]kycDocument, error) {
	q := url.Values{"merchant_id": {"eq." + merchantID}, "select": {"*"}, "order": {"uploaded_at.desc"}, "limit": {"100"}}
	if currentOnly {
		q.Set("is_current", "eq.true")
	}
	var rows []kycDocument
	err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_documents", q, nil, "", &rows)
	return rows, err
}

func (s *Server) kycPublicEventsForMerchant(r *http.Request, merchantID string) ([]map[string]any, error) {
	q := url.Values{"merchant_id": {"eq." + merchantID}, "select": {"id,event_type,from_status,to_status,created_at"}, "order": {"created_at.desc"}, "limit": {"50"}}
	var rows []map[string]any
	err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/merchant_kyc_events", q, nil, "", &rows)
	return rows, err
}

func (s *Server) merchantKYCStatusForOrganization(r *http.Request, orgID string) (string, error) {
	merchantID, err := s.merchantIDForOrganization(r.Context(), orgID)
	if err != nil {
		return "", err
	}
	profile, err := s.kycProfileForMerchant(r, merchantID)
	if err != nil {
		return "", err
	}
	return profile.Status, nil
}

func (s *Server) requireApprovedKYCForProvider(r *http.Request, orgID, providerCode string) error {
	if strings.EqualFold(strings.TrimSpace(providerCode), "mock") {
		return nil
	}
	status, err := s.merchantKYCStatusForOrganization(r, orgID)
	if err != nil {
		return fmt.Errorf("merchant KYC status unavailable")
	}
	if status != "approved" {
		return fmt.Errorf("merchant KYC must be approved before using a real payment provider")
	}
	return nil
}

func kycEditableStatus(status string) bool {
	return status == "draft" || status == "needs_changes" || status == "rejected"
}

func validKYCDocumentType(value string) bool {
	switch value {
	case "articles_of_association", "cnpj_card", "representative_id", "address_proof", "ownership_document", "bank_proof", "other":
		return true
	default:
		return false
	}
}

func detectAllowedKYCMIME(data []byte) string {
	detected := http.DetectContentType(data)
	switch detected {
	case "application/pdf", "image/jpeg", "image/png":
		return detected
	default:
		return ""
	}
}

func safeOriginalFilename(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	name = strings.ReplaceAll(name, "\"", "'")
	if name == "" || name == "." {
		return "documento"
	}
	if len(name) > 180 {
		name = name[:180]
	}
	return name
}

func normalizeKYCProfileInput(in kycProfileInput) map[string]any {
	clean := func(v string) any {
		v = strings.TrimSpace(v)
		if v == "" {
			return nil
		}
		return v
	}
	digits := func(v string) any {
		var b strings.Builder
		for _, r := range v {
			if r >= '0' && r <= '9' {
				b.WriteRune(r)
			}
		}
		if b.Len() == 0 {
			return nil
		}
		return b.String()
	}
	country := strings.ToUpper(strings.TrimSpace(in.Country))
	if country == "" {
		country = "BR"
	}
	return map[string]any{
		"legal_name": clean(in.LegalName), "trade_name": clean(in.TradeName), "tax_id": digits(in.TaxID),
		"incorporation_date": clean(in.IncorporationDate), "company_email": clean(in.CompanyEmail), "company_phone": clean(in.CompanyPhone),
		"address_line1": clean(in.AddressLine1), "address_line2": clean(in.AddressLine2), "district": clean(in.District),
		"city": clean(in.City), "state": clean(strings.ToUpper(in.State)), "postal_code": digits(in.PostalCode), "country": country,
		"representative_name": clean(in.RepresentativeName), "representative_document": digits(in.RepresentativeDocument),
		"representative_birth_date": clean(in.RepresentativeBirthDate), "representative_role": clean(in.RepresentativeRole),
		"representative_email": clean(in.RepresentativeEmail), "representative_phone": clean(in.RepresentativePhone),
	}
}

func missingKYCRequirements(profile kycProfile, docs []kycDocument) []string {
	missing := make([]string, 0)
	required := map[string]*string{
		"legal_name": profile.LegalName, "tax_id": profile.TaxID, "company_email": profile.CompanyEmail, "company_phone": profile.CompanyPhone,
		"address_line1": profile.AddressLine1, "city": profile.City, "state": profile.State, "postal_code": profile.PostalCode,
		"representative_name": profile.RepresentativeName, "representative_document": profile.RepresentativeDocument,
		"representative_birth_date": profile.RepresentativeBirthDate, "representative_role": profile.RepresentativeRole,
		"representative_email": profile.RepresentativeEmail, "representative_phone": profile.RepresentativePhone,
	}
	for name, value := range required {
		if value == nil || strings.TrimSpace(*value) == "" {
			missing = append(missing, name)
		}
	}
	if profile.TaxID != nil && len(onlyDigits(*profile.TaxID)) != 14 {
		missing = append(missing, "tax_id_valid_cnpj")
	}
	if profile.RepresentativeDocument != nil && len(onlyDigits(*profile.RepresentativeDocument)) != 11 {
		missing = append(missing, "representative_document_valid_cpf")
	}
	current := make(map[string]bool)
	for _, doc := range docs {
		if doc.IsCurrent {
			current[doc.DocumentType] = true
		}
	}
	for _, documentType := range requiredKYCDocumentTypes {
		if !current[documentType] {
			missing = append(missing, "document:"+documentType)
		}
	}
	return missing
}

func onlyDigits(value string) string {
	var b strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func decodeOptionalJSON(r *http.Request, out any) error {
	if r.ContentLength == 0 {
		return nil
	}
	return decodeJSON(r, out)
}

func firstMap(rows []map[string]any) map[string]any {
	if len(rows) == 0 {
		return map[string]any{}
	}
	return rows[0]
}
