import type { Project } from '@esp32lab/project-model';
import { describe, expect, it } from 'vitest';
import { duplicate, shiftGroup } from '../packages/app/src/lib/group';

const bench = (): Project =>
  ({
    schemaVersion: 1,
    board: { type: 'esp32-devkit-v1', x: 1, y: 3 },
    breadboards: [{ id: 'bb1', type: 'half-400', x: 15, y: 6 }],
    parts: [
      { id: 'led1', type: 'led', props: {}, placement: { bb: 'bb1', hole: 'a5', rot: 0 } },
      { id: 'resistor1', type: 'resistor', props: {}, placement: { bb: 'bb1', hole: 'c10', rot: 0 } },
      { id: 'led2', type: 'led', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } },
    ],
    wires: [{ id: 'w1', a: { kind: 'hole', bb: 'bb1', hole: 'e5' }, b: { kind: 'board', pin: 'GND.L' }, color: '#000', points: [{ x: 10, y: 20 }] }],
  }) as unknown as Project;

describe('group of selected things', () => {
  it('moves plugged parts to other holes and bench parts by the same pitches', () => {
    const items = [{ kind: 'part', id: 'led1' }, { kind: 'part', id: 'led2' }] as const;
    const r = shiftGroup(bench(), [...items], 2, 0);
    expect(r.ok).toBe(true);
    expect(r.project.parts[0]!.placement).toMatchObject({ bb: 'bb1', hole: 'a7' });
    expect(r.project.parts[2]!.bench).toMatchObject({ x: 42, y: 2 });
  });

  it('refuses a move that puts a leg on a taken hole or off the breadboard', () => {
    // a5 → c10, the resistor's first hole
    expect(shiftGroup(bench(), [{ kind: 'part', id: 'led1' }], 5, 2).ok).toBe(false);
    expect(shiftGroup(bench(), [{ kind: 'part', id: 'led1' }], -40, 0).ok).toBe(false);
  });

  it('moves a breadboard with what is plugged in, and wire corners when both ends move', () => {
    const r = shiftGroup(bench(), [{ kind: 'breadboard', id: 'bb1' }, { kind: 'board' }], 3, 4);
    expect(r.ok).toBe(true);
    expect(r.project.breadboards[0]).toMatchObject({ x: 18, y: 10 });
    expect(r.project.parts[0]!.placement!.hole).toBe('a5');
    expect(r.project.wires[0]!.points).toEqual([{ x: 13, y: 24 }]);
  });

  it('copies a breadboard with its parts and wires, beside the original', () => {
    const r = duplicate(bench(), [{ kind: 'breadboard', id: 'bb1' }])!;
    expect(r).not.toBeNull();
    expect(r.project.breadboards.map((b) => b.id)).toEqual(['bb1', 'bb2']);
    expect(r.project.parts.filter((p) => p.placement?.bb === 'bb2')).toHaveLength(2);
    expect(r.project.wires.some((w) => w.a.kind === 'hole' && w.a.bb === 'bb2')).toBe(true);
    expect(r.items).toContainEqual({ kind: 'breadboard', id: 'bb2' });
  });

  it('copies a plugged part onto free holes', () => {
    const r = duplicate(bench(), [{ kind: 'part', id: 'led1' }])!;
    const copy = r.project.parts.find((p) => p.id === 'led3');
    expect(copy?.placement?.bb).toBe('bb1');
    expect(copy?.placement?.hole).not.toBe('a5');
  });
});
