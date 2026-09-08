package ui

import "embed"

// LegacyFiles keeps the current vanilla application available during the React migration.
//
//go:embed index.html app.js styles.css product.js product.css product-v2.js product-v2.css developer.js developer.css product-v3.js product-v3.css revolut-foundation.js revolut-foundation.css revolut-operations.js revolut-operations.css revolut-workspace.js revolut-workspace.css revolut-structure.js revolut-structure.css ui-runtime.js final-polish.js final-polish.css
var LegacyFiles embed.FS

// Files remains an alias used by the legacy /console route until cutover.
var Files = LegacyFiles

// AppFiles contains the Vite build generated into internal/ui/dist.
//
//go:embed dist/*
var AppFiles embed.FS
