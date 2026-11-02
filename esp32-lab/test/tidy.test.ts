// Tidying the wires on every featured bench and lesson, laid out afresh: in either mode no wire
// passes over a pin it does not end on, and wires seldom cross.

import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { arrange } from '../packages/app/src/lib/arrange';
import { BOARDS, BREADBOARDS, FEATURED, LESSONS, PARTS } from '../packages/app/src/lib/catalog';
import { board, endpointPos, terminalPos, wireRoute, type Pt } from '../packages/app/src/lib/geometry';
import { TIDY_MODES, tidyWires } from '../packages/app/src/lib/tidy';

const kernel = (project: Project) =>
  new SimKernel({ project, board: BOARDS[project.board.type]!, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });

const benches: [string, Project][] = [];
for (const f of FEATURED) {
  const r = arrange(f.project, kernel);
  if (r.ok) benches.push([f.id, r.project]);
}
for (const l of LESSONS) { const r = arrange(l.template, kernel); if (r.ok) benches.push([l.id, r.project]); }

type Seg = [Pt, Pt];
function cross(s: Seg, t: Seg) {
  const [a, b] = s, [c, d] = t;
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function overlap(s: Seg, t: Seg) {
  const [a, b] = s, [c, d] = t;
  // collinear axis-aligned or general collinear overlap length
  const cr = (p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cr(c)) > 1e-6 || Math.abs(cr(d)) > 1e-6) return 0;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!L) return 0;
  const proj = (p: Pt) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L;
  const [u, v] = [proj(c), proj(d)].sort((x, y) => x - y);
  return Math.max(0, Math.min(L, v!) - Math.max(0, u!));
}
function score(project: Project, routes: Map<string, Pt[]>, free: boolean) {
  const pins: Pt[] = [];
  for (const pin of board(project).pins) pins.push({ x: project.board.x + pin.x, y: project.board.y + pin.y });
  for (const p of project.parts) for (const t of PARTS[p.type]?.manifest.terminals ?? []) { const q = terminalPos(project, p, t.name); if (q) pins.push(q); }
  const wires = project.wires.map((w) => {
    const a = endpointPos(project, w.a)!, b = endpointPos(project, w.b)!;
    for (const e of [a, b]) pins.push(e);
    return { id: w.id, r: wireRoute(a, b, routes.get(w.id) ?? w.points ?? [], free) };
  });
  let len = 0, bends = 0, crosses = 0, over = 0, hits = 0;
  const segs = wires.map((w) => w.r.slice(1).map((p, i) => [w.r[i]!, p] as Seg));
  for (const [i, w] of wires.entries()) {
    bends += w.r.length - 2;
    for (const [p, q] of segs[i]!) {
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      len += L;
      for (const pin of pins) {
        if (Math.hypot(pin.x - w.r[0]!.x, pin.y - w.r[0]!.y) < 0.01 || Math.hypot(pin.x - w.r.at(-1)!.x, pin.y - w.r.at(-1)!.y) < 0.01) continue;
        const t = Math.max(0, Math.min(1, ((pin.x - p.x) * (q.x - p.x) + (pin.y - p.y) * (q.y - p.y)) / (L * L || 1)));
        if (Math.hypot(p.x + t * (q.x - p.x) - pin.x, p.y + t * (q.y - p.y) - pin.y) < 0.3) hits++;
      }
    }
    for (let j = i + 1; j < wires.length; j++) for (const s of segs[i]!) for (const t of segs[j]!) { if (cross(s, t)) crosses++; over += overlap(s, t); }
  }
  return { len: Math.round(len), bends, crosses, over: Math.round(over * 10) / 10, hits };
}

describe('tidying the wires', () => {
  for (const mode of TIDY_MODES) {
    it(`routes every wire ${mode.name}, over no pin, crossing seldom`, () => {
      let crosses = 0;
      let slowest = 0;
      for (const [name, p] of benches) {
        const t0 = performance.now();
        const routes = tidyWires(p, mode);
        slowest = Math.max(slowest, performance.now() - t0);
        expect(routes.size, name).toBe(p.wires.length);
        const s = score(p, routes, !!mode.free);
        expect(s.hits, name).toBe(0);
        expect(s.over, name).toBe(0);
        crosses += s.crosses;
      }
      // Measured: 13 square, 7 free (five modes before: 29 to 74)
      expect(crosses).toBeLessThanOrEqual(20);
      console.log(`${mode.name}: ${crosses} crossings, slowest bench ${Math.round(slowest)} ms`);
    });
  }
});
