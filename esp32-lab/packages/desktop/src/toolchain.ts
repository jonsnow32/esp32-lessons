// The compiler for the desktop app: PlatformIO, found on this computer or installed on first
// launch into the app's own folder. Installing needs no Python on the computer: uv (a single
// binary) fetches a standalone Python, makes a virtualenv and installs PlatformIO into it.
// PlatformIO then downloads the ESP32 platform and toolchain on the first build, which the
// setup runs once (a blink sketch) so the user's first ▶ is quick.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { penvPio } from '../../lab-server/src/index';

const UV_VERSION = '0.7.2';
const PYTHON = '3.12';
const PLATFORMIO = 'platformio>=6.1,<7';

export interface Toolchain {
  pio: string;
  env: NodeJS.ProcessEnv;
}

export const SETUP_STEPS = ['Tải bộ cài uv', 'Cài Python', 'Cài PlatformIO', 'Tải bộ công cụ ESP32 và biên dịch thử'];

export type SetupEvent =
  | { kind: 'step'; step: number; status: 'run' | 'done' | 'error' }
  | { kind: 'log'; text: string }
  | { kind: 'progress'; step: number; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

/** A sketch that pulls in the whole Arduino core: building it once installs and warms up everything. */
const WARMUP = `#include <Arduino.h>
void setup() { Serial.begin(115200); pinMode(2, OUTPUT); }
void loop() { digitalWrite(2, !digitalRead(2)); delay(500); }
`;

function uvAsset(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `uv-${arch}-apple-darwin.tar.gz`;
  if (process.platform === 'win32') return `uv-${arch}-pc-windows-msvc.zip`;
  return `uv-${arch}-unknown-linux-gnu.tar.gz`;
}

/** Does `pio --version` run? */
function works(pio: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(pio)) return resolve(false);
    const child = spawn(pio, ['--version'], { env });
    child.on('error', () => resolve(false));
    child.on('close', (status) => resolve(status === 0));
  });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, log: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env });
    child.stdout.on('data', (d: Buffer) => log(d.toString()));
    child.stderr.on('data', (d: Buffer) => log(d.toString()));
    child.on('error', reject);
    child.on('close', (status) => (status === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} dừng với mã ${status}`))));
  });
}

function find(dir: string, name: string): string | undefined {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === name) return p;
    if (statSync(p).isDirectory()) {
      const f = find(p, name);
      if (f) return f;
    }
  }
  return undefined;
}

/**
 * The toolchain in `base`: what is installed there, or PlatformIO already on this computer
 * (unless `own` asks for the app's own install).
 */
export class ToolchainSetup {
  private stateFile: string;
  private events: SetupEvent[] = [];
  private listeners = new Set<(e: SetupEvent) => void>();
  private running = false;
  current: Toolchain | null = null;

  constructor(
    private base: string,
    private own: boolean,
    private warmup: (code: string, output: (text: string) => void) => Promise<{ ok: boolean }> | null,
  ) {
    this.stateFile = join(base, 'toolchain.json');
  }

  /** The toolchain ready to use, if there is one: installed before, or found on this computer. */
  async find(): Promise<Toolchain | null> {
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Toolchain;
      const env = { ...process.env, ...saved.env };
      if (await works(saved.pio, env)) return (this.current = { pio: saved.pio, env });
    } catch {
      /* not installed yet */
    }
    if (this.own) return null;
    for (const pio of [process.env.PIO, penvPio(join(homedir(), '.platformio', 'penv'))]) {
      if (pio && (await works(pio, process.env))) return (this.current = { pio, env: process.env });
    }
    return null;
  }

  /** Follow the setup: what happened so far, then each new event. Returns the unsubscribe. */
  subscribe(listener: (e: SetupEvent) => void): () => void {
    for (const e of this.events) listener(e);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: SetupEvent) {
    // Keep the log short enough to replay to a page that reconnects
    if (e.kind === 'log' && this.events.length > 4000) this.events.splice(0, 1000);
    // Download progress is only for whoever watches now
    if (e.kind !== 'progress') this.events.push(e);
    for (const l of this.listeners) l(e);
  }

  /** Install everything; safe to call again after a failure (finished steps are kept). */
  async install() {
    if (this.running) return;
    this.running = true;
    this.events = [];
    const log = (text: string) => this.emit({ kind: 'log', text });
    let step = 0;
    const begin = (n: number) => {
      step = n;
      this.emit({ kind: 'step', step: n, status: 'run' });
    };
    const done = () => this.emit({ kind: 'step', step, status: 'done' });
    try {
      mkdirSync(this.base, { recursive: true });
      const uvDir = join(this.base, 'uv');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        UV_PYTHON_INSTALL_DIR: join(this.base, 'python'),
        UV_CACHE_DIR: join(this.base, 'uv-cache'),
        UV_PYTHON_PREFERENCE: 'only-managed',
      };

      begin(0);
      const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
      let uv = existsSync(uvDir) ? find(uvDir, uvName) : undefined;
      if (!uv) {
        rmSync(uvDir, { recursive: true, force: true });
        mkdirSync(uvDir, { recursive: true });
        const asset = uvAsset();
        const archive = join(uvDir, asset);
        await this.download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`, archive, step);
        // tar unpacks both: .tar.gz on macOS / Linux, .zip on Windows 10+ (bsdtar)
        await run('tar', ['-xf', archive, '-C', uvDir], env, log);
        uv = find(uvDir, uvName);
        if (!uv) throw new Error('Không tìm thấy uv sau khi giải nén');
      }
      done();

      begin(1);
      await run(uv, ['python', 'install', PYTHON], env, log);
      done();

      begin(2);
      const penv = join(this.base, 'penv');
      const pio = penvPio(penv);
      if (!existsSync(pio)) {
        // --seed: with pip, which the sketch build uses to fetch a quicker esptool (lab-server)
        await run(uv, ['venv', penv, '--python', PYTHON, '--seed'], env, log);
        await run(uv, ['pip', 'install', '--python', penv, PLATFORMIO], env, log);
      }
      const toolchain: Toolchain = { pio, env: { PLATFORMIO_CORE_DIR: join(this.base, 'platformio') } };
      if (!(await works(pio, { ...process.env, ...toolchain.env }))) throw new Error('PlatformIO không chạy được sau khi cài');
      this.current = { pio, env: { ...process.env, ...toolchain.env } };
      done();

      begin(3);
      const build = this.warmup(WARMUP, log);
      if (!build) throw new Error('Đang có một lần biên dịch khác, thử lại sau');
      if (!(await build).ok) throw new Error('Biên dịch thử không thành công');
      done();

      // The downloaded archives (~1 GB) are unpacked: PlatformIO does not need them again
      rmSync(join(this.base, 'platformio', '.cache', 'downloads'), { recursive: true, force: true });
      writeFileSync(this.stateFile, JSON.stringify(toolchain, null, 2));
      this.emit({ kind: 'ready' });
    } catch (e) {
      this.emit({ kind: 'step', step, status: 'error' });
      this.emit({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.running = false;
    }
  }

  private async download(url: string, to: string, step: number) {
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`Tải ${url} thất bại (${r.status})`);
    const total = Number(r.headers.get('content-length') ?? 0);
    let got = 0;
    let shown = -1;
    const body = Readable.fromWeb(r.body as import('node:stream/web').ReadableStream);
    body.on('data', (c: Buffer) => {
      got += c.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct === shown) return;
      shown = pct;
      this.emit({ kind: 'progress', step, done: got, total });
    });
    await pipeline(body, createWriteStream(to));
  }
}
