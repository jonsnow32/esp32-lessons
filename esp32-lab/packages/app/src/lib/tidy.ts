// Tidy the wires: route every wire over the half-pitch grid, horizontal and vertical steps
// only, with the cheapest path (Dijkstra over grid point + heading). What costs:
//   bends; passing over a pin (the board's, a part's leg, a hole a wire ends in); passing over
//   an empty breadboard hole; running along another wire; crossing one.
// How much bends, pins and holes weigh against each other is a matter of taste: see TIDY_MODES.
// Running half a pitch to a pitch beside another wire is cheaper than open space, so wires
// bundle up in parallel. Between the rows of holes (on the half pitch) a wire passes nothing.
// Wires are routed shortest first, then each once more with all the others in place.

import type { Project } from '@esp32lab/project-model';
import { PARTS } from './catalog';
import { benchBounds, board, breadboard, endpointPos, terminalPos, type Pt } from './geometry';

const STEP = 0.1; // per half pitch
const BESIDE = 0.05; // per half pitch, next to another wire
const OVERLAP = 20; // per half pitch along another wire: reads as one wire
const CROSS = 1;

// Headings: right, down, left, up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export interface TidyMode {
  name: string;
  hint: string;
  bend: number;
  /** Over a pin: reads as a connection. */
  pin: number;
  /** Over an empty breadboard hole. */
  hole: number;
}

export const TIDY_MODES: TidyMode[] = [
  { name: 'Né chân', hint: 'không qua chân hay lỗ nào, chạy giữa các hàng lỗ', bend: 4, pin: 40, hole: 5 },
  { name: 'Cân bằng', hint: 'né chân, qua vài lỗ trống để bớt gấp khúc', bend: 4, pin: 40, hole: 1 },
  { name: 'Ít gấp', hint: 'ít gấp khúc nhất, chỉ vòng qua chân khi đáng', bend: 6, pin: 12, hole: 0 },
];

/** A binary min-heap of [cost, state]. */
class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, number]) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** The corners each wire should bend through (empty: a straight run), by wire id. */
export function tidyWires(project: Project, mode: TidyMode = TIDY_MODES[0]!): Map<string, Pt[]> {
  const { bend: BEND, pin: PIN, hole: HOLE } = mode;
  const box = benchBounds(project, 3);
  const x0 = Math.floor(box.x);
  const y0 = Math.floor(box.y);
  const W = Math.ceil((box.w + 2) * 2);
  const H = Math.ceil((box.h + 2) * 2);
  const node = (p: Pt) => Math.round((p.x - x0) * 2) + W * Math.round((p.y - y0) * 2);
  const at = (n: number): Pt => ({ x: x0 + (n % W) / 2, y: y0 + Math.floor(n / W) / 2 });

  // What lies under each grid point
  const under = new Float64Array(W * H);
  const mark = (p: Pt, cost: number) => {
    const n = node(p);
    if (n >= 0 && n < under.length) under[n] = Math.max(under[n]!, cost);
  };
  for (const inst of project.breadboards) {
    for (const h of breadboard(inst.type)?.holes.values() ?? []) mark({ x: inst.x + h.x, y: inst.y + h.y }, HOLE);
  }
  for (const pin of board(project).pins) mark({ x: project.board.x + pin.x, y: project.board.y + pin.y }, PIN);
  for (const part of project.parts) {
    for (const t of PARTS[part.type]?.manifest.terminals ?? []) {
      const p = terminalPos(project, part, t.name);
      if (p) mark(p, PIN);
    }
  }
  const ends = new Map<string, [Pt, Pt]>();
  for (const w of project.wires) {
    const a = endpointPos(project, w.a);
    const b = endpointPos(project, w.b);
    if (!a || !b || node(a) === node(b)) continue;
    ends.set(w.id, [a, b]);
    mark(a, PIN);
    mark(b, PIN);
  }

  /** Grid points a route passes, in order. */
  const routes = new Map<string, number[]>();

  function route(id: string) {
    const [a, b] = ends.get(id)!;
    // The other wires: the steps they take (by grid point and axis) and the points they pass
    const used = [new Uint8Array(W * H), new Uint8Array(W * H)]; // [horizontal, vertical] step from n to n+1 / n+W
    const passed = [new Uint8Array(W * H), new Uint8Array(W * H)];
    for (const [k, r] of routes) {
      if (k === id) continue;
      for (let i = 1; i < r.length; i++) {
        const [u, v] = [Math.min(r[i - 1]!, r[i]!), Math.max(r[i - 1]!, r[i]!)];
        const axis = v - u === 1 ? 0 : 1;
        used[axis]![u] = 1;
        passed[axis]![u] = 1;
        passed[axis]![v] = 1;
      }
    }
    const beside = (u: number, axis: number) => {
      const off = axis === 0 ? W : 1;
      for (const k of [1, 2]) {
        if (used[axis]![u + k * off] || used[axis]![u - k * off]) return true;
      }
      return false;
    };

    const start = node(a);
    const goal = node(b);
    const best = new Float64Array(W * H * 4).fill(Infinity);
    const prev = new Int32Array(W * H * 4).fill(-1);
    const heap = new Heap();
    for (let d = 0; d < 4; d++) {
      best[start * 4 + d] = 0;
      heap.push([0, start * 4 + d]);
    }
    let found = -1;
    while (heap.size) {
      const [c, s] = heap.pop();
      if (c > best[s]!) continue;
      const n = s >> 2;
      const d = s & 3;
      if (n === goal) {
        found = s;
        break;
      }
      const x = n % W;
      const y = Math.floor(n / W);
      for (let e = 0; e < 4; e++) {
        if ((e + 2) % 4 === d && n !== start) continue; // no turning back
        const nx = x + DX[e]!;
        const ny = y + DY[e]!;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = nx + W * ny;
        const axis = e % 2;
        const u = Math.min(n, m);
        let cost = used[axis]![u] ? OVERLAP : beside(u, axis) ? BESIDE : STEP;
        if (e !== d && n !== start) cost += BEND;
        if (m !== goal) cost += under[m]!;
        if (passed[1 - axis]![m]) cost += CROSS;
        const t = m * 4 + e;
        if (c + cost < best[t]!) {
          best[t] = c + cost;
          prev[t] = s;
          heap.push([c + cost, t]);
        }
      }
    }
    if (found < 0) return;
    const path: number[] = [];
    for (let s = found; s >= 0; s = prev[s]!) path.push(s >> 2);
    routes.set(id, path.reverse());
  }

  const order = [...ends.keys()].sort((i, j) => {
    const [a, b] = ends.get(i)!;
    const [c, d] = ends.get(j)!;
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y) - (Math.abs(d.x - c.x) + Math.abs(d.y - c.y));
  });
  for (const id of order) route(id);
  for (const id of order) route(id);

  // Only the corners: where the path turns
  const out = new Map<string, Pt[]>();
  for (const [id, r] of routes) {
    const corners: Pt[] = [];
    for (let i = 1; i < r.length - 1; i++) {
      if (r[i]! - r[i - 1]! !== r[i + 1]! - r[i]!) corners.push(at(r[i]!));
    }
    out.set(id, corners);
  }
  return out;
}
