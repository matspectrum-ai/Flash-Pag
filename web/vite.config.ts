import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../internal/ui/dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/console': 'http://localhost:8080',
      '/v1': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
      '/openapi.yaml': 'http://localhost:8080',
    },
  },
})
