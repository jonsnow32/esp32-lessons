// Simulation worker: the circuit kernel plus the ESP32 emulator, paced against wall-clock time.
// The UI only sends edits and interactions and draws the state this posts back.

import { evaluateStep, type Lesson } from '@esp32lab/lesson-engine';
import { Esp32Mcu, Esp32Wasm } from '@esp32lab/mcu-esp32';
import { MS, S } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel, type McuModel } from '@esp32lab/sim-core';
import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { BOARDS, BREADBOARDS, LESSONS, PARTS } from '../lib/catalog';
import type { FirmwareFiles, FromWorker, StepResult, ToWorker } from './protocol';

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
const held = new Set<string>();

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
  for (const part of held) kernel.press(part);
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
  if (!kernel) return;
  const observables: Record<string, Record<string, unknown>> = {};
  for (const id of kernel.terminals().keys()) observables[id] = kernel.observables(id);
  post({
    type: 'state',
    t: kernel.now,
    running,
    rate,
    observables: observables as never,
    diagnostics: kernel.diagnostics.slice(-20),
    halted: mcu instanceof Esp32Mcu ? mcu.halted : null,
    steps: evaluateLesson(),
  });
}

// Pacing: every tick, advance by the wall time that passed × speed, in 1 ms slices, but never
// spend more than ~12 ms of wall time per tick so the worker stays responsive.
const TICK_MS = 16;
let lastWall = performance.now();
setInterval(() => {
  const wall = performance.now();
  const elapsed = wall - lastWall;
  lastWall = wall;
  if (!running || !kernel) return;
  const startSim = kernel.now;
  const target = kernel.now + Math.min(elapsed, 100) * MS * speed;
  const deadline = performance.now() + 12;
  while (kernel.now < target && performance.now() < deadline) {
    kernel.advanceTo(Math.min(target, kernel.now + 1 * MS));
  }
  publish(((kernel.now - startSim) / S) / (elapsed / 1000));
}, TICK_MS);

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
        held.add(m.part);
        // The EN button holds the chip in reset; releasing it reboots the firmware
        if (m.part === 'board.en') running = false;
        kernel?.press(m.part);
        publish(0);
        break;
      case 'release':
        held.delete(m.part);
        kernel?.release(m.part);
        if (m.part === 'board.en') {
          reset();
          running = true;
        }
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
