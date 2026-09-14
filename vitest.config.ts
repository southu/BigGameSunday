import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '/tmp/vitest-bgs-vite',
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/**/*.node.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'tests']
    }
  }
});
