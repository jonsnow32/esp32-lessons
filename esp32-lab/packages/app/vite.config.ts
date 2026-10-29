import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
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
  return {
    name: 'esp32lab-server',
    configureServer(dev) {
      dev.middlewares.use((req, res, next) => server.handle(req, res, next));
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
