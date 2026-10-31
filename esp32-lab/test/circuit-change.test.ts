import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { Project } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { applyChange, autoPlug } from '../packages/app/src/lib/autoplug';
import { BOARDS, BREADBOARDS, PARTS } from '../packages/app/src/lib/catalog';

const kernel = (project: Project) =>
  new SimKernel({ project, board: BOARDS[project.board.type]!, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });

const bench = (parts: Project['parts'] = []): Project => ({
  schemaVersion: 1,
  board: { type: 'esp32-devkit-v1', x: 1, y: 3 },
  breadboards: [{ id: 'bb1', type: 'half-400', x: 15, y: 6 }],
  parts,
  wires: [],
  firmware: { kind: 'none' },
});

/** Are the two netlist keys on the same net? */
const joined = (project: Project, a: string, b: string) => {
  const n = kernel(project).netlist;
  return n.net(a) !== undefined && n.net(a) === n.net(b);
};

describe('a circuit change the AI assistant proposes', () => {
  it('adds a water pump behind the relay on the bench, the rest plugged in', () => {
    // A relay already plugged in, as the user had it
    const start = bench([{ id: 'relay1', type: 'relay', props: {}, placement: null, bench: { x: 30, y: 30, rot: 0 } }]);
    const plugged = autoPlug(start, 'relay1', kernel);
    if (!plugged.ok) throw new Error(plugged.reason);

    const r = applyChange(
      plugged.project,
      { parts: [{ id: 'pump1', type: 'water-pump' }], wires: [['board:VIN', 'relay1.com'], ['relay1.no', 'pump1.pos']] },
      kernel,
    );
    if (!r.ok) throw new Error(r.reason);
    const p = r.project;
    expect(p.parts.find((x) => x.id === 'pump1')?.placement?.bb).toBe('bb1');
    expect(joined(p, keyOf.terminal('relay1', 'no'), keyOf.terminal('pump1', 'pos'))).toBe(true);
    expect(joined(p, keyOf.terminal('relay1', 'com'), keyOf.boardPin('VIN'))).toBe(true);
    // The pump's negative leg was left to the plug-in: GND
    expect(kernel(p).netlist.net(keyOf.terminal('pump1', 'neg'))).toBe(kernel(p).netlist.net(GROUND_KEY));
    expect(r.report.join('\n')).toMatch(/cắm pump1: .*GND/);
    // The user's project is left as it was
    expect(plugged.project.parts.some((x) => x.id === 'pump1')).toBe(false);
  });

  it('wires a signal leg to the pin the code uses, and plugs in the rest', () => {
    const r = applyChange(bench(), { parts: [{ id: 'led1', type: 'led', props: { color: 'green' } }], wires: [] }, kernel);
    if (!r.ok) throw new Error(r.reason);
    expect(r.report.join('\n')).toMatch(/cắm led1: .*qua 220 Ω/);

    const exact = applyChange(bench(), { parts: [{ id: 'relay1', type: 'relay' }], wires: [['board:D23', 'relay1.in']] }, kernel);
    if (!exact.ok) throw new Error(exact.reason);
    expect(joined(exact.project, keyOf.boardPin('D23'), keyOf.terminal('relay1', 'in'))).toBe(true);
    expect(exact.report.join('\n')).not.toMatch(/IN →/);
  });

  it('says what is wrong instead of guessing', () => {
    const fail = (change: Parameters<typeof applyChange>[1]) => {
      const r = applyChange(bench([{ id: 'led1', type: 'led', props: {}, placement: null, bench: { x: 30, y: 30, rot: 0 } }]), change, kernel);
      return r.ok ? '' : r.reason;
    };
    expect(fail({ parts: [{ id: 'x1', type: 'flux-capacitor' }], wires: [] })).toContain('Không có loại linh kiện');
    expect(fail({ parts: [{ id: 'led1', type: 'led' }], wires: [] })).toContain('Đã có linh kiện led1');
    expect(fail({ parts: [{ id: 'led2', type: 'led', props: { color: 'purple' } }], wires: [] })).toContain('không hợp');
    expect(fail({ parts: [], wires: [['led1.plus', 'board:D2']] })).toContain('led1 không có chân "plus"');
    expect(fail({ parts: [], wires: [['led1.anode', 'board:D99']] })).toContain('không có chân "D99"');
    expect(fail({ parts: [], wires: [['pump9.pos', 'board:VIN']] })).toContain('Không có linh kiện "pump9"');
  });
  it('skips a wire between two places already joined', () => {
    const first = applyChange(bench(), { parts: [{ id: 'led1', type: 'led' }], wires: [] }, kernel);
    if (!first.ok) throw new Error(first.reason);
    const again = applyChange(first.project, { parts: [], wires: [['led1.cathode', 'board:GND.R'], ['board:GND.L', 'board:GND.R']] }, kernel);
    if (!again.ok) throw new Error(again.reason);
    expect(again.project.wires.length).toBe(first.project.wires.length);
    expect(again.report.join('\n')).toMatch(/bỏ dây led1.cathode – board:GND.R: hai chỗ đã thông nhau/);
  });

  it('fixes a wrong wire by taking it off, not by wiring around it', () => {
    // An LED straight on D4 with no resistor
    const wrong = applyChange(bench(), { parts: [{ id: 'led1', type: 'led' }], wires: [['board:D4', 'led1.anode'], ['led1.cathode', 'board:GND.R']] }, kernel);
    if (!wrong.ok) throw new Error(wrong.reason);
    expect(wrong.project.wires.length).toBe(2);
    const fixed = applyChange(
      wrong.project,
      { disconnect: ['led1.anode'], parts: [{ id: 'r1', type: 'resistor', props: { resistance: 220 } }], wires: [['board:D4', 'r1.a'], ['r1.b', 'led1.anode']] },
      kernel,
    );
    if (!fixed.ok) throw new Error(fixed.reason);
    const p = fixed.project;
    expect(fixed.report.join('\n')).toMatch(/ngắt 1 dây khỏi led1.anode/);
    expect(joined(p, keyOf.boardPin('D4'), keyOf.terminal('led1', 'anode'))).toBe(false);
    expect(joined(p, keyOf.boardPin('D4'), keyOf.terminal('r1', 'a'))).toBe(true);
    expect(joined(p, keyOf.terminal('r1', 'b'), keyOf.terminal('led1', 'anode'))).toBe(true);
    // The cathode wire and the two new ones, nothing more
    expect(p.wires.length).toBe(3);
  });

  it('takes a part off with its wires and the rail feed nothing else uses', () => {
    const r = applyChange(bench(), { parts: [{ id: 'relay1', type: 'relay' }], wires: [] }, kernel);
    if (!r.ok) throw new Error(r.reason);
    expect(r.project.wires.length).toBeGreaterThan(0);
    const gone = applyChange(r.project, { remove: ['relay1'], parts: [], wires: [] }, kernel);
    if (!gone.ok) throw new Error(gone.reason);
    expect(gone.project.parts).toEqual([]);
    expect(gone.project.wires).toEqual([]);
    expect(applyChange(r.project, { remove: ['nope'], parts: [], wires: [] }, kernel)).toMatchObject({ ok: false });
  });
  it('takes off the resistors the plug-in put in for a part it removes, unless they are wired again', () => {
    // A MOSFET with its series and pull-down resistors, swapped for a relay
    const q = applyChange(bench(), { parts: [{ id: 'q1', type: 'mosfet' }], wires: [] }, kernel);
    if (!q.ok) throw new Error(q.reason);
    expect(q.project.parts.filter((p) => p.type === 'resistor')).toHaveLength(2);
    const r = applyChange(q.project, { remove: ['q1'], parts: [{ id: 'relay1', type: 'relay' }], wires: [] }, kernel);
    if (!r.ok) throw new Error(r.reason);
    expect(r.project.parts.map((p) => p.id)).toEqual(['relay1']);
    expect(r.report.join('\n')).toMatch(/gỡ resistor\d, resistor\d: điện trở của linh kiện đã gỡ/);

    // An LED's resistor the change wires to the new part stays
    const led = applyChange(bench(), { parts: [{ id: 'led1', type: 'led' }], wires: [] }, kernel);
    if (!led.ok) throw new Error(led.reason);
    const swapped = applyChange(led.project, { remove: ['led1'], parts: [{ id: 'buz1', type: 'buzzer' }], wires: [] }, kernel);
    if (!swapped.ok) throw new Error(swapped.reason);
    expect(swapped.project.parts.map((p) => p.id)).toEqual(['buz1']);
    const kept = applyChange(led.project, { remove: ['led1'], parts: [{ id: 'buz1', type: 'buzzer' }], wires: [['resistor1.b', 'buz1.plus']] }, kernel);
    if (!kept.ok) throw new Error(kept.reason);
    expect(kept.project.parts.map((p) => p.id)).toContain('resistor1');
  });
  it('moves a part plugged in wrong by taking it off and adding it again under the same id', () => {
    // A relay whose legs sit in one strip: bypassed
    const start = bench([{ id: 'rl1', type: 'relay', props: {}, placement: { bb: 'bb1', hole: 'c10', rot: 90 } }]);
    expect(kernel(start).netlist.net(keyOf.terminal('rl1', 'vcc'))).toBe(kernel(start).netlist.net(keyOf.terminal('rl1', 'gnd')));
    const r = applyChange(start, { remove: ['rl1'], parts: [{ id: 'rl1', type: 'relay' }], wires: [['board:D23', 'rl1.in']] }, kernel);
    if (!r.ok) throw new Error(r.reason);
    const n = kernel(r.project).netlist;
    const [vcc, gnd] = [n.net(keyOf.terminal('rl1', 'vcc')), n.net(keyOf.terminal('rl1', 'gnd'))];
    expect(vcc).not.toBe(gnd);
    expect(r.project.parts.filter((p) => p.id === 'rl1')).toHaveLength(1);
  });
});
