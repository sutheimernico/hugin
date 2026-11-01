import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The GitHub Pages build has no backend: it replays the recorded demo runs (see lib/recordings.ts).
const replayOnly = process.env.VITE_REPLAY_ONLY === '1'
const apiTarget = process.env.HUGIN_API_TARGET ?? 'http://127.0.0.1:8770'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __REPLAY_ONLY__: JSON.stringify(replayOnly) },
  server: {
    port: 5177,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
})
