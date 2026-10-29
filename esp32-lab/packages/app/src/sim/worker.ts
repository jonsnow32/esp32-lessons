// Simulation worker: the circuit kernel plus the ESP32 emulator, paced against wall-clock time.
// The UI only sends edits and interactions and draws the state this posts back.

import { explain } from '@esp32lab/explain';
import { evaluateStep, type Lesson } from '@esp32lab/lesson-engine';
import { Esp32Mcu, Esp32Wasm } from '@esp32lab/mcu-esp32';
import { MS, S } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel, type McuModel } from '@esp32lab/sim-core';
import { ESP32_PAD_NAMES, ESP32_PADS } from '@esp32lab/mcu-esp32';
import { BOARDS, BREADBOARDS, LESSONS, PARTS } from '../lib/catalog';
import type { FirmwareFiles, FlowView, FromWorker, StepResult, ToWorker } from './protocol';

const MANIFESTS = Object.fromEntries(Object.entries(PARTS).map(([k, m]) => [k, m.manifest]));

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let wasm: Esp32Wasm | null = null;
let firmware: FirmwareFiles | null = null;
let project: Project | null = null;
let lesson: Lesson | null = null;
let mcu: McuModel | null = null;
let kernel: SimKernel | null = null;
let running = false;
let speed = 1;
let serial = '';
/** Controls held down, as part id → keys held (undefined for a one-button part); replayed on rebuild. */
const held = new Map<string, Set<string | undefined>>();

function newMcu(): McuModel {
  if (wasm && firmware) {
    const m = wasm.boot(firmware);
    m.onSerial((_p, bytes) => {
      const text = new TextDecoder().decode(bytes);
      serial += text;
      post({ type: 'serial', text });
    });
    return m;
  }
  // No firmware loaded: the chip sits with every pad floating
  return new ScriptedMcu(ESP32_PAD_NAMES);
}

/** (Re)build the circuit around the current MCU, keeping the MCU and its time. */
function rebuild(): void {
  if (!project) return;
  mcu ??= newMcu();
  const board = BOARDS[project.board.type];
  if (!board) return post({ type: 'error', message: `Unknown board ${project.board.type}` });
  const startTime = kernel?.now ?? 0;
  kernel = new SimKernel({ project, board, breadboards: BREADBOARDS, parts: PARTS, mcu, startTime });
  for (const [part, keys] of held) for (const key of keys) kernel.press(part, key);
  kernel.solve();
  publish(0);
}

function reset(): void {
  if (mcu instanceof Esp32Mcu) mcu.dispose();
  mcu = null;
  kernel = null;
  serial = '';
  rebuild();
}

function evaluateLesson(): StepResult[] {
  if (!lesson || !kernel) return [];
  return [...lesson.steps, ...(lesson.exercises ?? [])].map((step) => {
    const r = evaluateStep(step, { kernel: kernel!, serial });
    return { id: step.id, title: step.title, hint: step.hint, pass: r.pass, results: r.results };
  });
}

function publish(rate: number): void {
  if (!kernel || !project) return;
  const observables: Record<string, Record<string, unknown>> = {};
  for (const id of kernel.terminals().keys()) observables[id] = kernel.observables(id);
  const { terminals, edges } = kernel.flows();
  const flows: FlowView[] = edges
    .filter((e) => Math.abs(e.amps) > 1e-6 && e.kind !== 'onboard')
    .map((e) => ({ kind: e.kind, id: e.id, a: e.a, b: e.b, amps: e.amps }));
  const terminalCurrents: Record<string, Record<string, number>> = {};
  for (const [id, c] of terminals) if (!id.startsWith('mcu.') && !id.startsWith('board.supply')) terminalCurrents[id] = c;
  const voltages: Record<string, number | null> = {};
  for (const [key, s] of kernel.keyVoltages()) {
    if (key.startsWith('h:') || key.startsWith('bp:') || key.startsWith('p:')) voltages[key] = s.floating ? null : Math.round(s.v * 1000) / 1000;
  }
  const board = BOARDS[project.board.type]!;
  const notes = explain({ kernel, project, board, pads: ESP32_PADS, manifests: MANIFESTS });
  post({
    type: 'state',
    t: kernel.now,
    running,
    rate,
    observables: observables as never,
    diagnostics: kernel.diagnostics.slice(-20),
    halted: mcu instanceof Esp32Mcu ? mcu.halted : null,
    steps: evaluateLesson(),
    flows,
    terminalCurrents,
    voltages,
    notes,
  });
}

// Pacing: virtual time follows wall-clock time × speed. The loop runs in ~8 ms bursts and yields
// through a MessageChannel (not setTimeout, which is clamped), so UI messages are handled
// between bursts while the emulator gets almost all of the worker's time. When the emulator
// can't keep up, the lag is capped instead of accumulating.
const BURST_MS = 8;
const PUBLISH_MS = 33;
const MAX_LAG = 100 * MS;
let simTarget = 0;
let lastWall = performance.now();
let lastPublish = 0;
let rateWindow = { wall: performance.now(), sim: 0 };
let rate = 0;
const loop = new MessageChannel();
loop.port1.onmessage = tick;
function schedule(): void {
  loop.port2.postMessage(null);
}

function tick(): void {
  const wall = performance.now();
  const elapsed = wall - lastWall;
  lastWall = wall;
  if (!running || !kernel) {
    setTimeout(tick, 50);
    return;
  }
  simTarget = Math.min(simTarget + elapsed * MS * speed, kernel.now + MAX_LAG);
  simTarget = Math.max(simTarget, kernel.now);
  const deadline = wall + BURST_MS;
  while (kernel.now < simTarget && performance.now() < deadline) {
    kernel.advanceTo(Math.min(simTarget, kernel.now + 1 * MS));
  }
  if (wall - rateWindow.wall > 500) {
    rate = (kernel.now - rateWindow.sim) / S / ((wall - rateWindow.wall) / 1000);
    rateWindow = { wall, sim: kernel.now };
  }
  if (wall - lastPublish > PUBLISH_MS) {
    publish(rate);
    lastPublish = wall;
  }
  // Ahead of the clock (fast-forwarded idle time): wait instead of spinning
  if (kernel.now >= simTarget) setTimeout(tick, 4);
  else schedule();
}
setTimeout(tick, 50);

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'init':
        wasm = await Esp32Wasm.load(fetch(m.wasmUrl));
        break;
      case 'firmware':
        firmware = m.firmware;
        reset();
        break;
      case 'project':
        project = m.project;
        rebuild();
        break;
      case 'lesson':
        lesson = LESSONS.find((l) => l.id === m.lessonId) ?? null;
        publish(0);
        break;
      case 'run':
        running = true;
        lastWall = performance.now();
        simTarget = kernel?.now ?? 0;
        rateWindow = { wall: performance.now(), sim: kernel?.now ?? 0 };
        break;
      case 'pause':
        running = false;
        publish(0);
        break;
      case 'reset':
        reset();
        break;
      case 'speed':
        speed = m.speed;
        break;
      case 'press':
        if (!held.has(m.part)) held.set(m.part, new Set());
        held.get(m.part)!.add(m.key);
        // EN needs no special case: the button pulls the chip's EN pad low in the circuit
        kernel?.press(m.part, m.key);
        publish(0);
        break;
      case 'release':
        held.get(m.part)?.delete(m.key);
        if (held.get(m.part)?.size === 0) held.delete(m.part);
        kernel?.release(m.part, m.key);
        publish(0);
        break;
      case 'serial-in':
        if (mcu instanceof Esp32Mcu) mcu.serialWrite(new TextEncoder().encode(m.text));
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
