import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api → API Fastify (apps/api). Même origine pour le navigateur : le cookie
// de session (SameSite=Strict) passe, et aucune configuration CORS n'est requise.
// En production, le serveur web (reverse proxy) fait la même redirection.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
