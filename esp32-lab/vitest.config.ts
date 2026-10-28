import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@esp32lab\/(.*)$/, replacement: r('./packages/$1/src/index.ts') },
      { find: /^@esp32lab-parts\/(.*)$/, replacement: r('./parts/$1/index.ts') },
    ],
  },
  test: { include: ['**/*.test.ts'], exclude: ['**/node_modules/**'] },
});
