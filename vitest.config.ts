import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vitest does NOT load the Cloudflare Vite plugin: unit/integration tests run in plain Node,
// and Worker code is exercised through Hono's app.request() instead of workerd.
const alias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@frontend': fileURLToPath(new URL('./src/frontend', import.meta.url)),
  '@backend': fileURLToPath(new URL('./src/backend', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/unit/**/*.test.ts',
            'tests/integration/**/*.test.ts',
            'src/backend/**/*.test.ts',
            'src/shared/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'frontend',
          environment: 'jsdom',
          include: ['src/frontend/**/*.test.tsx', 'src/frontend/**/*.test.ts'],
          setupFiles: ['./tests/setup/frontend.ts'],
        },
      },
    ],
  },
});
