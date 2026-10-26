import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('./tests/helpers/server-only-stub.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/generated/**', 'src/app/layout.tsx', 'src/**/*.types.ts'],
      thresholds: { lines: 95, statements: 95 },
    },
  },
});
