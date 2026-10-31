import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arrange, sameCircuit, wireLength } from '../packages/app/src/lib/arrange';
import { BOARDS, BREADBOARDS, FEATURED, LESSONS, PARTS } from '../packages/app/src/lib/catalog';
import { boardBox, boxesMeet, partRect, terminalPos } from '../packages/app/src/lib/geometry';

const kernel = (project: Project) =>
  new SimKernel({ project, board: BOARDS[project.board.type]!, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });

/** Where the board's module lies on the bench. */
const boardRect = (p: Project) => {
  const b = boardBox(BOARDS[p.board.type]!);
  return { ...b, x: p.board.x + b.x, y: p.board.y + b.y };
};

const benches: [string, Project][] = [
  ...FEATURED.map((f) => [f.id, f.project] as [string, Project]),
  ...LESSONS.map((l) => [l.id, l.template] as [string, Project]),
];

describe('laying the whole bench out again', () => {
  for (const [name, project] of benches) {
    it(`keeps the circuit of ${name}, with no two parts on top of each other`, () => {
      const r = arrange(project, kernel);
      if (!r.ok) throw new Error(r.reason);
      const parts = r.project.parts.filter((p) => p.placement && p.type !== 'resistor');
      for (const a of parts) {
        for (const b of parts) {
          if (a.id < b.id) expect(boxesMeet(partRect(r.project, a)!, partRect(r.project, b)!), `${a.id} / ${b.id}`).toBe(false);
        }
      }
    });
  }
});

describe('telling whether two benches make the same circuit', () => {
  const f = FEATURED.find((x) => x.id === 'traffic-light')!;
  it('notices a wire gone and a wire added', () => {
    const missing = { ...f.project, wires: f.project.wires.slice(1) };
    expect(sameCircuit(f.project, missing, kernel, new Set())).toMatch(/bị tách/);
    const extra = { ...f.project, wires: [...f.project.wires, { id: 'x', a: { kind: 'board' as const, pin: 'D4' }, b: f.project.wires[0]!.a, color: '#000' }] };
    expect(sameCircuit(f.project, extra, kernel, new Set())).not.toBe(true);
    expect(sameCircuit(f.project, f.project, kernel, new Set())).toBe(true);
  });

  it('notices a resistor laid again with another value', () => {
    const r = arrange(f.project, kernel);
    if (!r.ok) throw new Error(r.reason);
    const relaid = new Set(f.project.parts.filter((p) => p.type === 'resistor').map((p) => p.id));
    expect(relaid.size).toBeGreaterThan(0);
    expect(sameCircuit(f.project, r.project, kernel, relaid)).toBe(true);
    const other = structuredClone(r.project);
    other.parts.find((p) => p.type === 'resistor')!.props = { resistance: 1000 };
    expect(sameCircuit(f.project, other, kernel, relaid)).toBe('điện trở không còn đúng chỗ');
  });
});

describe('grouping parts that work together', () => {
  it('lays the pump right by the relay that switches it', () => {
    const f = FEATURED.find((x) => x.id === 'plant-watering')!;
    const r = arrange(f.project, kernel);
    if (!r.ok) throw new Error(r.reason);
    expect(r.report.join(' ')).toContain('rl1 + pump1');
    // The relay contact and the pump leg it feeds: no farther apart than on the hand-made bench
    const apart = (p: typeof f.project) => {
      const part = (id: string) => p.parts.find((q) => q.id === id)!;
      const [no, pos] = [terminalPos(p, part('rl1'), 'no')!, terminalPos(p, part('pump1'), 'pos')!];
      return Math.abs(no.x - pos.x) + Math.abs(no.y - pos.y);
    };
    expect(apart(r.project)).toBeLessThanOrEqual(apart(f.project));
  });

  it('puts both displays on one I2C bus in one group', () => {
    const r = arrange(FEATURED.find((x) => x.id === 'i2c-displays')!.project, kernel);
    if (!r.ok) throw new Error(r.reason);
    expect(r.report.join(' ')).toContain('lcd1 + oled1');
  });

  it('needs less wire than the hand-made layout on most featured projects', () => {
    const shorter = FEATURED.filter((f) => {
      const r = arrange(f.project, kernel);
      return r.ok && wireLength(r.project) <= wireLength(f.project);
    });
    expect(shorter.length).toBeGreaterThanOrEqual(FEATURED.length - 2);
  });
});

describe('a bench with no breadboard', () => {
  // Parts lying on the bench on top of each other, wired leg to pin: a pump switched by a MOSFET
  const messy = JSON.parse(readFileSync(new URL('./fixtures/open-bench-pump.json', import.meta.url), 'utf8')) as Project;

  it('lays every part clear of the board and of each other, the circuit unchanged, with far less wire', () => {
    const r = arrange(messy, kernel);
    if (!r.ok) throw new Error(r.reason);
    const module = boardRect(r.project);
    const parts = r.project.parts.filter((p) => p.type !== 'resistor');
    for (const a of parts) {
      expect(boxesMeet(partRect(r.project, a)!, module), `${a.id} / board`).toBe(false);
      for (const b of parts) {
        if (a.id < b.id) expect(boxesMeet(partRect(r.project, a)!, partRect(r.project, b)!), `${a.id} / ${b.id}`).toBe(false);
      }
    }
    expect(wireLength(r.project)).toBeLessThan(wireLength(messy) / 2);
    expect(r.report.join(' ')).toContain('mosfet1 + pump1 + d1');
  });
});
