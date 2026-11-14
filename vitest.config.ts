import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'db',
          root: 'packages/db',
          include: ['test/**/*.test.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
      {
        test: {
          name: 'api',
          root: 'apps/api',
          include: ['test/**/*.test.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'bot',
          root: 'apps/bot',
          include: ['test/**/*.test.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
