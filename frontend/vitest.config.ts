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
      // 80 % global; 90 % en validación, API Routes y defensa de origen (también cuentan en el global).
      thresholds: {
        lines: 80,
        statements: 80,
        'src/app/api/**': { lines: 90, statements: 90 },
        'src/server/proxy/**': { lines: 90, statements: 90 },
        'src/lib/task-text.ts': { lines: 90, statements: 90 },
        'src/lib/task-edit.ts': { lines: 90, statements: 90 },
        'src/lib/task-filter.ts': { lines: 90, statements: 90 },
      },
    },
  },
});
