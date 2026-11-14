import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the demo from /navbat/
  base: mode === 'demo' ? (process.env.DEMO_BASE ?? '/navbat/') : '/',
  plugins: [react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    target: 'es2022',
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
