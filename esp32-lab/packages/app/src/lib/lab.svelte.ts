// Application state: the project being edited, selection, and the latest simulation state
// from the worker. Components read and mutate this; edits are pushed to the worker.

import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { SCHEMA_VERSION, type Endpoint, type PartInstance, type Project, type Rotation, type Wire } from '@esp32lab/project-model';
import { endpointKey, keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import wasmUrl from '../../../mcu-esp32/wasm/esp32.wasm?url';
import { BOARDS, BREADBOARDS, LESSONS, PARTS } from './catalog';
import type { Note } from '@esp32lab/explain';
import type { FirmwareFiles, FlowView, FromWorker, StepResult, ToWorker } from '../sim/protocol';
import { resolvePlacement } from '@esp32lab/project-model';
import { breadboard } from './geometry';

const STORAGE = 'esp32lab.project';

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

class Lab {
  project = $state<Project>(load());
  selection = $state<Selection>(null);
  lessonId = $state<string | null>(null);
  envs = $state<string[]>([]);
  env = $state<string | null>(null);
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
    this.send({ type: 'project', project: $state.snapshot(this.project) as Project });
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
    } else if (m.type === 'serial') {
      this.serial = (this.serial + m.text).slice(-20000);
    } else {
      this.error = m.message;
    }
  }

  /** Push the edited project to the worker and save it. */
  commit() {
    const snapshot = $state.snapshot(this.project) as Project;
    localStorage.setItem(STORAGE, JSON.stringify(snapshot));
    this.send({ type: 'project', project: snapshot });
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

  addPart(type: string, bb: string, hole: string, rot: Rotation = 0) {
    const n = this.project.parts.filter((p) => p.type === type).length + 1;
    let id = `${type}${n}`;
    while (this.project.parts.some((p) => p.id === id)) id += "'";
    this.project.parts.push({ id, type, props: {}, placement: { bb, hole, rot } });
    this.selection = { kind: 'part', id };
    this.commit();
  }

  movePart(id: string, bb: string, hole: string) {
    const p = this.part(id);
    if (p?.placement) {
      p.placement = { ...p.placement, bb, hole };
      this.commit();
    }
  }

  rotateSelected() {
    const s = this.selection;
    const p = s?.kind === 'part' ? this.part(s.id) : undefined;
    if (!p?.placement) return;
    const rot = ((p.placement.rot + 90) % 360) as Rotation;
    if (this.canPlace(p.type, p.placement.bb, p.placement.hole, rot, p.id)) {
      p.placement = { ...p.placement, rot };
      this.commit();
    }
  }

  setProp(id: string, key: string, value: number | string | boolean) {
    const p = this.part(id);
    if (!p) return;
    p.props = { ...(p.props ?? {}), [key]: value };
    this.commit();
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
    if (s.kind === 'part') this.project.parts = this.project.parts.filter((p) => p.id !== s.id);
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

  // --- Lessons and firmware -----------------------------------------------------------------

  selectLesson(id: string | null) {
    this.lessonId = id;
    this.send({ type: 'lesson', lessonId: id });
    const lesson = LESSONS.find((l) => l.id === id);
    const fw = lesson?.firmware;
    if (fw?.kind === 'pio-env' && this.envs.includes(fw.env)) void this.loadFirmware(fw.env);
  }

  /** Replace the bench with the lesson's circuit, or one exercise's, and load its firmware. */
  loadTemplate(exerciseId?: string) {
    const lesson = LESSONS.find((l) => l.id === this.lessonId);
    if (!lesson) return;
    const exercise = lesson.exercises?.find((e) => e.id === exerciseId);
    const template = exercise?.template ?? lesson.template;
    this.project = structuredClone(template);
    this.selection = null;
    this.commit();
    const fw = exercise?.firmware ?? template.firmware ?? lesson.firmware;
    if (fw?.kind === 'pio-env' && this.envs.includes(fw.env) && fw.env !== this.env) void this.loadFirmware(fw.env);
  }

  async loadFirmware(env: string | null) {
    this.env = env;
    this.serial = '';
    if (!env) return this.send({ type: 'firmware', firmware: null });
    await this.loadFirmwareFrom(`/pio/${env}`, env);
  }

  /** Fetch a build's four files from `base` and boot them on the emulator. */
  private async loadFirmwareFrom(base: string, env: string) {
    const get = async (f: string) => {
      const r = await fetch(`${base}/${f}`, { cache: 'no-store' });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
    };
    const [elf, bin, bootloader, partitions] = await Promise.all(['firmware.elf', 'firmware.bin', 'bootloader.bin', 'partitions.bin'].map(get));
    if (!elf || !bin) {
      this.error = `${base} has no firmware.elf / firmware.bin`;
      return;
    }
    const firmware: FirmwareFiles = { env, elf, bin, bootloader, partitions };
    this.send({ type: 'firmware', firmware });
    this.run();
  }

  // --- Code editor: build the sketch with PlatformIO and run it ----------------------------

  code = $state(localStorage.getItem('esp32lab.code') ?? DEFAULT_SKETCH);
  build = $state<{ status: 'idle' | 'building' | 'ok' | 'failed'; log: string; ms: number; errors: BuildError[] }>({
    status: 'idle',
    log: '',
    ms: 0,
    errors: [],
  });

  setCode(code: string) {
    this.code = code;
    localStorage.setItem('esp32lab.code', code);
  }

  async loadLessonSketch() {
    const lesson = LESSONS.find((l) => l.id === this.lessonId);
    if (!lesson?.sketch) return;
    const r = await fetch(`/api/sketch?path=${encodeURIComponent(lesson.sketch)}`);
    if (r.ok) this.setCode(await r.text());
  }

  /** Compile the editor's code, then boot it on the emulator if it built. */
  async buildAndRun() {
    if (this.build.status === 'building') return;
    this.build = { status: 'building', log: '', ms: 0, errors: [] };
    try {
      const r = await fetch('/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: this.code }) });
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
      if (result.ok) {
        this.env = 'sketch';
        this.serial = '';
        await this.loadFirmwareFrom('/api/build/out', 'sketch');
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

function load(): Project {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw) as Project;
  } catch {
    /* fall through */
  }
  return emptyProject();
}

export const lab = new Lab();
