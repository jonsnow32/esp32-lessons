import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { applyChange, type CircuitChange } from '../packages/app/src/lib/autoplug';
import { BOARDS, BREADBOARDS, PARTS } from '../packages/app/src/lib/catalog';
import { verifyChange, verifyCircuit } from '../packages/app/src/lib/verify';

const kernel = (project: Project) =>
  new SimKernel({ project, board: BOARDS[project.board.type]!, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });

const bench = (): Project => ({
  schemaVersion: 1,
  board: { type: 'esp32-devkit-v1', x: 1, y: 3 },
  breadboards: [{ id: 'bb1', type: 'half-400', x: 15, y: 6 }],
  parts: [],
  wires: [],
  firmware: { kind: 'none' },
});

/** The findings of a change planned on an empty bench, as "[level] text" lines. */
function check(change: CircuitChange, start = bench()) {
  const r = applyChange(start, change, kernel);
  if (!r.ok) throw new Error(r.reason);
  return verifyChange(start, r.project).map((f) => `[${f.level}] ${f.text}`);
}
const errors = (lines: string[]) => lines.filter((l) => l.startsWith('[error]'));

describe('checking a circuit the AI assistant proposes', () => {
  it('passes parts plugged in the way their manifest says', () => {
    expect(errors(check({ parts: [{ id: 'led1', type: 'led' }], wires: [] }))).toEqual([]);
    expect(errors(check({ parts: [{ id: 'relay1', type: 'relay' }, { id: 'pump1', type: 'water-pump' }], wires: [['board:D23', 'relay1.in'], ['board:VIN', 'relay1.com'], ['relay1.no', 'pump1.pos']] }))).toEqual([]);
    expect(errors(check({ parts: [{ id: 'oled1', type: 'ssd1306' }], wires: [] }))).toEqual([]);
    expect(errors(check({ parts: [{ id: 'dht1', type: 'dht' }], wires: [['board:D4', 'dht1.data']] }))).toEqual([]);
  });

  it('finds an LED without its current-limiting resistor', () => {
    const out = check({ parts: [{ id: 'led1', type: 'led' }], wires: [['board:D4', 'led1.anode'], ['led1.cathode', 'board:GND.R']] });
    expect(errors(out).join('\n')).toMatch(/led1 chịu .* mA.*thiếu điện trở hạn dòng/);
  });

  it('finds an LED plugged in backwards', () => {
    const out = check({ parts: [{ id: 'led1', type: 'led' }], wires: [['board:GND.R', 'led1.anode'], ['led1.cathode', 'board:3V3']] });
    expect(errors(out).join('\n')).toMatch(/led1: chân .*cắm ngược/);
  });

  it('finds a pump run straight from a GPIO', () => {
    const out = check({ parts: [{ id: 'pump1', type: 'water-pump' }], wires: [['board:D23', 'pump1.pos'], ['pump1.neg', 'board:GND.R']] });
    expect(errors(out).join('\n')).toMatch(/Chân D23 phải cấp .*relay hoặc MOSFET/);
  });

  it('finds a module powered from a GPIO, and I2C lines swapped', () => {
    const relay = check({ parts: [{ id: 'relay1', type: 'relay' }], wires: [['board:D23', 'relay1.in'], ['board:D22', 'relay1.vcc']] });
    expect(errors(relay).join('\n')).toMatch(/relay1: chân nguồn .*phải nối thẳng VIN/);
    const oled = check({ parts: [{ id: 'oled1', type: 'ssd1306' }], wires: [['board:D22', 'oled1.sda'], ['board:D21', 'oled1.scl']] });
    expect(errors(oled).join('\n')).toMatch(/SDA và SCL bị đảo/);
  });

  it('finds an output on an input-only pin and a part bypassed by a wire', () => {
    const out = check({ parts: [{ id: 'relay1', type: 'relay' }], wires: [['board:D34', 'relay1.in']] });
    expect(errors(out).join('\n')).toMatch(/relay1 cần chân xuất tín hiệu nhưng D34/);
    const bypassed = check({ parts: [{ id: 'led1', type: 'led' }], wires: [['led1.anode', 'led1.cathode']] });
    expect(errors(bypassed).join('\n')).toMatch(/led1 bị nối tắt/);
  });

  it('leaves out what the bench had wrong already', () => {
    const r = applyChange(bench(), { parts: [{ id: 'led1', type: 'led' }], wires: [['board:D4', 'led1.anode'], ['led1.cathode', 'board:GND.R']] }, kernel);
    if (!r.ok) throw new Error(r.reason);
    expect(errors(verifyCircuit(r.project).map((f) => `[${f.level}] ${f.text}`))).not.toEqual([]);
    expect(errors(check({ parts: [{ id: 'led2', type: 'led' }], wires: [] }, r.project))).toEqual([]);
  });

  it('finds a part the change left open on one side', () => {
    const r = applyChange(bench(), { parts: [{ id: 'led1', type: 'led' }], wires: [] }, kernel);
    if (!r.ok) throw new Error(r.reason);
    const pin = r.report.join(' ').match(/→ (D\d+)/)![1];
    const out = check({ disconnect: [`board:${pin}`], parts: [], wires: [] }, r.project);
    expect(errors(out).join('\n')).toMatch(/resistor1: .*phía kia hở.*gỡ đi \(remove\)/);
  });
});
