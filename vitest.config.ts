import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    pool: 'forks',
    environment: 'node',
  },
});
