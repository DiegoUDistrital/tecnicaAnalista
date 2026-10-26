import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests de BD comparten estado: se ejecutan de uno en uno.
    fileParallelism: false,
    // Carga el .env de la raíz antes de cada archivo de test.
    setupFiles: ['tests/helpers/load-env.ts'],
    testTimeout: 15000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.types.ts'],
      // 80 % global; 90 % en validación y rutas (los archivos de glob también cuentan en el global).
      thresholds: {
        lines: 80,
        statements: 80,
        'src/validation/**': { lines: 90, statements: 90 },
        'src/http/input/**': { lines: 90, statements: 90 },
        'src/routes/**': { lines: 90, statements: 90 },
        'src/controllers/**': { lines: 90, statements: 90 },
        'src/http/route-table.ts': { lines: 90, statements: 90 },
      },
    },
  },
});
