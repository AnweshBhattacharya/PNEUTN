import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    // Dev proxy: forward /solve, /riemann, /integral-order to SAM local API
    // so the browser never makes cross-origin requests during development.
    // Start SAM locally with: cd backend && sam local start-api
    proxy: {
      '/solve':          { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/riemann':        { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/integral-order': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three'],
          'mathjs-vendor': ['mathjs'],
          'mathlive-vendor': ['mathlive'],
          'katex-vendor': ['katex'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    pool: 'forks',
  },
})

