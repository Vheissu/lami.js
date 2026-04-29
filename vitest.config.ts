import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lami.js/runtime/internal': `${root}packages/runtime/src/internal.ts`,
      '@lami.js/runtime': `${root}packages/runtime/src/index.ts`,
      '@lami.js/compiler': `${root}packages/compiler/src/index.ts`,
      '@lami.js/ssr/internal': `${root}packages/ssr/src/internal.ts`,
      '@lami.js/ssr': `${root}packages/ssr/src/index.ts`
    }
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.ts']
  }
});
