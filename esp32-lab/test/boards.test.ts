import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { expandBreadboard, type BoardDef, type BreadboardDef } from '@esp32lab/project-model';
import { keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import devkitc from '../boards/esp32-devkitc-v4/board.json';
import devkit from '../boards/esp32-devkit-v1/board.json';
import nodemcu from '../boards/nodemcu-32s/board.json';
import full830 from '../breadboards/full-830/breadboard.json';
import half400 from '../breadboards/half-400/breadboard.json';
import mini170 from '../breadboards/mini-170/breadboard.json';
import { PARTS, project, wire } from './helpers';

const BOARDS = [devkit, devkitc, nodemcu] as unknown as BoardDef[];
const BREADBOARDS = { 'mini-170': mini170, 'half-400': half400, 'full-830': full830 } as unknown as Record<string, BreadboardDef>;

describe('breadboards', () => {
  it.each([
    ['mini-170', 170, 17 * 2],
    ['half-400', 400, 30 * 2 + 4],
    ['full-830', 830, 63 * 2 + 4],
  ])('%s has %i holes in %i strips', (id, holes, strips) => {
    const bb = expandBreadboard(BREADBOARDS[id]!);
    expect(bb.holes.size).toBe(holes);
    expect(bb.strips).toHaveLength(strips);
  });
});

describe.each(BOARDS.map((b) => [b.id, b] as const))('board %s', (_id, board) => {
  it('has unique pin names and real ESP32 pads', () => {
    expect(new Set(board.pins.map((p) => p.name)).size).toBe(board.pins.length);
    for (const p of board.pins) if ('pad' in p.connect) expect(ESP32_PAD_NAMES).toContain(p.connect.pad);
  });

  it('powers a resistor from its 3V3 pin to GND', () => {
    const gnd = board.pins.find((p) => 'net' in p.connect && p.connect.net === 'GND')!.name;
    const p = {
      ...project(
        [{ id: 'r1', type: 'resistor', props: { resistance: 1000 }, placement: null, bench: { x: 30, y: 30, rot: 0 } }],
        [wire('w1', { kind: 'board', pin: '3V3' }, { kind: 'part', part: 'r1', terminal: 'a' }), wire('w2', { kind: 'part', part: 'r1', terminal: 'b' }, { kind: 'board', pin: gnd })],
      ),
      board: { type: board.id, x: 0, y: 0 },
      breadboards: [],
    };
    const k = new SimKernel({ project: p, board, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });
    k.solve();
    expect(k.voltage(keyOf.terminal('r1', 'a'))).toBeCloseTo(3.3, 1);
  });
});
