from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "internal/provider/pixhub/pixhub.go",
    '\t"net/http"\n',
    '\t"net/http"\n\t"net/url"\n',
)

marker = "func (p *Provider) CreateCharge(ctx context.Context, conn provider.Connection, in provider.ChargeRequest) (provider.ChargeResult, error) {"
reconcile = r'''func (p *Provider) Reconcile(ctx context.Context, conn provider.Connection, kind, externalID string) (provider.ReconcileResult, error) {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return provider.ReconcileResult{}, finalf("Pixhub reconciliation requires provider external id")
	}
	var path string
	switch kind {
	case "pix_in":
		path = "/api/v1/pix/in/qrcode/" + url.PathEscape(externalID)
	case "transfer", "withdrawal":
		path = "/api/v1/pix/out/pixkey/" + url.PathEscape(externalID)
	default:
		return provider.ReconcileResult{}, finalf("Pixhub does not reconcile transaction kind %q", kind)
	}
	statusCode, raw, err := p.request(ctx, conn, http.MethodGet, path, nil, "")
	if err != nil {
		return provider.ReconcileResult{}, err
	}
	if statusCode < 200 || statusCode >= 300 {
		return provider.ReconcileResult{}, classifyHTTP(statusCode, raw)
	}
	var out struct {
		Success bool `json:"success"`
		Data    struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return provider.ReconcileResult{}, fmt.Errorf("pixhub decode reconciliation response: %w", err)
	}
	if !out.Success || out.Data.ID == "" {
		return provider.ReconcileResult{}, errors.New("pixhub returned an incomplete reconciliation response")
	}
	if out.Data.ID != externalID {
		return provider.ReconcileResult{}, errors.New("pixhub reconciliation returned a different external id")
	}
	status := transferStatus(out.Data.Status)
	if kind == "pix_in" {
		status = chargeStatus(out.Data.Status)
	}
	return provider.ReconcileResult{ExternalID: out.Data.ID, Status: status, Raw: append(json.RawMessage(nil), raw...)}, nil
}

''' + marker
replace_once("internal/provider/pixhub/pixhub.go", marker, reconcile)

p = Path("internal/provider/pixhub/pixhub_test.go")
text = p.read_text()
text += r'''

func TestReconcileCharge(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth":
			_, _ = w.Write([]byte(`{"success":true,"token":"jwt-test","expiresIn":60000}`))
		case "/api/v1/pix/in/qrcode/trx_123":
			if r.Method != http.MethodGet {
				t.Fatalf("method = %s", r.Method)
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"trx_123","status":"paid"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	p := NewWithClient(server.URL, server.Client())
	result, err := p.Reconcile(context.Background(), testConn(t, nil), "pix_in", "trx_123")
	if err != nil {
		t.Fatal(err)
	}
	if result.ExternalID != "trx_123" || result.Status != "succeeded" {
		t.Fatalf("result = %#v", result)
	}
}

func TestReconcileOutbound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth":
			_, _ = w.Write([]byte(`{"success":true,"token":"jwt-test","expiresIn":60000}`))
		case "/api/v1/pix/out/pixkey/transfer_123":
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"transfer_123","status":"banking_processing"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	p := NewWithClient(server.URL, server.Client())
	result, err := p.Reconcile(context.Background(), testConn(t, nil), "withdrawal", "transfer_123")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "pending" {
		t.Fatalf("result = %#v", result)
	}
}
'''
p.write_text(text)

p = Path("internal/ui/app.js")
text = p.read_text()
start = text.index("async function transactions(){")
end = text.index("async function accounts(){", start)
new_transactions = r'''async function transactions(){const d=await api('/console/api/transactions');setContent(panel('Transações',table(d.data,[{label:'Data',render:r=>date(r.created_at)},{label:'ID',render:r=>{const x=node('span',r.id,'mono');return x}},{label:'Tipo',key:'kind'},{label:'Status',render:r=>badge(r.status)},{label:'Valor',render:r=>money(r.amount_minor)},{label:'Provider',key:'provider_code'},{label:'Ação',render:r=>{if(r.provider_code!=='pixhub'||!['pending','ambiguous'].includes(r.status))return '—';const b=node('button','Reconciliar','primary');b.type='button';b.onclick=async()=>{b.disabled=true;try{const tx=await api(`/console/api/transactions/${r.id}/reconcile`,{method:'POST'});flash(`Reconciliação: ${tx.status}`);transactions()}catch(err){flash(err.message,true)}finally{b.disabled=false}};return b}}])))}
'''
p.write_text(text[:start] + new_transactions + text[end:])
