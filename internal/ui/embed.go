package ui

import "embed"

//go:embed index.html app.js styles.css product.js product.css product-v2.js product-v2.css developer.js developer.css
var Files embed.FS
