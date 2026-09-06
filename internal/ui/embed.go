package ui

import "embed"

//go:embed index.html app.js styles.css product.js product.css
var Files embed.FS
