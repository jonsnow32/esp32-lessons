import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { claudeCli } from '../lab-server/src/claude-cli';
import { labServer } from '../lab-server/src/index';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The lab's endpoints (prebuilt lesson firmware, compiling the sketch, lesson sources) on the
 * dev server, for the lesson project this lab lives in. The desktop app serves the same.
 */
function lab(): Plugin {
  const server = labServer({
    projectRoot: r('../../..'),
    pioBuildDir: r('../../../.pio/build'),
    workDir: r('../../.build'),
  });
  // Dev only: the AI assistant on the developer's own Claude Code login (see claude-cli.ts)
  const claude = claudeCli({ workDir: r('../../.build/claude') });
  return {
    name: 'esp32lab-server',
    configureServer(dev) {
      dev.middlewares.use((req, res, next) => server.handle(req, res, next));
      dev.middlewares.use((req, res, next) => claude.handle(req, res, next));
    },
  };
}

const alias = [
  { find: /^@esp32lab-parts\/(.*)$/, replacement: r('../../parts/$1/index.ts') },
  { find: /^@esp32lab\/(.*)$/, replacement: r('../$1/src/index.ts') },
];

export default defineConfig({
  plugins: [svelte(), lab()],
  resolve: { alias },
  worker: { format: 'es' },
  server: { fs: { allow: [r('../..')] } },
});
