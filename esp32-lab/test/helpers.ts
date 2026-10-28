import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { BoardDef, BreadboardDef, PartInstance, Project, Wire } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import led from '@esp32lab-parts/led';
import pushbutton from '@esp32lab-parts/pushbutton';
import resistor from '@esp32lab-parts/resistor';
import board from '../boards/esp32-devkit-v1/board.json';
import half400 from '../breadboards/half-400/breadboard.json';

export const PARTS = { led, resistor, pushbutton };
export const BOARD = board as BoardDef;
export const BREADBOARDS: Record<string, BreadboardDef> = { 'half-400': half400 as BreadboardDef };

export function project(parts: PartInstance[] = [], wires: Wire[] = []): Project {
  return {
    schemaVersion: 1,
    board: { type: 'esp32-devkit-v1', x: 0, y: 0 },
    breadboards: [{ id: 'bb1', type: 'half-400', x: 14, y: 0 }],
    parts,
    wires,
    firmware: { kind: 'none' },
    seed: 42,
  };
}

export function kernel(p: Project, setup?: (mcu: ScriptedMcu) => void) {
  const mcu = new ScriptedMcu(ESP32_PAD_NAMES);
  setup?.(mcu);
  const k = new SimKernel({ project: p, board: BOARD, breadboards: BREADBOARDS, parts: PARTS, mcu });
  return { k, mcu };
}

export const hole = (h: string) => ({ kind: 'hole' as const, bb: 'bb1', hole: h });
export const pin = (name: string) => ({ kind: 'board' as const, pin: name });
export const wire = (id: string, a: Wire['a'], b: Wire['b']): Wire => ({ id, a, b });
