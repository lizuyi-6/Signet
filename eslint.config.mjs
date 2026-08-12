// Flat config for the Signet monorepo.
// ESLint v9, typescript-eslint, Prettier integration.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.output/**',
      '**/coverage/**',
      // tools/spike-web is a throwaway, not-shipped browser spike (uses browser
      // globals document/fetch/window). Its load-bearing facts are captured in
      // docs/decisions.md D15; Phase 6 adds a real Playwright E2E suite.
      'tools/spike-web/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // node-ish globals used by config files and tools (URL is a Node global
        // since Node 10, used by URL/import.meta.url path construction in scripts).
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Test files: allow describe/it/expect etc.
    files: ['**/*.{test,spec}.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // CLI entrypoints and Playwright scripts: console.log is the stdout contract
    // (benchmark report, signing progress, smoke diagnostics), not a smell.
    files: ['apps/extension/scripts/**/*.{mjs,js,ts}', 'tools/**/cli.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
