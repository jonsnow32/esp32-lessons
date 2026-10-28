// Messages between the UI thread and the simulation worker.

import type { Note } from '@esp32lab/explain';
import type { CheckResult } from '@esp32lab/lesson-engine';
import type { Observable } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';
import type { Diagnostic, EdgeKind } from '@esp32lab/sim-core';

/** Current along one physical connection: positive = from `a` to `b` (netlist keys). */
export interface FlowView {
  kind: EdgeKind;
  id?: string;
  a: string;
  b: string;
  amps: number;
}

export interface FirmwareFiles {
  env: string;
  elf: Uint8Array;
  bin: Uint8Array;
  bootloader?: Uint8Array;
  partitions?: Uint8Array;
}

export type ToWorker =
  | { type: 'init'; wasmUrl: string }
  | { type: 'firmware'; firmware: FirmwareFiles | null }
  | { type: 'project'; project: Project }
  | { type: 'lesson'; lessonId: string | null }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'speed'; speed: number }
  | { type: 'press'; part: string }
  | { type: 'release'; part: string }
  | { type: 'serial-in'; text: string };

export interface StepResult {
  id: string;
  title: string;
  pass: boolean;
  hint?: string;
  results: CheckResult[];
}

export type FromWorker =
  | {
      type: 'state';
      /** Virtual time, ns */
      t: number;
      running: boolean;
      /** Simulated seconds per wall-clock second over the last interval */
      rate: number;
      observables: Record<string, Record<string, Observable>>;
      diagnostics: Diagnostic[];
      halted: string | null;
      steps: StepResult[];
      /** Edges carrying more than 1 µA. */
      flows: FlowView[];
      /** Current into each terminal of each user/onboard part (A). */
      terminalCurrents: Record<string, Record<string, number>>;
      /** Voltage per netlist key (holes, pins, terminals); null = floating. */
      voltages: Record<string, number | null>;
      notes: Note[];
    }
  | { type: 'serial'; text: string }
  | { type: 'error'; message: string };
