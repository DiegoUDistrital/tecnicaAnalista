import js from '@eslint/js';

// `no-undef` está desactivada porque `tsc` con checkJs ya detecta las variables no definidas.
export default [
  { ignores: ['backend/', 'frontend/', 'docs/', 'specs/', 'docker/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  {
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'max-len': ['error', { code: 120, ignoreUrls: true }],
    },
  },
];
