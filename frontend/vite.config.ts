import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The built app is served by FastAPI under /app/ (see backend/api.py), so the
// same base is used in dev: open http://localhost:5173/app/. In dev, /api is
// proxied to the FastAPI server, which keeps everything same-origin (no CORS).
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
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
