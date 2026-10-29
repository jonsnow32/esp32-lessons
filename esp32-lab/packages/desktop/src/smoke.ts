// Smoke test of the first-launch setup without a window: install the compiler into a fresh
// folder (as on a computer without PlatformIO), build the warm-up sketch, then a lesson's
// sketch through the lab server. Run by scripts/smoke-toolchain.mjs, on CI for each platform.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { labServer } from '../../lab-server/src/index';
import { ToolchainSetup } from './toolchain';

async function main() {
  const base = process.env.SMOKE_DIR ?? mkdtempSync(join(tmpdir(), 'esp32lab-smoke-'));
  const course = join(__dirname, '../../../..');
  console.log(`setup in ${base}`);
  let setup: ToolchainSetup;
  const lab = labServer({
    projectRoot: course,
    pioBuildDir: join(course, '.pio', 'build'),
    workDir: join(base, 'build'),
    pio: () => setup.current?.pio ?? 'pio',
    env: () => setup.current?.env ?? process.env,
  });
  setup = new ToolchainSetup(join(base, 'toolchain'), true, lab.build);

  let failed: string | null = null;
  setup.subscribe((e) => {
    if (e.kind === 'step') console.log(`== step ${e.step + 1}: ${e.status}`);
    else if (e.kind === 'log') process.stdout.write(e.text);
    else if (e.kind === 'failed') failed = e.message;
  });
  await setup.install();
  if (failed) throw new Error(failed);
  if (!(await setup.find())) throw new Error('toolchain not found after setup');

  // A lesson's sketch, the way the app compiles the editor's code
  const code = readFileSync(join(course, 'lession', '01-hello-esp32', 'main.cpp'), 'utf8');
  const result = await lab.build(code, () => {});
  console.log('lesson build:', JSON.stringify(result));
  if (!result?.ok) throw new Error('lesson build failed');
}

main().then(
  () => console.log('SMOKE OK'),
  (e) => {
    console.error('SMOKE FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
