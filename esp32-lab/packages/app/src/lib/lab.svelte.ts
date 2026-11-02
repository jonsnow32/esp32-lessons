// Application state: the project being edited, selection, and the latest simulation state
// from the worker. Components read and mutate this; edits are pushed to the worker.

import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { SCHEMA_VERSION, type BoardPin, type Endpoint, type PartInstance, type Project, type Rotation, type Wire } from '@esp32lab/project-model';
import { endpointKey, keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import wasmUrl from '../../../mcu-esp32/wasm/esp32.wasm?url';
import { BOARDS, BREADBOARDS, FEATURED, LESSONS, PARTS, type FeaturedProject } from './catalog';
import type { Note } from '@esp32lab/explain';
import type { PartManifest } from '@esp32lab/part-sdk';
import type { FirmwareFiles, FlowView, FromWorker, StepResult, ToWorker } from '../sim/protocol';
import { resolvePlacement, rotate } from '@esp32lab/project-model';
import { boardBox, breadboard, breadboardBox, type Box } from './geometry';
import { loadSettings, saveSettings } from './settings';
import { TIDY_MODES, tidyWires } from './tidy';
import { unplugBreadboard } from './wiring';
import { LiveDecoder } from './live';
import { applyChange, autoPlug, type CircuitChange } from './autoplug';
import { arrange } from './arrange';
import { duplicate, sameItem, shiftGroup, type Item } from './group';

export interface BuildError {
  /** The source it is in: main.cpp, or another file of a linked folder. */
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

/** The editor's main file; a linked folder's other sources are in `lab.files`. */
export const MAIN_FILE = 'main.cpp';
/** A name another source beside main.cpp may have: plain, no folders (as lab-server isSourceName). */
export const isSourceName = (name: string) => name !== MAIN_FILE && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(h|hpp|c|cpp)$/.test(name);
/** Holds passwords (secrets.h…): open in the editor, never sent to the assistant. */
export const isSecretFile = (name: string) => /secret|passw|credential/i.test(name);

/** Starting text of a new source file. */
function newFileText(name: string): string {
  return /\.(h|hpp)$/.test(name) ? '#pragma once\n\n#include <Arduino.h>\n\n' : `#include <Arduino.h>\n\n`;
}

const DEFAULT_SKETCH = `// Viết code Arduino ở đây rồi bấm ▶ Build & Run
#include <Arduino.h>

const int LED_PIN = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Xin chao ESP32!");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`;

export function emptyProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    board: { type: 'esp32-devkit-v1', x: 1, y: 3 },
    breadboards: [{ id: 'bb1', type: 'half-400', x: 15, y: 6 }],
    parts: [],
    wires: [],
    firmware: { kind: 'none' },
    seed: 1,
  };
}

/** One thing, or several picked together (see group.ts). */
type Selection = Item | { kind: 'group'; items: Item[] } | null;

const WIRE_COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f5d90a', '#f76b15', '#8e4ec6', '#1c2024'];

/** What the emulated board is running, so the UI can always say it plainly. */
/** A real ESP32 on a USB port (see lab-server/src/device.ts and live.ts). */
export interface DeviceState {
  /** The lab's server can reach USB ports (the desktop app, the dev server; not a static web build). */
  available: boolean;
  ports: { port: string; description: string; likely: boolean }[];
  port: string;
  /** uploading: build and flash; live: the bench follows the real board. */
  status: 'idle' | 'uploading' | 'connecting' | 'live';
  /** What the last upload was for. */
  live: boolean;
  log: string;
  /** The probe on the board said hello: it runs a live build. */
  probe: boolean;
  error: string | null;
}

export type Program =
  | { kind: 'none' }
  | { kind: 'sketch'; codeHash: string; at: number; ms: number }
  | { kind: 'prebuilt'; env: string; codeHash?: string; at: number };

/** One lesson's (or the sandbox's) saved work. */
interface Workspace {
  project: Project;
  code: string;
  /** Steps ever passed, for the progress shown on the lesson cards. */
  passed: string[];
}

export const FREE = 'free';

/** A project of the user's own: a copy of a featured project they changed, or a blank bench. */
export interface MyProject {
  id: string;
  title: string;
  /** The featured project it was copied from; none for a project started from a blank bench. */
  from?: string;
  /** The bench as the new-bench steps set it up (board, breadboard, parts), to go back to. */
  start?: Project;
  /**
   * A linked folder of the course (e.g. home-server/esp32-mqtt): its main.cpp and esp32-lab.json
   * on disk are the project; what is in the browser is only a copy for the cards.
   */
  folder?: string;
  created: number;
  updated: number;
}

const MY_PROJECTS = 'esp32lab.myProjects';

function loadMyProjects(): MyProject[] {
  try {
    return JSON.parse(localStorage.getItem(MY_PROJECTS) ?? '[]') as MyProject[];
  } catch {
    return [];
  }
}

/** FNV-1a: cheap fingerprint to tell whether the code changed since it was built. */
function hashCode(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** The fingerprint of main.cpp and the other sources built with it. */
function hashSources(code: string, files: Record<string, string>): string {
  const names = Object.keys(files).sort();
  return hashCode(names.length ? [code, ...names.flatMap((n) => [n, files[n]!])].join('\0') : code);
}

const wsKey = (id: string) => `esp32lab.ws.${id}`;

/** A linked folder as the server lists it (see lab-server folders.ts). */
interface LinkedFolder {
  path: string;
  title: string;
  updated: number;
}

/** The id a linked folder goes by, also in the address bar: home-server/esp32-mqtt → my-dir-home-server-esp32-mqtt. */
const folderId = (path: string) => `my-dir-${path.replace(/[^A-Za-z0-9_-]+/g, '-')}`;

/** What to write to a linked folder: main.cpp, other sources (null: delete), the circuit, the title. */
type FolderChange = { title?: string; project?: Project; code?: string; files?: Record<string, string | null> };

/** How long after the last change a linked folder's files are written. */
const FOLDER_WRITE_MS = 400;

/** Featured projects stay as published: does this bench and code still match the original? */
function isOriginal(f: FeaturedProject, project: Project, code: string): boolean {
  return code === f.code && JSON.stringify(project) === JSON.stringify(f.project);
}

/** "Đèn giao thông (bản sao)", then "(bản sao 2)"… */
function copyTitle(base: string, taken: MyProject[]): string {
  for (let n = 1; ; n++) {
    const title = `${base} (bản sao${n > 1 ? ` ${n}` : ''})`;
    if (!taken.some((p) => p.title === title)) return title;
  }
}

/** "Dự án mới", then "Dự án mới 2"… */
function newTitle(taken: MyProject[]): string {
  for (let n = 1; ; n++) {
    const title = `Dự án mới${n > 1 ? ` ${n}` : ''}`;
    if (!taken.some((p) => p.title === title)) return title;
  }
}

export function loadWorkspace(id: string): Workspace | null {
  try {
    const raw = localStorage.getItem(wsKey(id));
    return raw ? (JSON.parse(raw) as Workspace) : null;
  } catch {
    return null;
  }
}

/** What the new-bench steps chose (see NewBench.svelte). */
export interface BenchSetup {
  title: string;
  board: string;
  /** A breadboard type, or null for none: the parts are then wired straight to the board. */
  breadboard: string | null;
  /** Part types, once per part wanted. */
  parts: string[];
  /** Plug each part in the way its manifest says (see autoplug.ts). */
  plug: boolean;
  /** A folder of the course to keep the project in (see MyProject.folder); none: in the browser. */
  folder?: string;
}

/**
 * The bench a setup asks for: the board, the breadboard beside it, and the parts laid in a row
 * below them (or beside the board when there is no breadboard), each in its own icon frame.
 */
function setupProject(setup: BenchSetup): Project {
  const project = emptyProject();
  project.board = { ...project.board, type: setup.board };
  project.breadboards = setup.breadboard ? [{ id: 'bb1', type: setup.breadboard, x: 15, y: 6 }] : [];
  const bb = setup.breadboard && breadboardBox(setup.breadboard);
  const b = boardBox(BOARDS[setup.board]!);
  const left = setup.breadboard ? project.board.x + b.x : 15;
  let x = left;
  let y = setup.breadboard ? Math.max(project.board.y + b.y + b.h, bb ? 6 + bb.y + bb.h : 0) + 2 : project.board.y + b.y;
  let rowH = 0;
  for (const type of setup.parts) {
    const [ix, iy, iw, ih] = (PARTS[type]?.icon ?? '-1 -3 6 6.5').split(/[\s,]+/).map(Number) as [number, number, number, number];
    if (x > left && x + iw > left + 48) {
      x = left;
      y += rowH + 1;
      rowH = 0;
    }
    const n = project.parts.filter((p) => p.type === type).length + 1;
    project.parts.push({ id: `${type}${n}`, type, props: {}, placement: null, bench: { x: Math.round(x - ix), y: Math.round(y - iy), rot: 0 } });
    x += iw + 1;
    rowH = Math.max(rowH, ih);
  }
  return project;
}

/** Undo steps kept per workspace. */
const HISTORY = 100;

/** Leg wires of a part pulled off the breadboard: red for the first leg, then black, etc. */
const LEAD_COLORS = ['#e5484d', '#1f2023', '#f5d90a', '#3e63dd'];

/** Does the wire end on one of this part's legs? */
const onPart = (w: Wire, id: string) => (w.a.kind === 'part' && w.a.part === id) || (w.b.kind === 'part' && w.b.part === id);

class Lab {
  /** 'home' (lesson picker), a lesson id, or FREE. */
  route = $state<string>('home');
  project = $state<Project>(emptyProject());
  selection = $state<Selection>(null);
  /** The user's own projects, newest first. */
  myProjects = $state<MyProject[]>(loadMyProjects());
  /** One-off message for the user (e.g. "a copy was made"), dismissed by them. */
  notice = $state<string | null>(null);
  /** Detail page open over everything else: a part type, `board:<type>`, `bb:<type>` or 'inventory'. */
  docPage = $state<string | null>(null);
  /** Undo/redo: earlier and undone versions of the bench, as JSON. */
  private past = $state<string[]>([]);
  private future = $state<string[]>([]);
  /** The bench as last committed, and what changed it (see commit). */
  private current = '';
  private lastChange: string | undefined;
  lessonId = $state<string | null>(null);
  envs = $state<string[]>([]);
  program = $state<Program>({ kind: 'none' });
  /** The lesson's original sketch, to know when a prebuilt .pio build still matches. */
  originalCode = $state<string | null>(null);
  passed = $state<string[]>([]);
  running = $state(false);
  speed = $state(1);
  t = $state(0);
  rate = $state(0);
  observables = $state<Record<string, Record<string, number | string | boolean>>>({});
  diagnostics = $state<{ severity: string; message: string; part?: string }[]>([]);
  steps = $state<StepResult[]>([]);
  halted = $state<string | null>(null);
  serial = $state('');
  device = $state<DeviceState>({ available: false, ports: [], port: '', status: 'idle', live: false, log: '', probe: false, error: null });
  /** Ends the live serial line. */
  private liveAbort: AbortController | null = null;
  error = $state<string | null>(null);
  flows = $state<FlowView[]>([]);
  terminalCurrents = $state<Record<string, Record<string, number>>>({});
  voltages = $state<Record<string, number | null>>({});
  notes = $state<Note[]>([]);
  /** Keys / part ids to emphasise on the bench (hovered explanation note). */
  emphasis = $state<string[]>([]);
  /** The user's settings as they were stored (see settings.ts); the fields below start from them. */
  private settings = loadSettings();
  /** How the bench shows the solved circuit. */
  overlay = $state(this.settings.overlay);
  /** Whether the circuit is locked while the program runs (see locked()). */
  lockWhileRunning = $state(this.settings.lockWhileRunning);
  /** Static netlist for hover highlighting (no simulation). */
  netKernel = $derived.by(() => this.buildNetKernel(this.project));

  private worker: Worker;
  private nextWire = 0;
  /** A linked folder's write waiting for the edits to settle. */
  private folderWrite: { timer: ReturnType<typeof setTimeout>; change: FolderChange; send: () => void } | null = null;
  /** The linked folder's main.cpp as last read or written, to notice an edit made outside the lab. */
  private diskCode: string | null = null;
  /** The linked folder's circuit as opened, for "back to how it was". */
  private folderStart: Project | null = null;
  /** The linked folder's other sources as last read or written: name → text. */
  private diskFiles: Record<string, string> = {};
  /** The linked folder's other sources as opened, for "back to how it was". */
  private originalFiles: Record<string, string> = {};
  /** The linked folder's other sources built with main.cpp (secrets.h…), as in the editor: name → text. */
  files = $state<Record<string, string>>({});
  /** The file shown in the editor: main.cpp or one of `files`. */
  activeFile = $state(MAIN_FILE);

  /** The linked folder's other sources, by name. */
  get folderFiles(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Can this project have files besides main.cpp (a linked folder the server could read)? */
  get multiFile(): boolean {
    return !!this.mine?.folder && this.diskCode !== null;
  }

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    this.send({ type: 'init', wasmUrl });
    migrateOldStorage();
    this.myProjects = loadMyProjects();
    // Keep the user's settings in the browser as they change
    $effect.root(() => {
      $effect(() => saveSettings({ wireMode: TIDY_MODES[this.tidyMode]?.id ?? null, overlay: this.overlay, lockWhileRunning: this.lockWhileRunning }));
    });
    void this.refreshPorts();
    void this.syncFolders();
    // Back from the editor: main.cpp may have changed there
    window.addEventListener('focus', () => void this.reloadFolderCode());
    fetch('/pio/envs')
      .then((r) => r.json())
      .then((envs: string[]) => (this.envs = envs))
      .catch(() => (this.envs = []));
  }

  private buildNetKernel(project: Project) {
    try {
      const board = BOARDS[project.board.type]!;
      return new SimKernel({ project, board, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });
    } catch {
      return null;
    }
  }

  send(m: ToWorker) {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker) {
    if (m.type === 'state') {
      this.t = m.t;
      this.rate = m.rate;
      this.running = m.running;
      this.observables = m.observables as never;
      this.diagnostics = m.diagnostics;
      this.steps = m.steps;
      this.halted = m.halted;
      this.flows = m.flows;
      this.terminalCurrents = m.terminalCurrents;
      this.voltages = m.voltages;
      this.notes = m.notes;
      const newly = m.steps.filter((x) => x.pass && !this.passed.includes(x.id)).map((x) => x.id);
      if (newly.length) {
        this.passed = [...this.passed, ...newly];
        this.save();
      }
    } else if (m.type === 'serial') {
      this.serial = (this.serial + m.text).slice(-20000);
    } else {
      this.error = m.message;
    }
  }

  /**
   * Push the edited project to the worker, save the workspace and record the previous version
   * for undo. Consecutive commits with the same `change` key (dragging a slider) are one step.
   */
  commit(change?: string) {
    const snapshot = $state.snapshot(this.project) as Project;
    const json = JSON.stringify(snapshot);
    if (json !== this.current) {
      if (this.current && !(change && change === this.lastChange)) {
        this.past = [...this.past.slice(-(HISTORY - 1)), this.current];
      }
      this.future = [];
      this.current = json;
    }
    this.lastChange = change;
    this.save();
    this.send({ type: 'project', project: snapshot });
  }

  /** The circuit cannot be edited now: the program runs and the user asked for the lock. */
  get editLocked() {
    return this.running && this.lockWhileRunning;
  }

  /** While the lock is on, say why and refuse the edit. */
  locked(): boolean {
    if (!this.editLocked) return false;
    this.notice = 'Chương trình đang chạy: tạm dừng nó rồi mới di chuyển hay sửa mạch được.';
    return true;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    if (this.locked()) return;
    const prev = this.past.at(-1);
    if (prev === undefined) return;
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, this.current];
    this.restore(prev);
  }

  redo() {
    if (this.locked()) return;
    const next = this.future.at(-1);
    if (next === undefined) return;
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, this.current];
    this.restore(next);
  }

  private restore(json: string) {
    this.current = json;
    this.lastChange = undefined;
    this.project = JSON.parse(json) as Project;
    // Keep the selection only as far as what it points at still exists
    this.select(this.selected.filter((i) => this.exists(i)));
    this.save();
    this.send({ type: 'project', project: $state.snapshot(this.project) as Project });
  }

  private save() {
    if (this.route === 'home') return;
    const project = $state.snapshot(this.project) as Project;
    const featured = this.featured;
    if (featured) {
      // The original is never saved over: the first change turns it into the user's own copy
      if (isOriginal(featured, project, this.code)) return;
      this.copyFeatured(featured);
    }
    const ws: Workspace = { project, code: this.code, passed: this.passed };
    const json = JSON.stringify(ws);
    const changed = localStorage.getItem(wsKey(this.route)) !== json;
    localStorage.setItem(wsKey(this.route), json);
    const mine = this.mine;
    if (mine) this.updateMyProjects(this.myProjects.map((p) => (p.id === mine.id ? { ...p, updated: Date.now() } : p)));
    // Into the folder only what changed: opening it writes nothing
    if (mine?.folder) {
      const files = this.changedFiles();
      if (changed || files) this.writeFolder(mine.folder, { ...(changed && { project, code: this.code }), ...(files && { files }) });
    }
  }

  /** The other sources edited in the lab since last read or written, or null. */
  private changedFiles(): Record<string, string> | null {
    const out: Record<string, string> = {};
    for (const [n, t] of Object.entries(this.files)) if (this.diskFiles[n] !== t) out[n] = t;
    return Object.keys(out).length ? out : null;
  }

  // --- Linked folders ----------------------------------------------------------------------

  /** The linked folders on disk as projects of the user's own: new ones added, gone ones dropped. */
  async syncFolders() {
    let found: LinkedFolder[];
    try {
      const r = await fetch('/api/folders', { cache: 'no-store' });
      if (!r.ok) return;
      found = await r.json();
    } catch {
      return;
    }
    const byId = new Map(found.map((f) => [folderId(f.path), f]));
    const kept = this.myProjects.filter((p) => !p.folder || byId.has(p.id));
    for (const p of this.myProjects) if (!kept.includes(p)) localStorage.removeItem(wsKey(p.id));
    const list = kept.map((p) => {
      const f = p.folder ? byId.get(p.id) : undefined;
      return f ? { ...p, title: f.title, folder: f.path, updated: Math.max(p.updated, f.updated) } : p;
    });
    for (const [id, f] of byId) {
      if (!list.some((p) => p.id === id)) list.push({ id, title: f.title, folder: f.path, created: f.updated, updated: f.updated });
    }
    this.updateMyProjects(list);
    // Thumbnails on the cards come from the copy in the browser: read the folders not yet copied
    for (const p of list) {
      if (p.folder && !loadWorkspace(p.id)) void this.readFolder(p.folder).then((c) => c && localStorage.setItem(wsKey(p.id), JSON.stringify({ project: c.project, code: c.code, passed: [] } satisfies Workspace)));
    }
  }

  /** A linked folder's circuit and code from disk, or null if the server cannot give them. */
  private async readFolder(path: string): Promise<(Workspace & { files: Record<string, string> }) | null> {
    try {
      const r = await fetch(`/api/folder?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const c = (await r.json()) as { project: Project | null; code: string; files?: Record<string, string> };
      return { project: c.project ?? emptyProject(), code: c.code, passed: [], files: c.files && !Array.isArray(c.files) ? c.files : {} };
    } catch {
      return null;
    }
  }

  /** Write to a linked folder once the edits settle; a later change for it replaces this one. */
  private writeFolder(path: string, change: FolderChange) {
    const prev = this.folderWrite;
    if (prev) clearTimeout(prev.timer);
    const files = prev?.change.files || change.files ? { ...prev?.change.files, ...change.files } : undefined;
    const merged = { ...prev?.change, ...change, ...(files && { files }) };
    if (typeof change.code === 'string') this.diskCode = change.code;
    for (const [n, t] of Object.entries(change.files ?? {})) {
      if (t === null) delete this.diskFiles[n];
      else this.diskFiles[n] = t;
    }
    const send = () => {
      this.folderWrite = null;
      void fetch('/api/folder', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, ...merged }) })
        .then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
        })
        .catch((e) => (this.error = `Không ghi được vào thư mục ${path}: ${e instanceof Error ? e.message : String(e)}`));
    };
    this.folderWrite = { timer: setTimeout(send, FOLDER_WRITE_MS), change: merged, send };
  }

  /** Write a waiting change to the linked folder now. */
  private flushFolder() {
    const w = this.folderWrite;
    if (!w) return;
    clearTimeout(w.timer);
    w.send();
  }

  /**
   * Sources of the linked folder on the bench changed on disk (another editor): take each one,
   * files added or deleted there too, unless the lab has edits to it not yet written.
   */
  async reloadFolderCode() {
    const mine = this.mine;
    if (!mine?.folder || this.folderWrite || this.diskCode === null) return;
    const id = mine.id;
    const disk = await this.readFolder(mine.folder);
    if (!disk || this.route !== id || this.folderWrite) return;
    const taken: string[] = [];
    if (disk.code !== this.diskCode && this.code === this.diskCode) {
      this.diskCode = disk.code;
      this.code = disk.code;
      this.originalCode = disk.code;
      taken.push(MAIN_FILE);
    }
    for (const n of new Set([...Object.keys(disk.files), ...Object.keys(this.diskFiles)])) {
      const was = this.diskFiles[n];
      const now = disk.files[n];
      if (was === now || this.files[n] !== was) continue;
      if (now === undefined) {
        delete this.files[n];
        delete this.diskFiles[n];
        delete this.originalFiles[n];
        if (this.activeFile === n) this.activeFile = MAIN_FILE;
      } else {
        this.files[n] = now;
        this.diskFiles[n] = now;
        this.originalFiles[n] = now;
      }
      taken.push(n);
    }
    if (!taken.length) return;
    this.save();
    this.notice = `${taken.join(', ')} trong ${mine.folder} vừa được sửa ở ngoài lab: mình đã nạp lại.`;
  }

  /** The text of a source in the editor: main.cpp or another file of the linked folder. */
  fileText(name: string): string | undefined {
    return name === MAIN_FILE ? this.code : this.files[name];
  }

  /** Edit a source: main.cpp, or another file of the linked folder (made if it is not there yet). */
  setFile(name: string, text: string): string | null {
    if (name === MAIN_FILE) {
      this.setCode(text);
      return null;
    }
    if (!(name in this.files)) return this.addFile(name, text);
    this.files[name] = text;
    this.save();
    return null;
  }

  /** Why a new source cannot have this name, or null if it can. */
  checkFileName(name: string, except?: string): string | null {
    if (!this.multiFile) return 'Chỉ dự án lưu trong một thư mục của repo mới có nhiều file.';
    if (!isSourceName(name)) return 'Tên file chỉ gồm chữ, số, _ . - và có đuôi .h, .hpp, .c hoặc .cpp (không có thư mục).';
    if (name !== except && (name in this.files || name.toLowerCase() === MAIN_FILE)) return `Đã có file ${name}.`;
    return null;
  }

  /** A new source beside main.cpp, opened in the editor. Null, or why it cannot be made. */
  addFile(name: string, text = newFileText(name)): string | null {
    const bad = this.checkFileName(name);
    if (bad) return bad;
    this.files[name] = text;
    this.activeFile = name;
    this.save();
    return null;
  }

  /** Delete a source of the linked folder, on disk too. */
  removeFile(name: string) {
    const folder = this.mine?.folder;
    if (!folder || !(name in this.files)) return;
    delete this.files[name];
    delete this.originalFiles[name];
    if (this.activeFile === name) this.activeFile = MAIN_FILE;
    this.writeFolder(folder, { files: { [name]: null } });
    this.flushFolder();
  }

  /** Rename a source of the linked folder, on disk too (the #include lines that use it stay as they are). */
  renameFile(from: string, to: string): string | null {
    const folder = this.mine?.folder;
    if (!folder || !(from in this.files)) return null;
    if (from === to) return null;
    const bad = this.checkFileName(to, from);
    if (bad) return bad;
    const text = this.files[from]!;
    delete this.files[from];
    this.files[to] = text;
    if (this.activeFile === from) this.activeFile = to;
    this.writeFolder(folder, { files: { [from]: null, [to]: text } });
    this.flushFolder();
    return null;
  }

  /** Carry on in a new project of the user's own, with the bench, code and history as they are. */
  private copyFeatured(f: FeaturedProject) {
    const now = Date.now();
    const copy: MyProject = { id: `my-${now.toString(36)}`, title: copyTitle(f.title, this.myProjects), from: f.id, created: now, updated: now };
    this.updateMyProjects([copy, ...this.myProjects]);
    this.route = copy.id;
    this.notice = `Bạn vừa sửa dự án mẫu, nên mình đã tạo bản sao "${copy.title}" trong Dự án của tôi. Bản gốc vẫn giữ nguyên.`;
  }

  private updateMyProjects(list: MyProject[]) {
    this.myProjects = list.sort((a, b) => b.updated - a.updated);
    localStorage.setItem(MY_PROJECTS, JSON.stringify(this.myProjects));
  }

  /** A free name for a new project: "Dự án mới", then "Dự án mới 2"… */
  get nextTitle() {
    return newTitle(this.myProjects);
  }

  /**
   * Start a project of the user's own on the bench the setup asks for, and open it. Parts that
   * cannot be plugged in on their own stay on the bench, and the notice says which.
   */
  async newMyProject(setup: BenchSetup) {
    let project = setupProject(setup);
    const plugged: string[] = [];
    const left: string[] = [];
    if (setup.plug) {
      for (const { id, type } of [...project.parts]) {
        if (!PARTS[type]?.manifest.plug) continue;
        const r = autoPlug(project, id, (q) => this.buildNetKernel(q));
        if (r.ok) {
          project = r.project;
          plugged.push(id);
        } else left.push(`${id} (${r.reason})`);
      }
    }
    if (!(await this.createMyProject(setup.title, project, DEFAULT_SKETCH, setup.folder))) return;
    if (left.length) this.notice = `Đã cắm ${plugged.length}/${plugged.length + left.length} linh kiện. Chưa cắm được: ${left.join('; ')}. Các linh kiện này nằm trên bàn, bạn tự nối dây nhé.`;
  }

  /** A project of the user's own on this bench and code, opened. */
  /**
   * A project of the user's own on this bench and code, opened; with `folder`, kept in that folder
   * of the course (created if need be; a main.cpp already there is kept as the code). False if the
   * folder could not be set up, with `error` saying why.
   */
  async createMyProject(title: string, project: Project, code = DEFAULT_SKETCH, folder?: string): Promise<boolean> {
    const now = Date.now();
    const name = title.trim() || newTitle(this.myProjects);
    let p: MyProject = { id: `my-${now.toString(36)}`, title: name, created: now, updated: now, start: project };
    if (folder?.trim()) {
      let linked: { path: string; code: string };
      try {
        const r = await fetch('/api/folder/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: folder, title: name, project, code }) });
        if (!r.ok) throw new Error(await r.text());
        linked = await r.json();
      } catch (e) {
        this.error = `Không tạo được dự án trong thư mục ${folder}: ${e instanceof Error ? e.message : String(e)}`;
        return false;
      }
      p = { ...p, id: folderId(linked.path), folder: linked.path };
      if (linked.code !== code) this.notice = `Thư mục ${linked.path} đã có main.cpp: dự án dùng code đó, không thay bằng code mới.`;
      code = linked.code;
    }
    localStorage.setItem(wsKey(p.id), JSON.stringify({ project, code, passed: [] } satisfies Workspace));
    this.updateMyProjects([p, ...this.myProjects.filter((x) => x.id !== p.id)]);
    await this.open(p.id);
    return true;
  }

  /** Can a new project live in this folder (see lab-server checkNewFolder)? */
  async checkFolder(path: string): Promise<{ ok: true; path: string; exists: boolean; hasCode: boolean } | { ok: false; error: string }> {
    try {
      const r = await fetch(`/api/folder/check?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error();
      return await r.json();
    } catch {
      return { ok: false, error: 'Không hỏi được server của lab (lưu vào thư mục chỉ có khi chạy lab trên máy này).' };
    }
  }

  /** A new bench with this board and breadboard, `change` made on it (see applyChange); nothing is saved. */
  planBench(board: string, bb: string | null, change: CircuitChange) {
    return applyChange(setupProject({ title: '', board, breadboard: bb, parts: [], plug: false }), change, (p) => this.buildNetKernel(p));
  }

  renameMyProject(id: string, title: string) {
    const t = title.trim();
    if (!t) return;
    this.updateMyProjects(this.myProjects.map((p) => (p.id === id ? { ...p, title: t } : p)));
    const folder = this.myProjects.find((p) => p.id === id)?.folder;
    if (folder) void fetch('/api/folder', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: folder, title: t }) });
  }

  /** Gone from the lab. A linked folder loses esp32-lab.json (the circuit); main.cpp and the rest stay. */
  async deleteMyProject(id: string) {
    const folder = this.myProjects.find((p) => p.id === id)?.folder;
    if (folder) {
      if (this.route === id) this.flushFolder();
      const r = await fetch(`/api/folder?path=${encodeURIComponent(folder)}`, { method: 'DELETE' }).catch(() => null);
      if (!r?.ok) {
        this.error = `Không xoá được esp32-lab.json trong ${folder}${r ? `: ${await r.text()}` : ' (server của lab có đang chạy?)'}.`;
        return;
      }
    }
    this.updateMyProjects(this.myProjects.filter((p) => p.id !== id));
    localStorage.removeItem(wsKey(id));
  }

  // --- Selection ------------------------------------------------------------------------------

  /** The selection as a list: nothing, one thing or a group. */
  get selected(): Item[] {
    const s = this.selection;
    return !s ? [] : s.kind === 'group' ? s.items : [s];
  }

  isSelected(item: Item): boolean {
    return this.selected.some((i) => sameItem(i, item));
  }

  /** Select these: one thing, or a group of several. */
  select(items: Item[]) {
    this.selection = items.length > 1 ? { kind: 'group', items } : (items[0] ?? null);
  }

  /** Add a thing to the selection, or take it out if it is in (Shift+click). */
  toggleSelect(item: Item) {
    const now = this.selected;
    this.select(now.some((i) => sameItem(i, item)) ? now.filter((i) => !sameItem(i, item)) : [...now, item]);
  }

  /** Everything on the bench, the board too. */
  selectAll() {
    this.select([
      { kind: 'board' },
      ...this.project.breadboards.map((b) => ({ kind: 'breadboard' as const, id: b.id })),
      ...this.project.parts.map((p) => ({ kind: 'part' as const, id: p.id })),
      ...this.project.wires.map((w) => ({ kind: 'wire' as const, id: w.id })),
    ]);
  }

  private exists(i: Item): boolean {
    if (i.kind === 'board') return true;
    if (i.kind === 'part') return !!this.part(i.id);
    if (i.kind === 'wire') return this.project.wires.some((w) => w.id === i.id);
    return this.project.breadboards.some((b) => b.id === i.id);
  }

  /** Move what is selected by whole pitches (arrow keys). Refused when a part would not fit. */
  moveSelected(dx: number, dy: number) {
    if (!this.selected.length || this.locked()) return;
    const { project, ok } = shiftGroup($state.snapshot(this.project) as Project, this.selected, dx, dy);
    if (!ok) return;
    this.project = project;
    this.retidy();
    this.commit();
  }

  /** Copy what is selected beside it, and select the copy (Ctrl+D). */
  duplicateSelected() {
    if (this.locked()) return;
    const copy = duplicate($state.snapshot(this.project) as Project, this.selected);
    if (!copy) {
      if (this.selected.some((i) => i.kind === 'part' || i.kind === 'breadboard')) this.notice = 'Không còn chỗ trống gần đó để đặt bản sao.';
      return;
    }
    this.project = copy.project;
    this.select(copy.items);
    this.commit();
  }

  // --- Editing ----------------------------------------------------------------------------

  canPlace(type: string, bb: string, hole: string, rot: Rotation, ignore?: string): boolean {
    const manifest = PARTS[type]?.manifest;
    const inst = this.project.breadboards.find((b) => b.id === bb);
    const ex = inst && breadboard(inst.type);
    if (!manifest || !ex) return false;
    const placed = resolvePlacement(ex, manifest, hole, rot);
    if (!placed.ok) return false;
    // A hole takes one leg
    const taken = new Set<string>();
    for (const p of this.project.parts) {
      if (p.id === ignore || !p.placement || p.placement.bb !== bb) continue;
      const m = PARTS[p.type]?.manifest;
      const r = m && resolvePlacement(ex, m, p.placement.hole, p.placement.rot);
      if (r?.ok) Object.values(r.holes).forEach((h) => taken.add(h));
    }
    return Object.values(placed.holes).every((h) => !taken.has(h));
  }

  private newPartId(type: string): string {
    const n = this.project.parts.filter((p) => p.type === type).length + 1;
    let id = `${type}${n}`;
    while (this.project.parts.some((p) => p.id === id)) id += "'";
    return id;
  }

  addPart(type: string, bb: string, hole: string, rot: Rotation = 0) {
    if (this.locked()) return;
    const id = this.newPartId(type);
    this.project.parts.push({ id, type, props: {}, placement: { bb, hole, rot } });
    this.selection = { kind: 'part', id };
    this.commit();
  }

  /** A new part lying on the bench, off the breadboard: wire its legs directly. */
  addPartOnBench(type: string, x: number, y: number, rot: Rotation = 0) {
    if (this.locked()) return;
    const id = this.newPartId(type);
    this.project.parts.push({ id, type, props: {}, placement: null, bench: { x, y, rot } });
    this.selection = { kind: 'part', id };
    this.commit();
  }

  /**
   * Plug a part into the breadboard. A part coming from the bench leaves its leg wires behind:
   * on the breadboard its legs connect through the holes.
   */
  movePart(id: string, bb: string, hole: string, rot?: Rotation) {
    if (this.locked()) return;
    const p = this.part(id);
    if (!p) return;
    const was = p.placement ?? p.bench;
    p.placement = { bb, hole, rot: rot ?? was?.rot ?? 0 };
    if (p.bench) {
      delete p.bench;
      this.project.wires = this.project.wires.filter((w) => !onPart(w, id));
    }
    this.commit();
  }

  /**
   * Put a part on the bench. Pulled out of the breadboard, it keeps its connections: a wire runs
   * from each hole a leg was in to that leg, as if it were on jumper leads.
   */
  benchPart(id: string, x: number, y: number, rot: Rotation) {
    if (this.locked()) return;
    const p = this.part(id);
    const manifest = p && PARTS[p.type]?.manifest;
    if (!p || !manifest) return;
    if (p.placement) {
      const inst = this.project.breadboards.find((b) => b.id === p.placement!.bb);
      const ex = inst && breadboard(inst.type);
      const placed = ex && resolvePlacement(ex, manifest, p.placement.hole, p.placement.rot);
      if (placed?.ok) {
        manifest.terminals.forEach((t, k) => {
          this.project.wires.push({
            id: `w${Date.now().toString(36)}${this.nextWire++}`,
            a: { kind: 'hole', bb: p.placement!.bb, hole: placed.holes[t.name]! },
            b: { kind: 'part', part: id, terminal: t.name },
            color: LEAD_COLORS[k % LEAD_COLORS.length],
          });
        });
      }
      p.placement = null;
    }
    p.bench = { x, y, rot };
    this.selection = { kind: 'part', id };
    this.commit();
  }

  /**
   * Turn the selected part by 90° about the middle of its legs. When the turned legs would leave
   * the breadboard or land on taken holes, it shifts to the nearest holes that fit, and if no
   * nearby spot fits it tries the next quarter turn.
   */
  rotateSelected() {
    if (this.locked()) return;
    // In a group, each part turns where it is
    let turned = false;
    for (const i of this.selected) {
      const p = i.kind === 'part' ? this.part(i.id) : undefined;
      if (p && this.turn(p)) turned = true;
    }
    if (turned) this.commit();
  }

  /** Turn a part a quarter (see rotateSelected). Did it turn? */
  private turn(p: PartInstance): boolean {
    if (p.bench && !p.placement) {
      // On the bench nothing is in the way: turn in place, the leg wires follow
      p.bench = { ...p.bench, rot: ((p.bench.rot + 90) % 360) as Rotation };
      return true;
    }
    const manifest = PARTS[p.type]?.manifest;
    const inst = p.placement && this.project.breadboards.find((b) => b.id === p.placement!.bb);
    const ex = inst && breadboard(inst.type);
    const anchor = ex && p.placement && ex.holes.get(p.placement.hole);
    if (!p.placement || !manifest || !ex || !anchor) return false;
    const [ox, oy] = centreOffset(manifest, p.placement.rot);
    const centre = { x: anchor.x + ox, y: anchor.y + oy };
    for (const step of [90, 180, 270]) {
      const rot = ((p.placement.rot + step) % 360) as Rotation;
      const [dx, dy] = centreOffset(manifest, rot);
      let best: { hole: string; d: number } | null = null;
      for (const h of ex.holes.values()) {
        const d = Math.hypot(h.x + dx - centre.x, h.y + dy - centre.y);
        if (d <= 3 && (!best || d < best.d) && this.canPlace(p.type, p.placement.bb, h.name, rot, p.id)) best = { hole: h.name, d };
      }
      if (best) {
        p.placement = { ...p.placement, hole: best.hole, rot };
        return true;
      }
    }
    return false;
  }

  /**
   * Plug a part in the way its manifest says: onto a breadboard if it lies on the bench, each
   * leg wired to its supply or a free GPIO (see autoplug.ts). Says where each leg went.
   */
  autoPlug(id: string) {
    if (this.locked()) return;
    const r = autoPlug($state.snapshot(this.project) as Project, id, (p) => this.buildNetKernel(p), this.partBoxes);
    if (!r.ok) {
      this.notice = r.reason;
      return;
    }
    const old = new Set(this.project.wires.map((w) => w.id));
    this.project = r.project;
    // Only the new wires find their way: the rest of the bench stays as the user knows it
    this.retidy(new Set(r.project.wires.map((w) => w.id).filter((w) => !old.has(w))));
    this.selection = { kind: 'part', id };
    this.notice = `Đã cắm ${id}: ${r.report.join(' · ')}.`;
    this.commit();
  }

  /**
   * Lay every part and wire out again the way the one-click plug-in would, the circuit and the
   * GPIOs the sketch uses unchanged (see arrange.ts), then route the wires. One undo step.
   */
  arrangeAll() {
    if (this.locked()) return;
    const r = arrange($state.snapshot(this.project) as Project, (p) => this.buildNetKernel(p), this.partBoxes);
    if (!r.ok) {
      this.notice = r.reason;
      return;
    }
    this.project = r.project;
    // Routed even when the user never picked a tidy mode: the first one
    this.reroute(undefined, Math.max(0, this.tidyMode));
    this.selection = null;
    this.notice = `Đã sắp xếp lại: ${r.report.join(' · ')}. Mạch và các chân GPIO vẫn y như cũ; Ctrl+Z để quay lại.`;
    this.commit();
  }

  /** The circuit with `change` made, worked out on the bench as it is now; nothing changes yet. */
  planChange(change: CircuitChange) {
    return applyChange($state.snapshot(this.project) as Project, change, (p) => this.buildNetKernel(p), this.partBoxes);
  }

  /** Put a planned circuit on the bench as one undoable step, `highlight` emphasised. Done? */
  setCircuit(project: Project, highlight: string[], notice: string): boolean {
    if (this.locked()) return false;
    const old = new Set(this.project.wires.map((w) => w.id));
    this.project = project;
    this.retidy(new Set(project.wires.map((w) => w.id).filter((w) => !old.has(w))));
    this.selection = null;
    this.emphasis = highlight;
    this.notice = notice;
    this.commit();
    return true;
  }

  /** `slide`: one of many updates while a slider is dragged, undone as a single step. */
  setProp(id: string, key: string, value: number | string | boolean, slide = false) {
    const p = this.part(id);
    if (!p) return;
    p.props = { ...(p.props ?? {}), [key]: value };
    this.commit(slide ? `slide:${id}:${key}` : undefined);
  }

  /** Flip a boolean prop, or step an enum prop to its next option (a slide switch's lever). */
  toggleProp(id: string, key: string) {
    const p = this.part(id);
    const schema = p && PARTS[p.type]?.manifest.props[key];
    if (!p || !schema) return;
    const now = p.props?.[key] ?? schema.default;
    if (schema.type === 'boolean') this.setProp(id, key, !now);
    else if (schema.type === 'enum') this.setProp(id, key, schema.options[(schema.options.indexOf(String(now)) + 1) % schema.options.length]!);
  }

  addWire(a: Endpoint, b: Endpoint, points: { x: number; y: number }[] = []) {
    if (this.locked()) return;
    const color = WIRE_COLORS[this.nextWire++ % WIRE_COLORS.length];
    const wire: Wire = { id: `w${Date.now().toString(36)}${this.nextWire}`, a, b, color };
    if (points.length) wire.points = points;
    this.project.wires.push(wire);
    this.commit();
  }

  /** The tidy mode last applied (an index into TIDY_MODES), -1 before the first. */
  tidyMode = $state(TIDY_MODES.findIndex((m) => m.id === this.settings.wireMode));

  /** Re-route every wire in the next tidy mode, round and round (see tidy.ts). One undo step. */
  tidyWires() {
    if (this.locked()) return;
    this.tidyMode = (this.tidyMode + 1) % TIDY_MODES.length;
    if (this.reroute()) this.commit();
  }

  /**
   * Re-route every wire in the tidy mode last chosen, if one was (after the board or a
   * breadboard moved). Not committed: it goes with the change that called for it.
   */
  retidy(only?: ReadonlySet<string>) {
    if (this.tidyMode >= 0) this.reroute(only);
  }

  /** Each part's drawn box, by part id, as the workbench measured it (so tidy keeps wires off it). */
  readonly partBoxes = new Map<string, Box>();

  /** Re-route every wire (or `only` these, around the others) in the current tidy mode. Did any wire change? */
  private reroute(only?: ReadonlySet<string>, modeIndex = this.tidyMode): boolean {
    const mode = TIDY_MODES[modeIndex]!;
    const routes = tidyWires($state.snapshot(this.project) as Project, mode, this.partBoxes, only);
    let changed = false;
    for (const w of this.project.wires) {
      const points = routes.get(w.id);
      if (!points || (JSON.stringify(points) === JSON.stringify(w.points ?? []) && !w.free === !mode.free)) continue;
      if (points.length) w.points = points;
      else delete w.points;
      if (mode.free) w.free = true;
      else delete w.free;
      changed = true;
    }
    return changed;
  }

  /** Forget a wire's own corners: it bends on its own again. */
  unbendWire(id: string) {
    if (this.locked()) return;
    const w = this.project.wires.find((q) => q.id === id);
    if (!w?.points) return;
    delete w.points;
    delete w.free;
    this.commit();
  }

  /**
   * Swap the board. Wires to its header move to the pin with the same pad or net on the new
   * board (D2 → IO2); wires to a pin it does not have are removed.
   */
  setBoard(type: string) {
    if (this.locked()) return;
    const from = BOARDS[this.project.board.type];
    const to = BOARDS[type];
    if (!from || !to || type === this.project.board.type) return;
    const same = (a: BoardPin, b: BoardPin) => JSON.stringify(a.connect) === JSON.stringify(b.connect);
    const remap = (e: Endpoint): Endpoint | null => {
      if (e.kind !== 'board') return e;
      const old = from.pins.find((p) => p.name === e.pin);
      if (!old) return null;
      // GND.L stays on the left GND when there are several
      const twins = from.pins.filter((p) => same(p, old));
      const matches = to.pins.filter((p) => same(p, old));
      const pin = matches.find((p) => p.name === old.name) ?? matches[Math.min(twins.indexOf(old), matches.length - 1)];
      return pin ? { kind: 'board', pin: pin.name } : null;
    };
    let dropped = 0;
    this.project.wires = this.project.wires.flatMap((w) => {
      const a = remap(w.a);
      const b = remap(w.b);
      if (a && b) return [{ ...w, a, b }];
      dropped++;
      return [];
    });
    this.project.board = { ...this.project.board, type };
    if (dropped) this.notice = `${to.name} không có chân cho ${dropped} dây nối, nên các dây đó đã được gỡ.`;
    this.commit();
  }

  /** A new breadboard on the bench, its a1 hole at (x, y). */
  addBreadboard(type: string, x: number, y: number) {
    if (this.locked()) return;
    let n = this.project.breadboards.length + 1;
    while (this.project.breadboards.some((b) => b.id === `bb${n}`)) n++;
    this.project.breadboards.push({ id: `bb${n}`, type, x, y });
    this.selection = { kind: 'breadboard', id: `bb${n}` };
    this.commit();
  }

  deleteSelected() {
    if (this.locked()) return;
    const s = this.selection;
    if (!s || s.kind === 'board') return;
    if (s.kind === 'group') {
      const ids = (kind: Item['kind']) => new Set(s.items.flatMap((i) => (i.kind === kind && 'id' in i ? [i.id] : [])));
      const parts = ids('part');
      const wires = ids('wire');
      this.project.wires = this.project.wires.filter((w) => !wires.has(w.id) && ![...parts].some((id) => onPart(w, id)));
      this.project.parts = this.project.parts.filter((p) => !parts.has(p.id));
      // Breadboards go as one at a time would (the board stays)
      const bbs = ids('breadboard');
      let project = $state.snapshot(this.project) as Project;
      for (const id of bbs) project = unplugBreadboard(project, id, (p) => this.buildNetKernel(p));
      this.project = project;
      if (bbs.size) this.retidy();
    } else if (s.kind === 'part') {
      this.project.parts = this.project.parts.filter((p) => p.id !== s.id);
      // Wires to its legs would hang in the air
      this.project.wires = this.project.wires.filter((w) => !onPart(w, s.id));
    } else if (s.kind === 'breadboard') {
      // The parts plugged into it stay on the bench, wired up as its strips joined them (see wiring.ts)
      this.project = unplugBreadboard($state.snapshot(this.project) as Project, s.id, (p) => this.buildNetKernel(p));
      this.retidy();
    } else this.project.wires = this.project.wires.filter((w) => w.id !== s.id);
    this.selection = null;
    this.commit();
  }

  part(id: string): PartInstance | undefined {
    return this.project.parts.find((p) => p.id === id);
  }

  clear() {
    if (this.locked()) return;
    this.project = emptyProject();
    this.selection = null;
    this.commit();
  }

  // --- Navigation: lesson picker ⇄ lab ----------------------------------------------------

  get lesson() {
    return LESSONS.find((l) => l.id === this.lessonId);
  }

  /** The featured project open on the bench (the read-only original), if any. */
  get featured() {
    return FEATURED.find((f) => f.id === this.route);
  }

  /** The user's own project open on the bench, if any. */
  get mine() {
    return this.myProjects.find((p) => p.id === this.route);
  }

  /** The featured project the bench comes from: the original itself or the copy's source. */
  get source() {
    return this.featured ?? FEATURED.find((f) => f.id === this.mine?.from);
  }

  /**
   * Enter a lesson, a featured project or the sandbox: its saved work, or a fresh template +
   * original sketch.
   */
  async open(id: string) {
    this.save();
    this.flushFolder();
    this.stopProgram();
    const linked = this.myProjects.find((p) => p.id === id)?.folder;
    // A linked folder opens as it is on disk; the copy in the browser only if the server is not there
    const disk = linked ? await this.readFolder(linked) : null;
    if (disk) localStorage.setItem(wsKey(id), JSON.stringify({ project: disk.project, code: disk.code, passed: [] } satisfies Workspace));
    else if (linked) this.notice = `Không đọc được thư mục ${linked} (server của lab có đang chạy?): đang mở bản lưu trong trình duyệt, sửa sẽ không vào thư mục.`;
    this.files = disk ? { ...disk.files } : {};
    this.diskFiles = disk ? { ...disk.files } : {};
    this.originalFiles = disk ? { ...disk.files } : {};
    this.activeFile = MAIN_FILE;
    this.diskCode = disk?.code ?? null;
    this.folderStart = disk ? structuredClone(disk.project) : null;
    const lesson = LESSONS.find((l) => l.id === id);
    const featured = FEATURED.find((f) => f.id === id);
    const source = featured ?? FEATURED.find((f) => f.id === this.myProjects.find((p) => p.id === id)?.from);
    // Fetch before switching, so nothing saves the old bench under the new id meanwhile
    const original = lesson?.sketch ? await this.fetchSketch(lesson.sketch) : (source?.code ?? disk?.code ?? null);
    this.lessonId = lesson?.id ?? null;
    this.route = id;
    this.docPage = null;
    this.selection = null;
    this.originalCode = original;
    // A featured project always opens as published
    const ws = featured ? null : loadWorkspace(id);
    this.project = ws ? ws.project : structuredClone(lesson?.template ?? source?.project ?? emptyProject());
    this.code = ws ? ws.code : (this.originalCode ?? DEFAULT_SKETCH);
    this.passed = ws?.passed ?? [];
    this.build = { status: 'idle', log: '', ms: 0, errors: [] };
    this.send({ type: 'lesson', lessonId: this.lessonId });
    // Another workspace: its own, empty history
    this.past = [];
    this.future = [];
    this.current = '';
    this.commit();
  }

  goHome() {
    this.save();
    this.flushFolder();
    this.stopProgram();
    this.route = 'home';
  }

  /** Back to the lesson's or project's circuit and original code (or the bench as it was set up). */
  restart() {
    const lesson = this.lesson;
    this.stopProgram();
    this.project = structuredClone(lesson?.template ?? this.source?.project ?? this.mine?.start ?? (this.mine?.folder ? this.folderStart : null) ?? emptyProject());
    this.code = this.originalCode ?? DEFAULT_SKETCH;
    // A linked folder's other sources as opened; files added since stay
    if (this.mine?.folder) for (const [n, t] of Object.entries(this.originalFiles)) this.files[n] = t;
    this.selection = null;
    this.build = { status: 'idle', log: '', ms: 0, errors: [] };
    this.commit();
  }

  /** Put an exercise's starting circuit on the bench; the code stays as it is. */
  startExercise(exerciseId: string) {
    const ex = this.lesson?.exercises?.find((e) => e.id === exerciseId);
    if (!ex?.template) return;
    this.project = structuredClone(ex.template);
    this.selection = null;
    this.commit();
  }

  private async fetchSketch(path: string): Promise<string | null> {
    const r = await fetch(`/api/sketch?path=${encodeURIComponent(path)}`);
    return r.ok ? await r.text() : null;
  }

  // --- Code and the program on the board -----------------------------------------------------

  code = $state(DEFAULT_SKETCH);
  build = $state<{ status: 'idle' | 'building' | 'ok' | 'failed'; log: string; ms: number; errors: BuildError[] }>({
    status: 'idle',
    log: '',
    ms: 0,
    errors: [],
  });

  /** The editor's code differs from what the board is running. */
  get codeChanged(): boolean {
    const p = this.program;
    return p.kind === 'none' || p.codeHash !== hashSources(this.code, this.buildFiles() ?? {});
  }

  /** The other sources to build with, as the editor has them: a linked folder's, else none. */
  private buildFiles(): Record<string, string> | undefined {
    return this.multiFile ? ($state.snapshot(this.files) as Record<string, string>) : undefined;
  }

  setCode(code: string) {
    this.code = code;
    this.save();
  }

  private stopProgram() {
    this.send({ type: 'pause' });
    this.send({ type: 'firmware', firmware: null });
    this.program = { kind: 'none' };
    this.running = false;
    this.serial = '';
  }

  /** The one Run button: new code always gets built and run; otherwise pause / resume. */
  async runOrPause() {
    if (this.build.status === 'building') return;
    if (this.device.status === 'live') return this.stopLive();
    if (this.codeChanged) return this.runCode();
    if (this.running) return this.pause();
    this.run();
  }

  /** Get the editor's code onto the board: a matching prebuilt build if there is one, else compile. */
  async runCode() {
    const lesson = this.lesson;
    const env = lesson?.firmware.kind === 'pio-env' ? lesson.firmware.env : null;
    if (env && lesson?.sketch && this.code === this.originalCode && this.envs.includes(env)) {
      // The code is the lesson's own sketch: reuse `pio run -e lessonNN`'s output if it's current
      const fresh = await fetch(`/pio/${env}/fresh?src=${encodeURIComponent(lesson.sketch)}`).then((r) => r.json()).catch(() => ({ fresh: false }));
      if (fresh.fresh && (await this.loadFirmwareFrom(`/pio/${env}`, env))) {
        this.program = { kind: 'prebuilt', env, codeHash: hashSources(this.code, {}), at: Date.now() };
        return;
      }
    }
    await this.buildAndRun();
  }

  /** Advanced: run whatever `pio run -e <env>` built last, regardless of the editor. */
  async runPrebuilt(env: string) {
    if (await this.loadFirmwareFrom(`/pio/${env}`, env)) this.program = { kind: 'prebuilt', env, at: Date.now() };
  }

  /** Fetch a build's four files from `base` and boot them on the emulator. */
  private async loadFirmwareFrom(base: string, env: string): Promise<boolean> {
    const get = async (f: string) => {
      const r = await fetch(`${base}/${f}`, { cache: 'no-store' });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
    };
    const [elf, bin, bootloader, partitions] = await Promise.all(['firmware.elf', 'firmware.bin', 'bootloader.bin', 'partitions.bin'].map(get));
    if (!elf || !bin) {
      this.error = `${base} has no firmware.elf / firmware.bin`;
      return false;
    }
    this.serial = '';
    const firmware: FirmwareFiles = { env, elf, bin, bootloader, partitions };
    this.send({ type: 'firmware', firmware });
    this.run();
    return true;
  }

  /** Compile the editor's code with PlatformIO, then boot it if it built. */
  private async buildAndRun() {
    const code = this.code;
    const files = this.buildFiles();
    this.build = { status: 'building', log: '', ms: 0, errors: [] };
    try {
      const r = await fetch('/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, folder: this.mine?.folder, files }) });
      if (!r.ok || !r.body) throw new Error(await r.text());
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let log = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        log += decoder.decode(value, { stream: true });
        this.build.log = log.replace(/\n@@RESULT .*\n?$/, '');
      }
      const m = /@@RESULT (.*)/.exec(log);
      const result = m ? (JSON.parse(m[1]!) as { ok: boolean; ms: number; errors: BuildError[] }) : { ok: false, ms: 0, errors: [] };
      this.build = { status: result.ok ? 'ok' : 'failed', log: this.build.log, ms: result.ms, errors: result.errors };
      if (result.ok && (await this.loadFirmwareFrom('/api/build/out', 'sketch'))) {
        this.program = { kind: 'sketch', codeHash: hashSources(code, files ?? {}), at: Date.now(), ms: result.ms };
      }
    } catch (e) {
      this.build = { status: 'failed', log: `${this.build.log}\n${e instanceof Error ? e.message : String(e)}`, ms: 0, errors: [] };
    }
  }

  run() {
    this.send({ type: 'run' });
    this.running = true;
  }

  pause() {
    this.send({ type: 'pause' });
    this.running = false;
  }

  reset() {
    if (this.device.status === 'live') {
      this.serial = '';
      void fetch('/api/device/serial/reset', { method: 'POST' });
      return;
    }
    this.serial = '';
    this.send({ type: 'reset' });
    if (this.running) this.send({ type: 'run' });
  }

  setSpeed(v: number) {
    this.speed = v;
    this.send({ type: 'speed', speed: v });
  }

  press(part: string, key?: string) {
    this.send({ type: 'press', part, key });
  }

  release(part: string, key?: string) {
    this.send({ type: 'release', part, key });
  }

  // --- A real board on USB -------------------------------------------------------------------

  /** The USB serial ports, a likely board picked if none is yet. */
  async refreshPorts() {
    try {
      const r = await fetch('/api/device/ports', { cache: 'no-store' });
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error();
      const ports = (await r.json()) as DeviceState['ports'];
      this.device.available = true;
      this.device.ports = ports;
      if (!ports.some((p) => p.port === this.device.port)) this.device.port = ports.find((p) => p.likely)?.port ?? ports[0]?.port ?? '';
    } catch {
      this.device.available = false;
    }
  }

  /**
   * Build the editor's code and flash it to the board on the chosen port. `live`: with the probe,
   * then follow the board on the bench. Did it flash?
   */
  async uploadToBoard(live: boolean): Promise<boolean> {
    const d = this.device;
    // Plugged in after the list was read: look again
    if (!d.port) await this.refreshPorts();
    if (!d.port) {
      d.error = 'Chưa thấy board nào: cắm ESP32 vào cổng USB (cáp có truyền dữ liệu) rồi bấm làm mới.';
      return false;
    }
    if (d.status === 'uploading' || this.build.status === 'building') return false;
    this.stopLive();
    Object.assign(d, { status: 'uploading', live, log: '', error: null, probe: false });
    try {
      const r = await fetch('/api/device/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: this.code, port: d.port, live, folder: this.mine?.folder, files: this.buildFiles() }),
      });
      if (!r.ok || !r.body) throw new Error(await r.text());
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let log = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        log += decoder.decode(value, { stream: true });
        d.log = log.replace(/\n@@RESULT .*\n?$/, '');
      }
      const m = /@@RESULT (.*)/.exec(log);
      const result = m ? (JSON.parse(m[1]!) as { ok: boolean; errors: BuildError[] }) : { ok: false, errors: [] };
      d.status = 'idle';
      if (!result.ok) {
        d.error = result.errors.some((e) => e.severity === 'error')
          ? 'Code có lỗi biên dịch: xem log bên dưới.'
          : /Failed to connect|Wrong boot mode|No serial data|could not open port|Permission denied|Resource busy/i.test(log)
            ? 'Không nạp được vào board: kiểm tra cáp USB (loại có truyền dữ liệu), đúng cổng, và đóng các chương trình đang mở cổng (Serial Monitor khác). Nếu vẫn lỗi: giữ nút BOOT trong lúc nạp.'
            : 'Không nạp được vào board: xem log bên dưới.';
        return false;
      }
      if (live) await this.startLive();
      else this.notice = `Đã nạp code vào board thật (${d.port}).`;
      return true;
    } catch (e) {
      d.status = 'idle';
      d.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /**
   * Follow the real board: open its serial line, show its output in the Serial Monitor and drive
   * the bench from its pins. The board must run a live build (uploadToBoard(true)).
   */
  async startLive() {
    const d = this.device;
    if (!d.port) return;
    this.stopLive();
    // The emulator steps aside: the real chip runs the code now
    this.send({ type: 'pause' });
    this.send({ type: 'firmware', firmware: null });
    this.program = { kind: 'none' };
    this.serial = '';
    Object.assign(d, { status: 'connecting', error: null, probe: false });
    const abort = new AbortController();
    this.liveAbort = abort;
    const port = d.port;
    // From the start, so the Serial Monitor shows the boot too (and a quiet board speaks up)
    setTimeout(() => this.liveAbort === abort && void fetch('/api/device/serial/reset', { method: 'POST' }), 300);
    try {
      const r = await fetch(`/api/device/serial?port=${encodeURIComponent(port)}&baud=115200`, { signal: abort.signal, cache: 'no-store' });
      if (!r.ok || !r.body) throw new Error(await r.text());
      this.send({ type: 'live', on: true });
      this.running = true;
      d.status = 'live';
      const decoder = new LiveDecoder();
      const reader = r.body.getReader();
      // Hello never came: the board runs something else than a live build
      const check = setTimeout(() => {
        if (this.liveAbort === abort && !d.probe) d.error = 'Board không gửi trạng thái chân: hãy bấm "Nạp & theo dõi" để nạp bản có probe.';
      }, 3000);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const c = decoder.push(value);
        if (c.text) this.serial = (this.serial + c.text).slice(-20000);
        if (c.hello || Object.keys(c.pins).length) {
          if (!d.probe) d.error = null;
          d.probe = true;
        }
        if (Object.keys(c.pins).length) this.send({ type: 'live-pins', pins: c.pins });
        if (c.error) d.error = `Mất kết nối với board: ${c.error}`;
      }
      clearTimeout(check);
    } catch (e) {
      if (!abort.signal.aborted) d.error = `Không mở được cổng ${port}: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (this.liveAbort === abort) this.stopLive();
  }

  /** Stop following the real board; the bench goes back to the emulator. */
  stopLive() {
    const abort = this.liveAbort;
    if (!abort) return;
    this.liveAbort = null;
    abort.abort();
    this.device.status = 'idle';
    this.device.probe = false;
    this.send({ type: 'live', on: false });
    this.running = false;
  }

  /** Text typed in the Serial Monitor: to the real board while live, else to the emulator. */
  serialIn(text: string) {
    if (this.device.status === 'live') {
      void fetch('/api/device/serial/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    } else this.send({ type: 'serial-in', text });
  }

  // --- Netlist queries for highlighting -------------------------------------------------------

  /** All netlist keys on the same net as an endpoint. */
  netOf(e: Endpoint): Set<string> {
    const k = this.netKernel;
    if (!k) return new Set();
    const net = k.netlist.net(endpointKey(e));
    return new Set(net === undefined ? [] : k.netlist.keysOf(net));
  }

  /** All netlist keys on the same net as a key. */
  netOfKey(key: string): Set<string> {
    const k = this.netKernel;
    const net = k?.netlist.net(key);
    return new Set(net === undefined || !k ? [] : k.netlist.keysOf(net));
  }

  /** Strip-mates: keys joined to this hole by metal only (not via wires). */
  padOfPin(pin: string): string | undefined {
    const p = BOARDS[this.project.board.type]?.pins.find((q) => q.name === pin);
    return p && 'pad' in p.connect ? p.connect.pad : undefined;
  }

  padKey(pad: string) {
    return keyOf.pad(pad);
  }
}

/** Before lessons had their own workspaces, one bench and one sketch were stored: keep them as the sandbox. */
function migrateOldStorage() {
  const project = localStorage.getItem('esp32lab.project');
  const code = localStorage.getItem('esp32lab.code');
  if ((project || code) && !localStorage.getItem(wsKey(FREE))) {
    try {
      const ws: Workspace = { project: project ? (JSON.parse(project) as Project) : emptyProject(), code: code ?? DEFAULT_SKETCH, passed: [] };
      localStorage.setItem(wsKey(FREE), JSON.stringify(ws));
    } catch {
      /* unreadable: ignore */
    }
  }
  localStorage.removeItem('esp32lab.project');
  localStorage.removeItem('esp32lab.code');
  const mine = loadMyProjects();
  // The one sandbox bench from before "Tạo bàn làm việc mới" made projects: keep it as one of them
  const free = loadWorkspace(FREE);
  if (free) {
    localStorage.removeItem(wsKey(FREE));
    if (free.project.parts.length || free.project.wires.length || free.code !== DEFAULT_SKETCH) {
      const now = Date.now();
      const p: MyProject = { id: `my-${now.toString(36)}free`, title: 'Bàn làm việc tự do', created: now, updated: now };
      mine.unshift(p);
      localStorage.setItem(wsKey(p.id), JSON.stringify(free));
    }
  }
  // Work saved on a featured project before originals became read-only: keep it as a copy
  for (const f of FEATURED) {
    const ws = loadWorkspace(f.id);
    if (!ws) continue;
    localStorage.removeItem(wsKey(f.id));
    if (isOriginal(f, ws.project, ws.code)) continue;
    const now = Date.now();
    const copy: MyProject = { id: `my-${now.toString(36)}${f.order}`, title: copyTitle(f.title, mine), from: f.id, created: now, updated: now };
    mine.unshift(copy);
    localStorage.setItem(wsKey(copy.id), JSON.stringify(ws));
  }
  localStorage.setItem(MY_PROJECTS, JSON.stringify(mine));
}

export const lab = new Lab();

/** Middle of a part's legs relative to its first leg, in pitches, after turning it by `rot`. */
function centreOffset(manifest: PartManifest, rot: Rotation): [number, number] {
  const first = manifest.terminals[0]!;
  let x = 0;
  let y = 0;
  for (const t of manifest.terminals) {
    const [dx, dy] = rotate(t.dx - first.dx, t.dy - first.dy, rot);
    x += dx;
    y += dy;
  }
  return [x / manifest.terminals.length, y / manifest.terminals.length];
}
