import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['scripts/**/*.js'],
      reporter: ['text'],
      thresholds: { lines: 95, statements: 95 },
    },
  },
});
