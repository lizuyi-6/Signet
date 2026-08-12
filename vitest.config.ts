import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Phase 1 runs purely on TypeScript source. Workspace packages resolve their
 * cross-deps via each package's `exports` field (which points at `./src/index.ts`),
 * so no build step is required to run tests.
 */
export default defineConfig({
  test: {
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/**/*.{test,spec}.ts',
      'tools/**/*.{test,spec}.ts',
    ],
    environment: 'node',
    reporters: ['default'],
    pool: 'threads',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/index.ts', '**/*.d.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
