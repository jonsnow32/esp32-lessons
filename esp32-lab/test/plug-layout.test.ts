import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { autoPlug } from '../packages/app/src/lib/autoplug';
import { BOARDS, BREADBOARDS, PARTS } from '../packages/app/src/lib/catalog';
import { boxesMeet, partRect } from '../packages/app/src/lib/geometry';
import { tidyWires } from '../packages/app/src/lib/tidy';

const kernel = (project: Project) =>
  new SimKernel({ project, board: BOARDS[project.board.type]!, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });

/** A half-size breadboard beside the board, the parts plugged in one by one as the user would. */
function plugged(types: string[]): Project {
  let project: Project = {
    schemaVersion: 1,
    board: { type: 'esp32-devkit-v1', x: 1, y: 3 },
    breadboards: [{ id: 'bb1', type: 'half-400', x: 15, y: 6 }],
    parts: [],
    wires: [],
    firmware: { kind: 'none' },
  };
  types.forEach((type, i) => {
    const id = `${type}${i}`;
    project.parts.push({ id, type, props: {}, placement: null, bench: { x: 4, y: 30, rot: 0 } });
    const r = autoPlug(project, id, kernel);
    if (!r.ok) throw new Error(`${id}: ${r.reason}`);
    project = r.project;
  });
  return project;
}

describe('plugging parts in one after another', () => {
  const project = plugged(['led', 'pushbutton', 'led', 'dht', 'relay', 'potentiometer']);

  it('keeps the parts the user plugged in apart, with room between them', () => {
    const mine = project.parts.filter((p) => p.type !== 'resistor');
    expect(mine.every((p) => p.placement)).toBe(true);
    for (const a of mine) {
      for (const b of mine) {
        if (a.id < b.id) expect(boxesMeet(partRect(project, a)!, partRect(project, b)!), `${a.id} / ${b.id}`).toBe(false);
      }
    }
  });

  it('routes only the new wires, around the ones already there', () => {
    const all = tidyWires(project);
    const tidy: Project = { ...project, wires: project.wires.map((w) => ({ ...w, points: all.get(w.id) ?? [] })) };
    tidy.parts = [...tidy.parts, { id: 'buzzer1', type: 'buzzer', props: {}, placement: null, bench: { x: 4, y: 30, rot: 0 } }];
    const r = autoPlug(tidy, 'buzzer1', kernel);
    if (!r.ok) throw new Error(r.reason);
    const fresh = new Set(r.project.wires.map((w) => w.id).filter((id) => !tidy.wires.some((w) => w.id === id)));
    expect(fresh.size).toBeGreaterThan(0);
    const routes = tidyWires(r.project, undefined, undefined, fresh);
    expect([...routes.keys()].sort()).toEqual([...fresh].sort());
  });
});
