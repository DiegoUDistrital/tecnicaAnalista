import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests de BD comparten estado: se ejecutan de uno en uno.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.types.ts'],
      thresholds: { lines: 95, statements: 95 },
    },
  },
});
