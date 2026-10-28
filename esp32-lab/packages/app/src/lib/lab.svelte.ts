// Application state: the project being edited, selection, and the latest simulation state
// from the worker. Components read and mutate this; edits are pushed to the worker.

import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { SCHEMA_VERSION, type Endpoint, type PartInstance, type Project, type Rotation, type Wire } from '@esp32lab/project-model';
import { endpointKey, keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import wasmUrl from '../../../mcu-esp32/wasm/esp32.wasm?url';
import { BOARDS, BREADBOARDS, LESSONS, PARTS } from './catalog';
import type { Note } from '@esp32lab/explain';
import type { PartManifest } from '@esp32lab/part-sdk';
import type { FirmwareFiles, FlowView, FromWorker, StepResult, ToWorker } from '../sim/protocol';
import { resolvePlacement, rotate } from '@esp32lab/project-model';
import { breadboard } from './geometry';

export interface BuildError {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
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

type Selection = { kind: 'part'; id: string } | { kind: 'wire'; id: string } | null;

const WIRE_COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f5d90a', '#f76b15', '#8e4ec6', '#1c2024'];

/** What the emulated board is running, so the UI can always say it plainly. */
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

/** FNV-1a: cheap fingerprint to tell whether the code changed since it was built. */
function hashCode(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const wsKey = (id: string) => `esp32lab.ws.${id}`;

export function loadWorkspace(id: string): Workspace | null {
  try {
    const raw = localStorage.getItem(wsKey(id));
    return raw ? (JSON.parse(raw) as Workspace) : null;
  } catch {
    return null;
  }
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
  error = $state<string | null>(null);
  flows = $state<FlowView[]>([]);
  terminalCurrents = $state<Record<string, Record<string, number>>>({});
  voltages = $state<Record<string, number | null>>({});
  notes = $state<Note[]>([]);
  /** Keys / part ids to emphasise on the bench (hovered explanation note). */
  emphasis = $state<string[]>([]);
  /** How the bench shows the solved circuit. */
  overlay = $state<'current' | 'voltage' | 'off'>('current');
  /** Static netlist for hover highlighting (no simulation). */
  netKernel = $derived.by(() => this.buildNetKernel(this.project));

  private worker: Worker;
  private nextWire = 0;

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    this.send({ type: 'init', wasmUrl });
    migrateOldStorage();
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

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const prev = this.past.at(-1);
    if (prev === undefined) return;
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, this.current];
    this.restore(prev);
  }

  redo() {
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
    // Keep the selection only if what it points at still exists
    const s = this.selection;
    if (s?.kind === 'part' && !this.part(s.id)) this.selection = null;
    if (s?.kind === 'wire' && !this.project.wires.some((w) => w.id === s.id)) this.selection = null;
    this.save();
    this.send({ type: 'project', project: $state.snapshot(this.project) as Project });
  }

  private save() {
    if (this.route === 'home') return;
    const ws: Workspace = { project: $state.snapshot(this.project) as Project, code: this.code, passed: this.passed };
    localStorage.setItem(wsKey(this.route), JSON.stringify(ws));
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
    const id = this.newPartId(type);
    this.project.parts.push({ id, type, props: {}, placement: { bb, hole, rot } });
    this.selection = { kind: 'part', id };
    this.commit();
  }

  /** A new part lying on the bench, off the breadboard: wire its legs directly. */
  addPartOnBench(type: string, x: number, y: number, rot: Rotation = 0) {
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
    const s = this.selection;
    const p = s?.kind === 'part' ? this.part(s.id) : undefined;
    if (p?.bench && !p.placement) {
      // On the bench nothing is in the way: turn in place, the leg wires follow
      p.bench = { ...p.bench, rot: ((p.bench.rot + 90) % 360) as Rotation };
      this.commit();
      return;
    }
    const manifest = p && PARTS[p.type]?.manifest;
    const inst = p?.placement && this.project.breadboards.find((b) => b.id === p.placement!.bb);
    const ex = inst && breadboard(inst.type);
    const anchor = ex && p?.placement && ex.holes.get(p.placement.hole);
    if (!p?.placement || !manifest || !ex || !anchor) return;
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
        this.commit();
        return;
      }
    }
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

  addWire(a: Endpoint, b: Endpoint) {
    const color = WIRE_COLORS[this.nextWire++ % WIRE_COLORS.length];
    const wire: Wire = { id: `w${Date.now().toString(36)}${this.nextWire}`, a, b, color };
    this.project.wires.push(wire);
    this.commit();
  }

  deleteSelected() {
    const s = this.selection;
    if (!s) return;
    if (s.kind === 'part') {
      this.project.parts = this.project.parts.filter((p) => p.id !== s.id);
      // Wires to its legs would hang in the air
      this.project.wires = this.project.wires.filter((w) => !onPart(w, s.id));
    }
    else this.project.wires = this.project.wires.filter((w) => w.id !== s.id);
    this.selection = null;
    this.commit();
  }

  part(id: string): PartInstance | undefined {
    return this.project.parts.find((p) => p.id === id);
  }

  clear() {
    this.project = emptyProject();
    this.selection = null;
    this.commit();
  }

  // --- Navigation: lesson picker ⇄ lab ----------------------------------------------------

  get lesson() {
    return LESSONS.find((l) => l.id === this.lessonId);
  }

  /** Enter a lesson (or the sandbox): its saved work, or a fresh template + original sketch. */
  async open(id: string) {
    this.save();
    this.stopProgram();
    const lesson = LESSONS.find((l) => l.id === id);
    // Fetch before switching, so nothing saves the old bench under the new id meanwhile
    const original = lesson?.sketch ? await this.fetchSketch(lesson.sketch) : null;
    this.lessonId = lesson?.id ?? null;
    this.route = id;
    this.selection = null;
    this.originalCode = original;
    const ws = loadWorkspace(id);
    this.project = ws ? ws.project : structuredClone(lesson?.template ?? emptyProject());
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
    this.stopProgram();
    this.route = 'home';
  }

  /** Back to the lesson's template circuit and original code (or an empty sandbox). */
  restart() {
    const lesson = this.lesson;
    this.stopProgram();
    this.project = structuredClone(lesson?.template ?? emptyProject());
    this.code = this.originalCode ?? DEFAULT_SKETCH;
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
    return p.kind === 'none' || p.codeHash !== hashCode(this.code);
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
        this.program = { kind: 'prebuilt', env, codeHash: hashCode(this.code), at: Date.now() };
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
    this.build = { status: 'building', log: '', ms: 0, errors: [] };
    try {
      const r = await fetch('/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
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
        this.program = { kind: 'sketch', codeHash: hashCode(code), at: Date.now(), ms: result.ms };
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
    this.serial = '';
    this.send({ type: 'reset' });
    if (this.running) this.send({ type: 'run' });
  }

  setSpeed(v: number) {
    this.speed = v;
    this.send({ type: 'speed', speed: v });
  }

  press(part: string) {
    this.send({ type: 'press', part });
  }

  release(part: string) {
    this.send({ type: 'release', part });
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
