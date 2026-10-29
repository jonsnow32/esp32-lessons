// Bundle and run src/smoke.ts: the first-launch setup end to end, without a window.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

await build({ entryPoints: ['src/smoke.ts'], outfile: 'dist-main/smoke.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20' });
execFileSync(process.execPath, ['dist-main/smoke.cjs'], { stdio: 'inherit' });
