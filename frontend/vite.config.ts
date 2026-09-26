import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The built app is served by FastAPI from / (see backend/api.py). In development,
// Vite serves it at http://localhost:5173/ and proxies /api to the FastAPI server,
// which keeps everything same-origin (no CORS).
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // ECharts is one deliberate ~630 KB chunk (215 KB gzipped), loaded only by the pages that draw charts
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: { echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
