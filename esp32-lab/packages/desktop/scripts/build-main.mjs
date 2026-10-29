// Bundle the Electron main process (with lab-server) into dist-main/, next to the setup page.
import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist-main', { recursive: true, force: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist-main/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
});
cpSync('setup', 'dist-main/setup', { recursive: true });
