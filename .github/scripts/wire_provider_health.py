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
    '\t"net/http"\n\t"strconv"\n',
)

replace_once(
    "internal/provider/pixhub/pixhub.go",
    'func (p *Provider) Code() string { return "pixhub" }\n',
    '''func (p *Provider) Code() string { return "pixhub" }

func (p *Provider) CheckConnection(ctx context.Context, conn provider.Connection) (provider.ConnectionStatus, error) {
	status, raw, err := p.request(ctx, conn, http.MethodGet, "/api/v1/balance", nil, "")
	if err != nil {
		return provider.ConnectionStatus{}, err
	}
	if status < 200 || status >= 300 {
		return provider.ConnectionStatus{}, classifyHTTP(status, raw)
	}
	var out struct {
		Success bool `json:"success"`
		Data    struct {
			Pix        struct{ Balance string `json:"balance"` } `json:"pix"`
			PixBlocked struct{ Balance string `json:"balance"` } `json:"pixBlocked"`
			Reserve    struct{ Balance string `json:"balance"` } `json:"reserve"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub decode balance response: %w", err)
	}
	if !out.Success {
		return provider.ConnectionStatus{}, errors.New("pixhub balance response was unsuccessful")
	}
	available, err := decimalBRLToMinor(out.Data.Pix.Balance)
	if err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub available balance: %w", err)
	}
	blocked, err := decimalBRLToMinor(out.Data.PixBlocked.Balance)
	if err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub blocked balance: %w", err)
	}
	reserve, err := decimalBRLToMinor(out.Data.Reserve.Balance)
	if err != nil {
		return provider.ConnectionStatus{}, fmt.Errorf("pixhub reserve balance: %w", err)
	}
	return provider.ConnectionStatus{
		Provider: "pixhub", Healthy: true, Currency: "BRL",
		AvailableMinor: available, BlockedMinor: blocked, ReserveMinor: reserve,
	}, nil
}
''',
)

replace_once(
    "internal/provider/pixhub/pixhub.go",
    "func documentType(document string) string {",
    '''func decimalBRLToMinor(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("empty decimal amount")
	}
	negative := strings.HasPrefix(value, "-")
	if negative {
		value = strings.TrimPrefix(value, "-")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, fmt.Errorf("invalid decimal amount %q", value)
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid decimal amount %q", value)
	}
	fraction := "00"
	if len(parts) == 2 {
		switch len(parts[1]) {
		case 1:
			fraction = parts[1] + "0"
		case 2:
			fraction = parts[1]
		default:
			return 0, fmt.Errorf("invalid decimal amount %q", value)
		}
	}
	cents, err := strconv.ParseInt(fraction, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid decimal amount %q", value)
	}
	if whole > (int64(^uint64(0)>>1)-cents)/100 {
		return 0, errors.New("decimal amount overflows int64")
	}
	minor := whole*100 + cents
	if negative {
		minor = -minor
	}
	return minor, nil
}

func documentType(document string) string {''',
)

p = Path("internal/provider/pixhub/pixhub_test.go")
text = p.read_text()
text += r'''

func TestCheckConnection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth":
			_, _ = w.Write([]byte(`{"success":true,"token":"jwt-test","expiresIn":60000}`))
		case "/api/v1/balance":
			if r.Method != http.MethodGet {
				t.Fatalf("method = %s", r.Method)
			}
			if r.Header.Get("Authorization") != "Bearer jwt-test" {
				t.Fatal("missing bearer token")
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"pix":{"balance":"1250.00"},"pixBlocked":{"balance":"0.25"},"reserve":{"balance":"300.10"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	p := NewWithClient(server.URL, server.Client())
	status, err := p.CheckConnection(context.Background(), testConn(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	if !status.Healthy || status.Provider != "pixhub" || status.Currency != "BRL" {
		t.Fatalf("status = %#v", status)
	}
	if status.AvailableMinor != 125000 || status.BlockedMinor != 25 || status.ReserveMinor != 30010 {
		t.Fatalf("balances = %#v", status)
	}
}

func TestDecimalBRLToMinor(t *testing.T) {
	cases := map[string]int64{"0.00": 0, "1.00": 100, "10.5": 1050, "1250.00": 125000, "-0.25": -25}
	for in, want := range cases {
		got, err := decimalBRLToMinor(in)
		if err != nil || got != want {
			t.Fatalf("decimalBRLToMinor(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	for _, in := range []string{"", "1.001", "abc", ".25"} {
		if _, err := decimalBRLToMinor(in); err == nil {
			t.Fatalf("decimalBRLToMinor(%q) should fail", in)
		}
	}
}
'''
p.write_text(text)

replace_once(
    "internal/httpapi/handlers_console.go",
    '"github.com/matspectrum-ai/Flash-Pag/internal/id"\n',
    '"github.com/matspectrum-ai/Flash-Pag/internal/id"\n\t"github.com/matspectrum-ai/Flash-Pag/internal/provider"\n',
)

marker = "func (s *Server) consoleCreateWebhook(w http.ResponseWriter, r *http.Request) {"
health = r'''func (s *Server) consoleTestProviderConnection(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.organizationFromConsoleRoles(r, "owner", "admin")
	if !ok {
		writeError(w, 403, "organization_forbidden", "organization access denied")
		return
	}
	connectionID := strings.TrimSpace(r.PathValue("id"))
	if connectionID == "" {
		writeError(w, 400, "connection_required", "provider connection id is required")
		return
	}
	q := url.Values{"id": {"eq." + connectionID}, "organization_id": {"eq." + orgID}, "status": {"eq.active"}, "select": {"id,provider_code"}, "limit": {"1"}}
	var rows []struct {
		ID           string `json:"id"`
		ProviderCode string `json:"provider_code"`
	}
	if err := s.sb.Do(r.Context(), http.MethodGet, "/rest/v1/provider_connections", q, nil, "", &rows); err != nil || len(rows) != 1 {
		writeError(w, 404, "connection_not_found", "active provider connection not found")
		return
	}
	impl, exists := s.providers.Get(rows[0].ProviderCode)
	if !exists {
		writeError(w, 422, "provider_not_installed", "provider adapter is not installed")
		return
	}
	tester, exists := impl.(provider.ConnectionTester)
	if !exists {
		writeError(w, 422, "health_check_unsupported", "provider does not expose a read-only health check")
		return
	}
	conn, err := s.providerConnection(r.Context(), orgID, rows[0].ProviderCode, connectionID)
	if err != nil {
		writeError(w, 422, "connection_load_failed", err.Error())
		return
	}
	status, err := tester.CheckConnection(r.Context(), conn)
	if err != nil {
		writeError(w, 502, "provider_health_failed", err.Error())
		return
	}
	writeJSON(w, 200, status)
}

''' + marker
replace_once("internal/httpapi/handlers_console.go", marker, health)

replace_once(
    "internal/httpapi/server.go",
    's.mux.HandleFunc("POST /console/api/provider-connections", s.withConsoleAuth(s.consoleCreateProviderConnection))\n',
    's.mux.HandleFunc("POST /console/api/provider-connections", s.withConsoleAuth(s.consoleCreateProviderConnection))\n\ts.mux.HandleFunc("POST /console/api/provider-connections/{id}/test", s.withConsoleAuth(s.consoleTestProviderConnection))\n',
)

p = Path("internal/ui/app.js")
text = p.read_text()
old = "panel('Providers',table(conns.data,[{label:'Provider',key:'provider_code'},{label:'Nome',key:'label'},{label:'Status',render:r=>badge(r.status)},{label:'Criado',render:r=>date(r.created_at)}]))"
new = "panel('Providers',table(conns.data,[{label:'Provider',key:'provider_code'},{label:'Nome',key:'label'},{label:'Status',render:r=>badge(r.status)},{label:'Criado',render:r=>date(r.created_at)},{label:'Teste',render:r=>{const b=node('button','Testar','primary');b.type='button';b.onclick=async()=>{b.disabled=true;try{const h=await api(`/console/api/provider-connections/${r.id}/test`,{method:'POST'});flash(h.healthy?`${r.provider_code} conectado · disponível ${money(h.available_minor)}`:`${r.provider_code} indisponível`,!h.healthy)}catch(err){flash(err.message,true)}finally{b.disabled=false}};return b}}]))"
if old not in text:
    raise SystemExit("integration provider table marker not found")
p.write_text(text.replace(old, new, 1))
