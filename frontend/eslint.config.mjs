import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

// No se usa `eslint-config-next`: sus plugins (react, import, jsx-a11y) no declaran ESLint 10.
// Se cablean a mano los plugins que sí corren con ESLint 10 (ver README).
export default tseslint.config(
  { ignores: ['.next/', 'coverage/', 'node_modules/', 'src/generated/', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    settings: { react: { version: 'detect' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react/no-danger': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'max-len': ['error', { code: 120, ignoreUrls: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-console': 'error' },
  },
  {
    // Los nombres de los tests citan el RF y el caso límite: pueden ser largos.
    files: ['tests/**/*.{ts,tsx}'],
    rules: { 'max-len': ['error', { code: 120, ignoreUrls: true, ignoreStrings: true }] },
  },
  {
    // El código del navegador no puede importar el servidor ni leer variables de entorno.
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/**', '**/generated/**'],
              message: 'El navegador no puede importar código del servidor.',
            },
          ],
          paths: [{ name: 'server-only', message: 'El navegador no puede importar código del servidor.' }],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'El navegador no puede leer variables de entorno.',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
