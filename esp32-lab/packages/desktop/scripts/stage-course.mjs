// Copy what the app needs from the course (the lesson project around esp32-lab) into
// staging/course: platformio.ini, the lesson sources (not the videos) and the prebuilt lesson
// firmware. Timestamps are kept: the app boots a prebuilt lesson only while its build is newer
// than the lesson's source.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const course = '../../..';
const out = 'staging/course';
const SOURCES = new Set(['.cpp', '.c', '.h', '.hpp', '.ino']);
const FIRMWARE = ['firmware.elf', 'firmware.bin', 'bootloader.bin', 'partitions.bin'];
const keep = { preserveTimestamps: true };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(course, 'platformio.ini'), join(out, 'platformio.ini'), keep);

function sources(dir) {
  for (const e of readdirSync(join(course, dir))) {
    const rel = join(dir, e);
    if (statSync(join(course, rel)).isDirectory()) sources(rel);
    else if (SOURCES.has(extname(e))) cpSync(join(course, rel), join(out, rel), keep);
  }
}
sources('lession');

const builds = join(course, '.pio', 'build');
let envs = 0;
for (const env of existsSync(builds) ? readdirSync(builds) : []) {
  if (!existsSync(join(builds, env, 'firmware.elf'))) continue;
  for (const f of FIRMWARE) {
    const from = join(builds, env, f);
    if (existsSync(from)) cpSync(from, join(out, '.pio', 'build', env, f), keep);
  }
  envs++;
}
console.log(`staged ${out}: ${envs} prebuilt lesson(s)`);
