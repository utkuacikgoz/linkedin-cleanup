import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The server reads INCLEANUP_PORT; hardcoding it here meant setting that
// variable silently broke the dev proxy and looked like the server was down.
const apiPort = Number(process.env.INCLEANUP_PORT) || 5274

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    proxy: {
      // Anchored so it cannot swallow the `api.ts` module request.
      '^/api/': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
})
