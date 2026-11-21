import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // remoteBindings: false keeps dev startable without Cloudflare login. Remote-only bindings
    // (AI) are not proxied; deploy-time behaviour is unaffected.
    cloudflare({ remoteBindings: false }),
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@frontend': fileURLToPath(new URL('./src/frontend', import.meta.url)),
      '@backend': fileURLToPath(new URL('./src/backend', import.meta.url)),
    },
  },
  // Pre-bundle lazily imported deps so the dev server doesn't reload mid-flow (e.g. printable cards).
  optimizeDeps: {
    include: ['qrcode', 'recharts'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
