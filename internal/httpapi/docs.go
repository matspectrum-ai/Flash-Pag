package httpapi

import (
	"embed"
	"net/http"
)

//go:embed openapi.yaml
var docsFS embed.FS

func (s *Server) openapi(w http.ResponseWriter, r *http.Request) {
	b, err := docsFS.ReadFile("openapi.yaml")
	if err != nil {
		http.Error(w, "spec unavailable", 500)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Write(b)
}
func (s *Server) docs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flash Pag API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.yaml',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:true})</script></body></html>`))
}
