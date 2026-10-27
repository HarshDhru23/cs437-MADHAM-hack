/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Django API is same-origin in production. Locally, Vite proxies /api to
// the Django dev server so session cookies and CSRF work without CORS.
const apiOrigin = process.env.COURSEPATH_API_ORIGIN ?? 'http://127.0.0.1:8000';
const proxy = { '/api': { target: apiOrigin, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
