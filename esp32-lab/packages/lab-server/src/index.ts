// The lab's local server endpoints, for the Vite dev server and the desktop app alike. They
// compile the sketch typed in the browser with the real PlatformIO toolchain and serve
// firmware to the emulator:
//
//   GET  /pio/envs                        envs in the prebuilt lesson builds
//   GET  /pio/<env>/fresh?src=lession/…   is that build newer than the lesson's source?
//   GET  /pio/<env>/<file>                firmware.elf | firmware.bin | bootloader.bin | partitions.bin
//   POST /api/build            { code }   streams the `pio run` log as text, then a final
//                                         line "@@RESULT {json}" with ok / duration / errors
//   GET  /api/build/out/<file>            the sketch build's firmware files
//   GET  /api/sketch?path=lession/…       a lesson's main.cpp, as starting code
//   GET  /api/headers                     header names a top-level source must not take (lower case)
//
// Linked folders (see folders.ts), a sketch kept in its own folder of the course:
//   GET  /api/folders                     every linked folder: [{ path, title, updated }]
//   GET  /api/folder?path=…               { title, project, code, files: { path: text } } (net/wifi.cpp…)
//   PUT  /api/folder           { path, title?, project?, code?, files? }   write what changed;
//                                         files: { path: text | null } (null deletes the file)
//   DELETE /api/folder?path=…             unlink: esp32-lab.json goes, main.cpp and the rest stay
//   GET  /api/folder/check?path=…         can a new project live there: { ok, path, exists, hasCode } | { ok: false, error }
//   POST /api/folder/link      { path, title, project, code }   a new project in that folder
//                                         (its main.cpp kept if there is one): { path, title, project, code, files }
// /api/build and /api/device/upload take { folder, files? } too: the folder's other sources
// (secrets.h…) are built next to the code, as the editor has them (files) or else as on disk.
//
// A real ESP32 on USB (see device.ts):
//   GET  /api/device/ports                serial ports, likely boards first
//   POST /api/device/upload    { code, port, live }
//                                         build and flash it, streaming the log like /api/build;
//                                         live: with the probe that reports the pins (probe.ts)
//   GET  /api/device/serial?port=&baud=   the port's bytes as they come, for as long as the
//                                         request stays open (one at a time)
//   POST /api/device/serial/write { text }   send to the board
//   POST /api/device/serial/reset         restart the chip (EN through RTS)
//
// The sketch lives in its own PlatformIO project (<workDir>/sketch) whose [env] copies
// platform / board / framework from the course's platformio.ini, so it builds against exactly
// the same core as `pio run -e lessonNN`. The course's platformio.ini is never touched.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import libraries from '../libraries.json';
import { listPorts, pythonFor, SerialLine } from './device';
import { checkNewFolder, findFolders, folderPath, folderSources, isSourceName, linkFolder, readFolder, unlinkFolder, writeFolder } from './folders';
import { PROBE_CPP, PROBE_FILE } from './probe';

export interface LabServerOptions {
  /** The course: platformio.ini and the lesson sources in lession/. */
  projectRoot: string;
  /** Prebuilt lesson firmware, one folder per env (the course's .pio/build). */
  pioBuildDir: string;
  /** Writable: where the sketch is built. */
  workDir: string;
  /** The pio command; by default $PIO, else PlatformIO's own install in the home folder. */
  pio?: () => string;
  /** Environment for pio, e.g. PLATFORMIO_CORE_DIR; by default this process's. */
  env?: () => NodeJS.ProcessEnv;
}

export interface BuildError {
  /** The source it is in: main.cpp, or another file of a linked folder. */
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface BuildResult {
  ok: boolean;
  ms: number;
  errors: BuildError[];
}

const FILES = ['firmware.elf', 'firmware.bin', 'bootloader.bin', 'partitions.bin'];
const ENV = 'sketch';
/** The same sketch with the probe, for live mode on a real board. */
const LIVE_ENV = 'live';

/** pio inside a PlatformIO virtualenv: bin/pio, or Scripts\pio.exe on Windows. */
export function penvPio(penv: string): string {
  return process.platform === 'win32' ? join(penv, 'Scripts', 'pio.exe') : join(penv, 'bin', 'pio');
}

/** $PIO, else PlatformIO's own install in the home folder, else whatever `pio` is on the PATH. */
export function defaultPio(): string {
  if (process.env.PIO) return process.env.PIO;
  const pio = penvPio(join(homedir(), '.platformio', 'penv'));
  return existsSync(pio) ? pio : 'pio';
}

/** platform / board / framework / build options from the course's shared [env]. */
function sharedEnv(projectIni: string): string[] {
  if (!existsSync(projectIni)) return ['platform = espressif32', 'board = esp32dev', 'framework = arduino'];
  const keep = ['platform', 'platform_packages', 'board', 'framework', 'board_build.', 'build_flags', 'lib_deps', 'upload_speed'];
  const lines: string[] = [];
  let inEnv = false;
  for (const raw of readFileSync(projectIni, 'utf8').split('\n')) {
    const line = raw.replace(/\s;.*$/, '').trimEnd();
    if (/^\[.*\]$/.test(line.trim())) inEnv = line.trim() === '[env]';
    else if (inEnv && keep.some((k) => line.trim().startsWith(k))) lines.push(line.trim());
  }
  return lines;
}

/**
 * Libraries the lab's parts are usually driven with, by the header a sketch includes. The
 * sketch's project gets them as lib_deps, so `#include <LiquidCrystal_I2C.h>` just works, as in
 * Wokwi. Kept as JSON so scripts/build-projects.sh uses the same list.
 */
export const LIBRARIES: Record<string, string> = libraries;

/** lib_deps for the headers `code` includes. */
export function libraryDeps(code: string): string[] {
  const deps = new Set<string>();
  for (const m of code.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)) {
    const lib = LIBRARIES[m[1]!];
    if (lib) deps.add(lib);
  }
  return [...deps];
}

/** The shared [env] lines with `libs` added to (or as) its lib_deps. */
export function withLibraries(env: string[], libs: string[]): string[] {
  if (!libs.length) return env;
  const at = env.findIndex((l) => l.startsWith('lib_deps'));
  const extra = libs.map((l) => `  ${l}`);
  return at < 0 ? [...env, 'lib_deps =', ...extra] : [...env.slice(0, at + 1), ...extra, ...env.slice(at + 1)];
}

/**
 * A PlatformIO extra script for the sketch: elf2image with esptool as a Python package, the same
 * version as the platform's tool-esptool. That one is a PyInstaller bundle that unpacks itself on
 * every run, some 3.5 s of each build on macOS; the package takes 0.1 s and writes the same bytes.
 * Until the package is in <workDir>/esptool-<version>, builds use the bundle and one starts
 * installing it in the background.
 */
const FAST_BIN = `# Generated by ESP32 Lab – edits are overwritten
import json, os, subprocess, sys
Import("env")
tool = env.PioPlatform().get_package_dir("tool-esptool") or ""
try:
    v = int(json.load(open(os.path.join(tool, "package.json")))["version"].split(".")[1])
    version = "%d.%d.%d" % (v // 10000, v // 100 % 100, v % 100)
except Exception:
    version = None
if version:
    lib = os.path.normpath(os.path.join(env.subst("$PROJECT_DIR"), "..", "esptool-" + version))
    if os.path.isdir(lib):
        env.Replace(ELF2BINCMD='"$PYTHONEXE" -c "import sys; sys.path.insert(0, sys.argv.pop(1)); import esptool; esptool._main()" "%s" $ELF2BINFLAGS -o $TARGET $SOURCES' % lib)
    else:
        part = lib + ".part"
        # A virtualenv made by uv (the desktop app's) comes without pip: ensurepip first
        install = "import importlib.util, os, shutil, subprocess, sys; shutil.rmtree(sys.argv[2], True); importlib.util.find_spec('pip') or subprocess.check_call([sys.executable, '-m', 'ensurepip']); subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', '--target', sys.argv[2], 'esptool==' + sys.argv[1]]); os.rename(sys.argv[2], sys.argv[3])"
        if not os.path.isdir(part):
            subprocess.Popen([env.subst("$PYTHONEXE"), "-c", install, version, part, lib], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
`;

/** GCC diagnostics for the sources in src/ (main.cpp and a linked folder's others). */
export function parseErrors(log: string): BuildError[] {
  const out: BuildError[] = [];
  // src/… relative or …/sketch/src/… absolute; not a library's own src/ (.pio/libdeps/sketch/<lib>/src/…)
  const re = /(?:^|\s)(?:\S*[/\\]sketch[/\\])?src[/\\]((?:[A-Za-z0-9_][A-Za-z0-9_.-]*[/\\])*[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:cpp|c|hpp|h)):(\d+):(\d+): (fatal error|error|warning): (.*)$/gm;
  for (let m = re.exec(log); m; m = re.exec(log)) {
    out.push({ file: m[1]!.replace(/\\/g, '/'), line: Number(m[2]), column: Number(m[3]), severity: m[4] === 'warning' ? 'warning' : 'error', message: m[5]! });
  }
  return out;
}

/** The `files` of a request body: name → text, plain source names only; undefined if none sent. */
function bodyFiles(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [n, t] of Object.entries(v)) if (isSourceName(n) && typeof t === 'string') out[n] = t;
  return out;
}

/** Delete what is in `dir` but not in `keep` (paths relative to it), then the folders left empty. */
function clearStale(dir: string, keep: Set<string>, prefix = '') {
  for (const n of readdirSync(dir)) {
    const rel = prefix + n;
    const full = join(dir, n);
    if (statSync(full).isDirectory()) {
      clearStale(full, keep, `${rel}/`);
      if (!readdirSync(full).length) rmSync(full, { recursive: true });
    } else if (!keep.has(rel)) rmSync(full, { force: true });
  }
}

/**
 * The headers a sketch's own top-level files must not be named like (lower case): the Arduino
 * core's, its bundled libraries' and the lab's libraries'. src/ is on the include path and macOS
 * ignores case, so a network.h beside main.cpp would stand in for the core's Network.h.
 */
export function reservedHeaders(coreDir: string): string[] {
  const names = new Set(Object.keys(LIBRARIES).map((n) => n.toLowerCase()));
  const fw = join(coreDir, 'packages', 'framework-arduinoespressif32');
  const add = (d: string) => {
    try {
      for (const n of readdirSync(d)) if (/\.(h|hpp)$/i.test(n)) names.add(n.toLowerCase());
    } catch {}
  };
  add(join(fw, 'cores', 'esp32'));
  try {
    for (const lib of readdirSync(join(fw, 'libraries'))) add(join(fw, 'libraries', lib, 'src'));
  } catch {}
  for (const n of ['arduino.h', 'wifi.h', 'network.h', 'wire.h', 'spi.h', 'preferences.h', 'fs.h', 'sd.h', 'eeprom.h', 'ticker.h', 'update.h']) names.add(n);
  return [...names].sort();
}

type Next = () => void;

/** The lab's server: `build` compiles a sketch, `handle` answers the endpoints above. */
export function labServer(opts: LabServerOptions) {
  const pio = opts.pio ?? defaultPio;
  const env = opts.env ?? (() => process.env);
  const project = join(opts.workDir, 'sketch');
  const outDir = join(project, '.pio', 'build', ENV);
  let building = false;
  /** reservedHeaders(), read once. */
  let headers: string[] | null = null;

  /** Write `text` to `path` unless it holds just that: an untouched file keeps the build cache. */
  function keep(path: string, text: string) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  }

  function prepare(code: string, folder?: string, files?: Record<string, string>) {
    const src = join(project, 'src');
    mkdirSync(src, { recursive: true });
    // Every library, whatever the sketch includes: a platformio.ini that changes makes PlatformIO
    // rebuild the whole Arduino core (some 12 s). Built once, the unused ones cost nothing more,
    // and the linker leaves them out of the firmware.
    const shared = [
      ...withLibraries(sharedEnv(join(opts.projectRoot, 'platformio.ini')), [...new Set(Object.values(LIBRARIES))]),
      'extra_scripts = post:fast_bin.py',
    ];
    const ini = [
      '; Generated by ESP32 Lab for the code editor – edits are overwritten',
      `[env:${ENV}]`,
      ...shared,
      '',
      // Its own build folder: the first live build compiles the Arduino core once more
      `[env:${LIVE_ENV}]`,
      ...shared,
      'build_src_filter = +<*> +<../probe/>',
      '',
    ].join('\n');
    keep(join(project, 'platformio.ini'), ini);
    keep(join(project, 'fast_bin.py'), FAST_BIN);
    mkdirSync(join(project, 'probe'), { recursive: true });
    keep(join(project, 'probe', PROBE_FILE), PROBE_CPP);
    // A linked folder's other sources next to the code (as the editor has them, else from disk),
    // in their subfolders; nothing left from another sketch's or a renamed file
    const dir = folder ? folderPath(opts.projectRoot, folder) : null;
    const extra = dir ? (files ?? folderSources(dir)) : {};
    clearStale(src, new Set([...Object.keys(extra), 'main.cpp']));
    for (const [n, text] of Object.entries(extra)) {
      const file = join(src, ...n.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      keep(file, text);
    }
    writeFileSync(join(src, 'main.cpp'), code);
  }

  /**
   * Compile a sketch; the pio log goes to `output` as it comes. Null while another build runs.
   * `upload`: then flash it to the board on that port (`live`: with the probe). `folder`: a linked
   * folder whose other sources it is built with; `files`: those sources as the editor has them.
   */
  function build(code: string, output: (text: string) => void, upload?: { port: string; live: boolean }, folder?: string, files?: Record<string, string>): Promise<BuildResult> | null {
    if (building) return null;
    building = true;
    prepare(code, folder, files);
    const started = Date.now();
    let log = '';
    const args = upload
      ? ['run', '-d', project, '-e', upload.live ? LIVE_ENV : ENV, '-t', 'upload', '--upload-port', upload.port]
      : ['run', '-d', project, '-e', ENV];
    return new Promise((resolve) => {
      const child = spawn(pio(), args, { env: { ...env(), PLATFORMIO_FORCE_ANSI: 'false' } });
      const pipe = (d: Buffer | string) => {
        const text = d.toString();
        log += text;
        output(text);
      };
      child.stdout.on('data', pipe);
      child.stderr.on('data', pipe);
      child.on('error', (e) => pipe(`\nKhông chạy được PlatformIO (${pio()}): ${e.message}\nCài PlatformIO hoặc đặt biến môi trường PIO.\n`));
      child.on('close', (status) => {
        building = false;
        const ok = status === 0 && (!!upload || FILES.slice(0, 2).every((f) => existsSync(join(outDir, f))));
        resolve({ ok, ms: Date.now() - started, errors: parseErrors(log) });
      });
    });
  }

  function send(res: ServerResponse, type: string, body: string | Buffer) {
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  }

  /** Prebuilt lesson firmware. */
  function pioBuilds(path: string, query: URLSearchParams, res: ServerResponse, next: Next) {
    if (path === '/' || path === '/envs') {
      const dir = opts.pioBuildDir;
      const envs = existsSync(dir)
        ? readdirSync(dir).filter((e) => existsSync(join(dir, e, 'firmware.elf')) && existsSync(join(dir, e, 'firmware.bin')))
        : [];
      return send(res, 'application/json', JSON.stringify(envs.sort()));
    }
    const [, name, file] = path.split('/');
    if (name && file === 'fresh') {
      const src = query.get('src') ?? '';
      const elf = join(opts.pioBuildDir, name, 'firmware.elf');
      const srcPath = join(opts.projectRoot, src);
      const ok = !name.includes('..') && !src.includes('..') && src.startsWith('lession/') && existsSync(elf) && existsSync(srcPath);
      return send(res, 'application/json', JSON.stringify({ fresh: ok && statSync(elf).mtimeMs >= statSync(srcPath).mtimeMs }));
    }
    const full = name && file ? join(opts.pioBuildDir, name, file) : '';
    if (!name || !file || !FILES.includes(file) || name.includes('..') || !existsSync(full)) return next();
    send(res, 'application/octet-stream', readFileSync(full));
  }

  function sketchBuild(req: IncomingMessage, path: string, res: ServerResponse, next: Next) {
    if (req.method === 'GET' && path.startsWith('/out/')) {
      const file = path.slice(5);
      const full = join(outDir, file);
      if (!FILES.includes(file) || !existsSync(full)) return next();
      return send(res, 'application/octet-stream', readFileSync(full));
    }
    if (req.method !== 'POST' || path !== '/') return next();
    if (building) {
      res.statusCode = 409;
      return res.end('Đang build, chờ lần build trước xong.');
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let code: string;
      let folder: string | undefined;
      let files: Record<string, string> | undefined;
      try {
        const json = JSON.parse(body);
        code = String(json.code ?? '');
        folder = typeof json.folder === 'string' ? json.folder : undefined;
        files = bodyFiles(json.files);
      } catch {
        res.statusCode = 400;
        return res.end('bad request');
      }
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      const done = build(code, (text) => res.write(text), undefined, folder, files);
      if (!done) {
        res.statusCode = 409;
        return res.end('Đang build, chờ lần build trước xong.');
      }
      void done.then((result) => res.end(`\n@@RESULT ${JSON.stringify(result)}\n`));
    });
  }

  const line = new SerialLine();

  /** A JSON request body, or null (and a 400) when it is not one. */
  function readJson(req: IncomingMessage, res: ServerResponse, then: (body: Record<string, unknown>) => void) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        then(JSON.parse(body || '{}'));
      } catch {
        res.statusCode = 400;
        res.end('bad request');
      }
    });
  }

  function device(req: IncomingMessage, path: string, query: URLSearchParams, res: ServerResponse, next: Next) {
    if (req.method === 'GET' && path === '/ports') {
      void listPorts(pio(), env()).then((ports) => send(res, 'application/json', JSON.stringify(ports)));
      return;
    }
    if (req.method === 'POST' && path === '/upload') {
      return readJson(req, res, async (body) => {
        const port = String(body.port ?? '');
        if (!port) {
          res.statusCode = 400;
          return res.end('Chưa chọn cổng USB.');
        }
        if (building) {
          res.statusCode = 409;
          return res.end('Đang build, chờ lần build trước xong.');
        }
        // esptool needs the port to itself
        if (line.port === port) await line.close();
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        const folder = typeof body.folder === 'string' ? body.folder : undefined;
        const done = build(String(body.code ?? ''), (text) => res.write(text), { port, live: !!body.live }, folder, bodyFiles(body.files));
        if (!done) {
          res.statusCode = 409;
          return res.end('Đang build, chờ lần build trước xong.');
        }
        void done.then((result) => res.end(`\n@@RESULT ${JSON.stringify(result)}\n`));
      });
    }
    if (req.method === 'GET' && path === '/serial') {
      const port = query.get('port') ?? '';
      const baud = Number(query.get('baud') ?? 115200) || 115200;
      if (!port) return next();
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      // Headers now: a board that prints nothing must not leave the app waiting for an answer
      res.flushHeaders();
      let open = true;
      line.open(
        pythonFor(pio()),
        port,
        baud,
        (bytes) => open && res.write(bytes),
        // The stream ends; an error goes last, on a line of its own the app recognises
        (error) => {
          if (!open) return;
          open = false;
          res.end(error ? `\x1eE ${error.replace(/\n/g, ' ')}\n` : undefined);
        },
      );
      req.on('close', () => {
        if (open && line.port === port) void line.close();
        open = false;
      });
      return;
    }
    if (req.method === 'POST' && path === '/serial/write') {
      return readJson(req, res, (body) => {
        line.write(String(body.text ?? ''));
        res.end('ok');
      });
    }
    if (req.method === 'POST' && path === '/serial/reset') {
      line.reset();
      return res.end('ok');
    }
    next();
  }

  /** A lesson's source, as starting code: only from the course's lession/ folder. */
  function lessonSketch(query: URLSearchParams, res: ServerResponse, next: Next) {
    const rel = query.get('path') ?? '';
    const full = normalize(join(opts.projectRoot, rel));
    if (!rel.endsWith('.cpp') || relative(join(opts.projectRoot, 'lession'), full).startsWith('..') || !existsSync(full)) return next();
    send(res, 'text/plain; charset=utf-8', readFileSync(full, 'utf8'));
  }

  /** Linked folders: list, read, write. */
  function folders(req: IncomingMessage, path: string, query: URLSearchParams, res: ServerResponse, next: Next) {
    if (req.method === 'GET' && path === '/api/folders') return send(res, 'application/json', JSON.stringify(findFolders(opts.projectRoot)));
    if (req.method === 'GET' && path === '/api/folder/check') return send(res, 'application/json', JSON.stringify(checkNewFolder(opts.projectRoot, query.get('path') ?? '')));
    if (req.method === 'POST' && path === '/api/folder/link') {
      return readJson(req, res, (body) => {
        const r = linkFolder(opts.projectRoot, String(body.path ?? ''), { title: String(body.title ?? ''), project: body.project ?? null, code: String(body.code ?? '') });
        if (typeof r === 'string') {
          res.statusCode = 400;
          return res.end(r);
        }
        send(res, 'application/json', JSON.stringify(r));
      });
    }
    if (path !== '/api/folder') return next();
    if (req.method === 'DELETE') {
      const dir = folderPath(opts.projectRoot, query.get('path') ?? '');
      if (!dir) return next();
      unlinkFolder(dir);
      return res.end('ok');
    }
    if (req.method === 'GET') {
      const dir = folderPath(opts.projectRoot, query.get('path') ?? '');
      return dir ? send(res, 'application/json', JSON.stringify(readFolder(dir))) : next();
    }
    if (req.method === 'PUT') {
      return readJson(req, res, (body) => {
        const dir = folderPath(opts.projectRoot, String(body.path ?? ''));
        if (!dir) {
          res.statusCode = 404;
          return res.end('Không có thư mục liên kết này.');
        }
        writeFolder(dir, {
          title: typeof body.title === 'string' ? body.title : undefined,
          project: body.project ?? undefined,
          code: typeof body.code === 'string' ? body.code : undefined,
          files: body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? (body.files as Record<string, string | null>) : undefined,
        });
        res.end('ok');
      });
    }
    next();
  }

  /** Connect-style handler: answers the lab's endpoints, passes anything else to `next`. */
  function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
    // Joined, not resolved: a path like "//" would be read as a host and throw
    let url: URL;
    let path: string;
    try {
      url = new URL(`http://lab${req.url ?? '/'}`);
      path = decodeURIComponent(url.pathname);
    } catch {
      return next();
    }
    const under = (prefix: string) => (path === prefix || path.startsWith(prefix + '/') ? path.slice(prefix.length) || '/' : null);
    const pioPath = under('/pio');
    if (pioPath !== null && req.method === 'GET') return pioBuilds(pioPath, url.searchParams, res, next);
    const buildPath = under('/api/build');
    if (buildPath !== null) return sketchBuild(req, buildPath, res, next);
    if (path === '/api/sketch') return lessonSketch(url.searchParams, res, next);
    if (path === '/api/headers' && req.method === 'GET') {
      headers ??= reservedHeaders(env().PLATFORMIO_CORE_DIR || join(homedir(), '.platformio'));
      return send(res, 'application/json', JSON.stringify(headers));
    }
    if (path === '/api/folders' || under('/api/folder') !== null) return folders(req, path, url.searchParams, res, next);
    const devicePath = under('/api/device');
    if (devicePath !== null) return device(req, devicePath, url.searchParams, res, next);
    next();
  }

  return { build, handle };
}
