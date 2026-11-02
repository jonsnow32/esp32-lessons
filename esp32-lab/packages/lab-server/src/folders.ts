// Linked folders: a sketch that lives in its own folder of the course (e.g. home-server/esp32-mqtt)
// and is worked on in the lab as one of "Dự án của tôi". The folder stays the one source: the lab
// reads and writes its main.cpp, keeps the circuit next to it in esp32-lab.json, and builds with
// the folder's other sources (secrets.h…) beside main.cpp, so what the emulator runs is what
// `pio run` in that folder, or the lab's upload, puts on the real board.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

/** Marks a folder as linked; holds the lab's title and circuit for it. */
export const LINK_FILE = 'esp32-lab.json';
export const SKETCH_FILE = 'main.cpp';
/** Copied next to main.cpp for a build. */
const SOURCE = /\.(h|hpp|c|cpp)$/;
/** One folder or file name in a source's path: no dots first, nothing but plain characters. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
/** How deep a source may sit below main.cpp: wifi.h, net/wifi.h… up to a/b/c/x.h. */
const MAX_SOURCE_DEPTH = 4;

/**
 * Can `name` be one of a folder's other sources: a path below main.cpp with forward slashes
 * (net/wifi.cpp), plain names, a C/C++ extension, not main.cpp itself?
 */
export function isSourceName(name: string): boolean {
  const segs = name.split('/');
  return name !== SKETCH_FILE && segs.length <= MAX_SOURCE_DEPTH && segs.every((s) => SEGMENT.test(s) && !SKIP.has(s)) && SOURCE.test(name);
}

/** Remove `dir` and its parents while empty, up to (not including) `root`. */
function pruneEmpty(dir: string, root: string) {
  while (dir !== root && relative(root, dir) && !relative(root, dir).startsWith('..')) {
    try {
      if (readdirSync(dir).length) return;
      rmSync(dir, { recursive: true });
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}
/** Not looked into when finding linked folders. */
const SKIP = new Set(['node_modules', 'target', 'dist', 'build']);
const MAX_DEPTH = 6;

export interface LinkedFolder {
  /** Relative to the course, with forward slashes. */
  path: string;
  title: string;
  /** Last change to main.cpp or the circuit, ms. */
  updated: number;
}

export interface FolderContents {
  title: string;
  /** The lab's circuit; null until the lab first saves one. */
  project: unknown;
  code: string;
  /** The folder's other sources built with main.cpp (secrets.h…): name → text. */
  files: Record<string, string>;
}

/** What linking a folder at a path typed by the user would do, or why it cannot. */
export type FolderCheck =
  | { ok: true; path: string; exists: boolean; hasCode: boolean }
  | { ok: false; path?: string; error: string };

/** The folder's absolute path, or null unless `rel` is a linked folder inside `root`. */
export function folderPath(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0')) return null;
  const full = normalize(join(root, rel));
  const r = relative(root, full);
  if (!r || r.startsWith('..') || r.split(sep).some((s) => s.startsWith('.'))) return null;
  return existsSync(join(full, LINK_FILE)) && existsSync(join(full, SKETCH_FILE)) ? full : null;
}

function readLink(dir: string): { title?: string; project?: unknown } {
  try {
    return JSON.parse(readFileSync(join(dir, LINK_FILE), 'utf8'));
  } catch {
    return {};
  }
}

const titleOf = (dir: string, link: { title?: string }) => (typeof link.title === 'string' && link.title.trim()) || dir.split(sep).pop()!;

/** Every linked folder under `root`, a few levels down. */
export function findFolders(root: string): LinkedFolder[] {
  const out: LinkedFolder[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (dir !== root && names.includes(LINK_FILE) && names.includes(SKETCH_FILE)) {
      const updated = Math.max(statSync(join(dir, LINK_FILE)).mtimeMs, statSync(join(dir, SKETCH_FILE)).mtimeMs);
      out.push({ path: relative(root, dir).split(sep).join('/'), title: titleOf(dir, readLink(dir)), updated: Math.round(updated) });
    }
    if (depth >= MAX_DEPTH) return;
    for (const n of names) {
      if (n.startsWith('.') || SKIP.has(n)) continue;
      const sub = join(dir, n);
      try {
        if (statSync(sub).isDirectory()) walk(sub, depth + 1);
      } catch {}
    }
  };
  walk(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFolder(dir: string): FolderContents {
  const link = readLink(dir);
  return { title: titleOf(dir, link), project: link.project ?? null, code: readFileSync(join(dir, SKETCH_FILE), 'utf8'), files: folderSources(dir) };
}

/**
 * A folder the user typed for a new project: relative to the course, or absolute inside it. It may
 * not exist yet; it must not be linked already, nor be somewhere the lab does not look.
 */
export function checkNewFolder(root: string, input: string): FolderCheck {
  const typed = input.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!typed) return { ok: false, error: 'Nhập đường dẫn thư mục.' };
  if (typed.includes('\0')) return { ok: false, error: 'Đường dẫn không hợp lệ.' };
  const full = normalize(isAbsolute(typed) ? typed : join(root, typed));
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, error: `Thư mục phải nằm trong repo (${root}).` };
  const segs = rel.split(sep);
  const path = segs.join('/');
  if (segs.some((s) => s.startsWith('.') || SKIP.has(s))) return { ok: false, path, error: 'Không dùng thư mục ẩn (bắt đầu bằng dấu chấm), node_modules, build, dist hay target.' };
  if (segs.length > MAX_DEPTH) return { ok: false, path, error: `Tối đa ${MAX_DEPTH} cấp thư mục tính từ repo.` };
  // A parent that is a file, not a folder
  for (let i = 1; i <= segs.length; i++) {
    const at = join(root, ...segs.slice(0, i));
    if (existsSync(at) && !statSync(at).isDirectory()) return { ok: false, path, error: `${segs.slice(0, i).join('/')} là một file, không phải thư mục.` };
  }
  if (existsSync(join(full, LINK_FILE))) return { ok: false, path, error: 'Thư mục này đã là một dự án trong lab.' };
  return { ok: true, path, exists: existsSync(full), hasCode: existsSync(join(full, SKETCH_FILE)) };
}

/**
 * Make the folder a project of the lab: created if need be, main.cpp kept if it is there (else
 * `code`), title and circuit in esp32-lab.json. Returns what the folder now holds.
 */
export function linkFolder(root: string, input: string, init: { title: string; project: unknown; code: string }): (FolderContents & { path: string }) | string {
  const c = checkNewFolder(root, input);
  if (!c.ok) return c.error;
  const dir = join(root, ...c.path.split('/'));
  mkdirSync(dir, { recursive: true });
  if (!c.hasCode) writeFileSync(join(dir, SKETCH_FILE), init.code);
  writeFileSync(join(dir, LINK_FILE), JSON.stringify({ title: init.title, project: init.project }, null, 2) + '\n');
  return { ...readFolder(dir), path: c.path };
}

/** No longer a project of the lab: esp32-lab.json (the circuit) goes, main.cpp and the rest stay. */
export function unlinkFolder(dir: string) {
  rmSync(join(dir, LINK_FILE), { force: true });
}

/**
 * Write what changed: the code to main.cpp, the other sources by name (null: delete that file),
 * title and circuit to esp32-lab.json. A name that is not a plain source name is left alone.
 */
export function writeFolder(dir: string, change: { title?: string; project?: unknown; code?: string; files?: Record<string, string | null> }) {
  if (typeof change.code === 'string') {
    const file = join(dir, SKETCH_FILE);
    if (readFileSync(file, 'utf8') !== change.code) writeFileSync(file, change.code);
  }
  for (const [name, text] of Object.entries(change.files ?? {})) {
    if (!isSourceName(name)) continue;
    const file = join(dir, ...name.split('/'));
    if (text === null) {
      rmSync(file, { force: true });
      pruneEmpty(dirname(file), dir);
    } else if (typeof text === 'string' && (!existsSync(file) || readFileSync(file, 'utf8') !== text)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  }
  if (change.title !== undefined || change.project !== undefined) {
    const link = readLink(dir);
    const next = { ...link, ...(change.title !== undefined && { title: change.title }), ...(change.project !== undefined && { project: change.project }) };
    const text = JSON.stringify(next, null, 2) + '\n';
    const file = join(dir, LINK_FILE);
    if (readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  }
}

/** The folder's sources besides main.cpp (secrets.h…, net/wifi.cpp…), by path, to build with. */
export function folderSources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (sub: string[]) => {
    for (const n of readdirSync(join(dir, ...sub)).sort()) {
      const rel = [...sub, n];
      const full = join(dir, ...rel);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (rel.length < MAX_SOURCE_DEPTH && SEGMENT.test(n) && !SKIP.has(n)) walk(rel);
      } else if (st.isFile() && isSourceName(rel.join('/'))) out[rel.join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk([]);
  return out;
}
