import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
/** PlatformIO build outputs of the lesson project this lab lives in. */
const PIO_BUILD = r('../../../.pio/build');

/** Serves .pio/build/<env>/* so the lab can run whatever `pio run` built last. */
function platformioBuilds(): Plugin {
  return {
    name: 'platformio-builds',
    configureServer(server) {
      server.middlewares.use('/pio', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        if (path === '/' || path === '/envs') {
          const envs = existsSync(PIO_BUILD)
            ? readdirSync(PIO_BUILD).filter((e) => existsSync(join(PIO_BUILD, e, 'firmware.elf')) && existsSync(join(PIO_BUILD, e, 'firmware.bin')))
            : [];
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(envs.sort()));
        }
        const [, env, file] = path.split('/');
        const allowed = ['firmware.elf', 'firmware.bin', 'bootloader.bin', 'partitions.bin'];
        const full = env && file ? join(PIO_BUILD, env, file) : '';
        if (!env || !file || !allowed.includes(file) || env.includes('..') || !existsSync(full)) return next();
        res.setHeader('content-type', 'application/octet-stream');
        res.end(readFileSync(full));
      });
    },
  };
}

const alias = [
  { find: /^@esp32lab-parts\/(.*)$/, replacement: r('../../parts/$1/index.ts') },
  { find: /^@esp32lab\/(.*)$/, replacement: r('../$1/src/index.ts') },
];

export default defineConfig({
  plugins: [svelte(), platformioBuilds()],
  resolve: { alias },
  worker: { format: 'es' },
  server: { fs: { allow: [r('../..')] } },
});
