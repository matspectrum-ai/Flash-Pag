package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestKYCEditableStatus(t *testing.T) {
	for _, status := range []string{"draft", "needs_changes", "rejected"} {
		if !kycEditableStatus(status) {
			t.Fatalf("expected %s to be editable", status)
		}
	}
	for _, status := range []string{"submitted", "under_review", "approved"} {
		if kycEditableStatus(status) {
			t.Fatalf("expected %s to be locked", status)
		}
	}
}

func TestKYCAllowedMIME(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"pdf", []byte("%PDF-1.7\n"), "application/pdf"},
		{"jpeg", []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}, "image/jpeg"},
		{"png", []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, "image/png"},
		{"text", []byte("not a document"), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := detectAllowedKYCMIME(tc.data); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestMissingKYCRequirements(t *testing.T) {
	value := func(v string) *string { return &v }
	profile := kycProfile{
		LegalName: value("ACME LTDA"), TaxID: value("12345678000195"), CompanyEmail: value("financeiro@acme.test"), CompanyPhone: value("11999999999"),
		AddressLine1: value("Rua Um, 10"), City: value("São Paulo"), State: value("SP"), PostalCode: value("01001000"),
		RepresentativeName: value("Ana"), RepresentativeDocument: value("12345678901"), RepresentativeBirthDate: value("1990-01-01"),
		RepresentativeRole: value("Sócia"), RepresentativeEmail: value("ana@acme.test"), RepresentativePhone: value("11988888888"),
	}
	docs := make([]kycDocument, 0, len(requiredKYCDocumentTypes))
	for _, typ := range requiredKYCDocumentTypes {
		docs = append(docs, kycDocument{DocumentType: typ, IsCurrent: true})
	}
	if missing := missingKYCRequirements(profile, docs); len(missing) != 0 {
		t.Fatalf("expected complete KYC, missing=%v", missing)
	}
	docs = docs[:len(docs)-1]
	if missing := missingKYCRequirements(profile, docs); len(missing) != 1 || missing[0] != "document:address_proof" {
		t.Fatalf("expected address proof missing, got=%v", missing)
	}
}

func TestMerchantSlug(t *testing.T) {
	if got := merchantSlug("Minha Empresa LTDA"); got != "minha-empresa-ltda" {
		t.Fatalf("unexpected slug %q", got)
	}
	if got := merchantSlug("***"); got != "merchant" {
		t.Fatalf("unexpected fallback slug %q", got)
	}
}

func TestProviderCodeFromRequestPreservesBody(t *testing.T) {
	payload := `{"provider":"pixhub","amount_minor":500}`
	req := httptest.NewRequest(http.MethodPost, "/v1/transfers", bytes.NewBufferString(payload))
	if got := providerCodeFromRequest(req); got != "pixhub" {
		t.Fatalf("got provider %q want pixhub", got)
	}
	replayed, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(replayed) != payload {
		t.Fatalf("request body changed: %q", string(replayed))
	}
}

func TestProviderCodeFromRequestDefaultsToMock(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/transfers", bytes.NewBufferString(`{"amount_minor":500}`))
	if got := providerCodeFromRequest(req); got != "mock" {
		t.Fatalf("got provider %q want mock", got)
	}
}

func TestPreviewReadOnlyBlocksRegistrationAndKYCMutation(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := previewReadOnly(true, next)
	for _, path := range []string{"/console/register", "/console/api/kyc", "/console/api/kyc/submit"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{}"))
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusLocked {
			t.Fatalf("%s: got %d want %d", path, rr.Code, http.StatusLocked)
		}
	}
}
