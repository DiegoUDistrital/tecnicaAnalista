import { defineConfig } from 'vitest/config';

// Pruebas con procesos reales: sin cobertura, sin paralelismo y con plazos largos (`next build` tarda).
export default defineConfig({
  test: {
    include: ['integration/**/*.integration.test.js'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 300000,
  },
});
