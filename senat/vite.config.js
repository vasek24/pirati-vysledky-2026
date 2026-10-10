import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Spouští se z kořene repa: `vite build --config senat/vite.config.js`, proto root výslovně.
// Samostatné SPA (ne Praha): žádný Tailwind, vlastní výstup do senat/dist.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // dev: `wrangler dev` pro cloudflare-senat na 8799
  server: { proxy: { '/api': 'http://localhost:8799' } },
})
