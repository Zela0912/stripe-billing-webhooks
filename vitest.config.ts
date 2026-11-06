import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['server', 'web'],
    coverage: {
      provider: 'v8',
      include: ['server/src/**', 'web/src/**', 'shared/**'],
      exclude: ['server/src/index.ts', 'web/src/main.tsx', '**/*.d.ts'],
    },
  },
});
