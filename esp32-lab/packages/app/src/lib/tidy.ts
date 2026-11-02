// Tidy the wires: route every wire over the half-pitch grid, horizontal and vertical steps
// only, with the cheapest path (A* over grid point + heading). What costs:
//   bends; passing over a pin (the board's, a part's leg, a hole a wire ends in) or a part's body; passing over
//   an empty breadboard hole; running along another wire; crossing one.
// Running half a pitch to a pitch beside another wire is cheaper than open space, so wires
// bundle up in parallel. Between the rows of holes (on the half pitch) a wire passes nothing.
//
// The wires are routed one after another, shortest first, then ripped up and routed again around
// all the others (negotiated rip-up and reroute) round after round, the worst wires first, for as
// long as the bench as a whole gets better; the best set found is kept. Several start orders are
// tried (shortest first, longest first, a few seeded shuffles) and the cheapest bench wins.
//
// Free mode starts from that grid route (bends cheap, as they are about to go) and pulls it taut
// like a string: the fewest, shortest straight runs between points of the route that keep a
// clearance off every pin and body, crossing no more of the other wires than the route did.
// Routing only some wires leaves the others where they lie.

import type { Project } from '@esp32lab/project-model';
import { rotate } from '@esp32lab/project-model';
import { PARTS } from './catalog';
import { benchBounds, board, boardBox, breadboard, endpointPos, partAnchor, terminalPos, wireRoute, type Box, type Pt } from './geometry';

const STEP = 0.1; // per half pitch
const BESIDE = 0.05; // per half pitch, next to another wire
const OVERLAP = 20; // per half pitch along another wire: reads as one wire
/** Over a pin: reads as a connection. */
const PIN = 40;
/** Per half pitch over the board's module: a short way across beats a long way round, a long one does not. */
const OVER_BOARD = 1;
/** Rip-up and reroute rounds at most (fewer when nothing gets better). */
const ROUNDS = 6;
/** Shuffled start orders tried besides shortest and longest first. */
const SHUFFLES = 2;
/** Shuffled orders are tried only while tidying has taken less than this. */
const BUDGET_MS = 200;
/** A free wire keeps this far (in pitches) off any pin or body it does not end on. */
const CLEARANCE = 0.32;
/** A free wire's corner, against its length in pitches. */
const FREE_CORNER = 1.5;
/** A free wire crossing another, against its length in pitches. */
const FREE_CROSS = 6;

// Headings: right, down, left, up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export interface TidyMode {
  id: 'grid' | 'free';
  name: string;
  hint: string;
  bend: number;
  /** Over an empty breadboard hole. */
  hole: number;
  /** Crossing another wire. */
  cross: number;
  /** Pull the route straight: cut corners at any angle wherever nothing lies under the shortcut. */
  free?: boolean;
}

export const TIDY_MODES: TidyMode[] = [
  { id: 'grid', name: 'Vuông góc', hint: 'ngang dọc gọn gàng, né chân và linh kiện, ít gấp khúc, ít cắt nhau', bend: 6, hole: 1, cross: 8 },
  // The grid route with bends nearly free (they are about to be cut), pulled taut
  { id: 'free', name: 'Tự do', hint: 'dây thẳng xiên mọi hướng, ngắn nhất, vẫn né chân và ít cắt nhau', bend: 0.2, hole: 0, cross: 6, free: true },
];

/** A binary min-heap of (cost, state), in flat arrays that grow as needed and are kept between searches. */
class Heap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.keys);
      v.set(this.vals);
      this.keys = k;
      this.vals = v;
    }
    const { keys, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  /** The cheapest key, still on the heap. */
  get topKey() {
    return this.keys[0]!;
  }
  /** Take the cheapest off, giving its state. */
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0]!;
    const n = --this.size;
    if (n > 0) {
      const key = keys[n]!;
      const val = vals[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[m]! >= key) break;
        keys[i] = keys[m]!;
        vals[i] = vals[m]!;
        i = m;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

type Seg = [Pt, Pt];

/** Do two segments cross properly (not just touch at an end)? */
function crosses([a, b]: Seg, [c, d]: Seg): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * The corners each wire should bend through (empty: a straight run), by wire id. `bodies`: each
 * part's drawn box, by part id, in its own unrotated units (as the part view is drawn); wires
 * keep off them like off a pin. `only`: route just these wires (the ones just added), around the
 * others as they lie now, so adding a part leaves the rest of the wiring alone.
 */
export function tidyWires(project: Project, mode: TidyMode = TIDY_MODES[0]!, bodies?: ReadonlyMap<string, Box>, only?: ReadonlySet<string>): Map<string, Pt[]> {
  const { bend: BEND, hole: HOLE, cross: CROSS } = mode;
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
  // The board's body, so a wire to a pin leaves on its own side rather than crossing the module
  const bb = boardBox(board(project));
  for (let y = Math.ceil((project.board.y + bb.y) * 2); y <= (project.board.y + bb.y + bb.h) * 2; y++) {
    for (let x = Math.ceil((project.board.x + bb.x) * 2); x <= (project.board.x + bb.x + bb.w) * 2; x++) mark({ x: x / 2, y: y / 2 }, OVER_BOARD);
  }
  /** Points a free wire keeps clear of: pins, and the boxes of bodies (by edges and inside). */
  const pins: Pt[] = [];
  const rects: Box[] = [];
  // Along a header between its pins: a wire there lies over the pins, so leave them sideways
  for (const pin of board(project).pins) {
    const p = { x: project.board.x + pin.x, y: project.board.y + pin.y };
    for (const dy of [-0.5, 0.5]) mark({ x: p.x, y: p.y + dy }, PIN / 2);
    mark(p, PIN);
    pins.push(p);
  }
  for (const part of project.parts) {
    const b = bodies?.get(part.id);
    const anchor = partAnchor(project, part);
    if (b && anchor) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [cx, cy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const) {
        const [dx, dy] = rotate(cx, cy, anchor.rot);
        xs.push(anchor.at.x + dx);
        ys.push(anchor.at.y + dy);
      }
      const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      rects.push(r);
      // Grid points under the body, and those within a quarter pitch of its edge
      for (let y = Math.ceil((r.y - 0.25) * 2); y <= (r.y + r.h + 0.25) * 2; y++) {
        for (let x = Math.ceil((r.x - 0.25) * 2); x <= (r.x + r.w + 0.25) * 2; x++) {
          if (x / 2 >= x0 && x / 2 < x0 + W / 2) mark({ x: x / 2, y: y / 2 }, PIN);
        }
      }
    }
    for (const t of PARTS[part.type]?.manifest.terminals ?? []) {
      const p = terminalPos(project, part, t.name);
      if (!p) continue;
      mark(p, PIN);
      pins.push(p);
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
    pins.push(a, b);
  }

  /** Grid points a route passes, in order. */
  const routes = new Map<string, number[]>();

  /** A drawn route as the grid points it passes (a slanted run as a staircase). */
  const staircase = (route: Pt[]) => {
    const path: number[] = [];
    for (let i = 1; i < route.length; i++) {
      const [sx, sy] = [Math.round((route[i - 1]!.x - x0) * 2), Math.round((route[i - 1]!.y - y0) * 2)];
      const [tx, ty] = [Math.round((route[i]!.x - x0) * 2), Math.round((route[i]!.y - y0) * 2)];
      if (!path.length) path.push(sx + W * sy);
      const n = Math.max(Math.abs(tx - sx), Math.abs(ty - sy));
      let [x, y] = [sx, sy];
      for (let k = 1; k <= n; k++) {
        const [nx, ny] = [Math.round(sx + ((tx - sx) * k) / n), Math.round(sy + ((ty - sy) * k) / n)];
        if (nx !== x && ny !== y) path.push(nx + W * y);
        path.push(nx + W * ny);
        [x, y] = [nx, ny];
      }
    }
    return path;
  };

  // The wires that stay put, as they are drawn now
  /** Each fixed wire's drawn route, for free wires to keep from crossing. */
  const fixed = new Map<string, Pt[]>();
  if (only) {
    for (const w of project.wires) {
      const e = ends.get(w.id);
      if (!e || only.has(w.id)) continue;
      const drawn = wireRoute(e[0], e[1], w.points ?? [], !!w.free);
      fixed.set(w.id, drawn);
      routes.set(w.id, staircase(drawn));
    }
  }

  // How often the other wires step along each grid edge (by grid point and axis) and pass each
  // point, kept up to date as wires are ripped up and laid again
  const used = [new Uint16Array(W * H), new Uint16Array(W * H)]; // [horizontal, vertical] step from n to n+1 / n+W
  const passed = [new Uint16Array(W * H), new Uint16Array(W * H)];
  const lay = (r: number[], k: 1 | -1) => {
    for (let i = 1; i < r.length; i++) {
      const [u, v] = [Math.min(r[i - 1]!, r[i]!), Math.max(r[i - 1]!, r[i]!)];
      const axis = v - u === 1 ? 0 : 1;
      used[axis]![u]! += k;
      passed[axis]![u]! += k;
      passed[axis]![v]! += k;
    }
  };
  for (const r of routes.values()) lay(r, 1);

  const beside = (u: number, axis: number) => {
    const off = axis === 0 ? W : 1;
    return used[axis]![u + off]! > 0 || used[axis]![u - off]! > 0 || used[axis]![u + 2 * off]! > 0 || used[axis]![u - 2 * off]! > 0;
  };
  /** Cost of one step from n to m heading e, having come heading d (-1 at the start). */
  const stepCost = (n: number, m: number, e: number, d: number, goal: number) => {
    const axis = e % 2;
    const u = Math.min(n, m);
    let cost = used[axis]![u] ? OVERLAP : beside(u, axis) ? BESIDE : STEP;
    if (d >= 0 && e !== d) cost += BEND;
    if (m !== goal) cost += under[m]!;
    if (passed[1 - axis]![m]) cost += CROSS;
    return cost;
  };
  /** What a laid route costs, the other wires as they lie now (its own lifted). */
  const pathCost = (r: number[]) => {
    let c = 0;
    let d = -1;
    for (let i = 1; i < r.length; i++) {
      const diff = r[i]! - r[i - 1]!;
      const e = diff === 1 ? 0 : diff === W ? 1 : diff === -1 ? 2 : 3;
      c += stepCost(r[i - 1]!, r[i]!, e, d, r[r.length - 1]!);
      d = e;
    }
    return c;
  };

  const best = new Float64Array(W * H * 4);
  const prev = new Int32Array(W * H * 4);
  /** Which search last touched each state: no clearing the big arrays before every search. */
  const seen = new Uint32Array(W * H * 4);
  let search = 0;
  const heap = new Heap();
  const bestOf = (t: number) => (seen[t] === search ? best[t]! : Infinity);
  const gx = (n: number) => n % W;
  const gy = (n: number) => Math.floor(n / W);

  /** The cheapest route for a wire around everything else as it lies now; its old one lifted first. */
  function route(id: string) {
    const old = routes.get(id);
    if (old) lay(old, -1);
    const [a, b] = ends.get(id)!;
    const start = node(a);
    const goal = node(b);
    const [tx, ty] = [gx(goal), gy(goal)];
    // A*: never more than the cheapest step per half pitch, plus a bend when not in line
    const h = (n: number) => {
      const dx = Math.abs(gx(n) - tx);
      const dy = Math.abs(gy(n) - ty);
      return BESIDE * (dx + dy) + (dx && dy ? BEND : 0);
    };
    search++;
    heap.clear();
    for (let d = 0; d < 4; d++) {
      seen[start * 4 + d] = search;
      best[start * 4 + d] = 0;
      prev[start * 4 + d] = -1;
      heap.push(h(start), start * 4 + d);
    }
    let found = -1;
    while (heap.size) {
      const f = heap.topKey;
      const s = heap.pop();
      const n = s >> 2;
      const c = best[s]!;
      if (f - h(n) > c + 1e-9) continue;
      const d = s & 3;
      if (n === goal) {
        found = s;
        break;
      }
      const x = gx(n);
      const y = gy(n);
      for (let e = 0; e < 4; e++) {
        if ((e + 2) % 4 === d && n !== start) continue; // no turning back
        const nx = x + DX[e]!;
        const ny = y + DY[e]!;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = nx + W * ny;
        const cost = stepCost(n, m, e, n === start ? -1 : d, goal);
        const t = m * 4 + e;
        if (c + cost < bestOf(t) - 1e-9) {
          seen[t] = search;
          best[t] = c + cost;
          prev[t] = s;
          heap.push(c + cost + h(m), t);
        }
      }
    }
    if (found < 0) {
      if (old) lay(old, 1);
      return;
    }
    const path: number[] = [];
    for (let s = found; s >= 0; s = prev[s]!) path.push(s >> 2);
    path.reverse();
    routes.set(id, path);
    lay(path, 1);
  }

  const mine = [...ends.keys()].filter((id) => !only || only.has(id));
  const span = (id: string) => {
    const [a, b] = ends.get(id)!;
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  };
  /** The whole bench's cost: each wire against the others as they lie. */
  const total = () => {
    let c = 0;
    for (const id of mine) {
      const r = routes.get(id);
      if (!r) continue;
      lay(r, -1);
      c += pathCost(r);
      lay(r, 1);
    }
    return c;
  };

  /** Lay every wire in this order, then rip up and reroute until no round helps; the best set found. */
  const attempt = (order: string[]) => {
    for (const id of mine) {
      const r = routes.get(id);
      if (r) lay(r, -1);
      routes.delete(id);
    }
    for (const id of order) route(id);
    let bestCost = total();
    let bestSet = new Map(mine.map((id) => [id, routes.get(id)]));
    for (let round = 0; round < ROUNDS; round++) {
      // The wires that cost the most go again first, around the others
      const cost = new Map<string, number>();
      for (const id of mine) {
        const r = routes.get(id);
        if (!r) continue;
        lay(r, -1);
        cost.set(id, pathCost(r) / Math.max(1, span(id)));
        lay(r, 1);
      }
      for (const id of [...mine].sort((i, j) => (cost.get(j) ?? 0) - (cost.get(i) ?? 0))) route(id);
      const now = total();
      if (now < bestCost - 1e-6) {
        bestCost = now;
        bestSet = new Map(mine.map((id) => [id, routes.get(id)]));
      } else break;
    }
    return { cost: bestCost, set: bestSet };
  };

  // Start orders: shortest first, longest first, then a few shuffles (seeded: the same bench
  // always tidies the same way)
  const shortFirst = [...mine].sort((i, j) => span(i) - span(j));
  const orders = [shortFirst];
  if (mine.length > 2) {
    orders.push([...shortFirst].reverse());
    let seed = 0x9e3779b9;
    const rand = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
    for (let k = 0; k < SHUFFLES; k++) {
      const o = [...shortFirst];
      for (let i = o.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [o[i], o[j]] = [o[j]!, o[i]!];
      }
      orders.push(o);
    }
  }
  const began = Date.now();
  let winner = attempt(orders[0]!);
  for (const [k, o] of orders.slice(1).entries()) {
    // The shuffles only while the click still feels instant (a big bench gets the first two)
    if (k > 0 && Date.now() - began > BUDGET_MS) break;
    const other = attempt(o);
    if (other.cost < winner.cost) winner = other;
  }
  for (const id of mine) {
    const r = routes.get(id);
    if (r) lay(r, -1);
    const w = winner.set.get(id);
    if (w) {
      routes.set(id, w);
      lay(w, 1);
    } else routes.delete(id);
  }

  /** Corners of a grid route: where it turns. */
  const cornersOf = (r: number[]) => {
    const corners: number[] = [];
    for (let i = 1; i < r.length - 1; i++) {
      if (r[i]! - r[i - 1]! !== r[i + 1]! - r[i]!) corners.push(i);
    }
    return corners;
  };

  const out = new Map<string, Pt[]>();
  if (!mode.free) {
    for (const id of mine) {
      const r = routes.get(id);
      if (r) out.set(id, cornersOf(r).map((i) => at(r[i]!)));
    }
    return out;
  }

  // Free: pull each route taut. Every wire's drawn segments, so a shortcut crossing more of them
  // than the route it replaces is not taken; each wire's own updated as it is pulled.
  const segsOf = (pts: Pt[]) => pts.slice(1).map((p, i) => [pts[i]!, p] as Seg);
  const drawn = new Map<string, Seg[]>();
  for (const [id, r] of routes) {
    const f = fixed.get(id);
    drawn.set(id, segsOf(f ?? [at(r[0]!), ...cornersOf(r).map((i) => at(r[i]!)), at(r[r.length - 1]!)]));
  }
  const crossings = (id: string, s: Seg) => {
    let k = 0;
    const [minX, maxX, minY, maxY] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x), Math.min(s[0].y, s[1].y), Math.max(s[0].y, s[1].y)];
    for (const [other, segs] of drawn) {
      if (other === id) continue;
      for (const t of segs) {
        if (Math.max(t[0].x, t[1].x) < minX || Math.min(t[0].x, t[1].x) > maxX || Math.max(t[0].y, t[1].y) < minY || Math.min(t[0].y, t[1].y) > maxY) continue;
        if (crosses(s, t)) k++;
      }
    }
    return k;
  };
  const near = (p: Pt, q: Pt, c: Pt) => {
    const L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, ((c.x - p.x) * (q.x - p.x) + (c.y - p.y) * (q.y - p.y)) / L2)) : 0;
    return Math.hypot(p.x + t * (q.x - p.x) - c.x, p.y + t * (q.y - p.y) - c.y) < CLEARANCE;
  };
  const meetsRect = (p: Pt, q: Pt, r: Box) => {
    // Liang–Barsky: does the segment enter the box?
    let [t0, t1] = [0, 1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    for (const [pp, qq] of [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]] as const) {
      if (pp === 0) {
        if (qq < 0) return false;
        continue;
      }
      const t = qq / pp;
      if (pp < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
    return true;
  };

  for (const id of mine) {
    const r = routes.get(id);
    if (!r) continue;
    const [a, b] = ends.get(id)!;
    const pts = r.map(at);
    pts[0] = a;
    pts[pts.length - 1] = b;
    // The pins and bodies this wire may come near: everything but its own ends and the boxes they lie in
    const pinsHere = pins.filter((c) => !(Math.hypot(c.x - a.x, c.y - a.y) < 0.01 || Math.hypot(c.x - b.x, c.y - b.y) < 0.01));
    const rectsHere = rects.filter((q) => !meetsRect(a, a, q) && !meetsRect(b, b, q));
    // The board's module: the route may cross it only where its grid route did
    const overBoard = (p: Pt, q: Pt) => {
      const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * 4);
      for (let k = 1; k < n; k++) {
        const m = node({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
        if (under[m] === OVER_BOARD && !onRoute.has(m)) return true;
      }
      return false;
    };
    const onRoute = new Set(r);
    const corners = cornersOf(r);
    const clear = (i: number, j: number) => {
      const [p, q] = [pts[i]!, pts[j]!];
      // Along the route itself, straight: as clear as the route
      if (j === i + 1 || !corners.some((k) => k > i && k < j)) return true;
      const [minX, maxX, minY, maxY] = [Math.min(p.x, q.x) - CLEARANCE, Math.max(p.x, q.x) + CLEARANCE, Math.min(p.y, q.y) - CLEARANCE, Math.max(p.y, q.y) + CLEARANCE];
      for (const c of pinsHere) if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY && near(p, q, c)) return false;
      for (const box of rectsHere) if (meetsRect(p, q, box)) return false;
      return !overBoard(p, q);
    };
    const keys = [0, ...corners, r.length - 1];
    // Candidate points: the corners and ends, and points along the route between them
    const cand = new Set(keys);
    for (let i = 0; i < r.length; i += 2) cand.add(i);
    const idx = [...cand].sort((i, j) => i - j);
    // Shortest taut route over the candidates: length + a cost per corner + per crossing
    const cost = new Float64Array(idx.length).fill(Infinity);
    const from = new Int32Array(idx.length).fill(-1);
    cost[0] = 0;
    drawn.delete(id);
    for (let u = 0; u < idx.length; u++) {
      if (cost[u] === Infinity) continue;
      for (let v = u + 1; v < idx.length; v++) {
        const [i, j] = [idx[u]!, idx[v]!];
        if (!clear(i, j)) continue;
        const [p, q] = [pts[i]!, pts[j]!];
        const c = cost[u]! + Math.hypot(q.x - p.x, q.y - p.y) + (u ? FREE_CORNER : 0) + FREE_CROSS * crossings(id, [p, q]);
        if (c < cost[v]! - 1e-9) {
          cost[v] = c;
          from[v] = u;
        }
      }
    }
    const chain: Pt[] = [];
    for (let v = idx.length - 1; v >= 0; v = from[v]!) chain.push(pts[idx[v]!]!);
    chain.reverse();
    if (chain.length < 2 || chain[0] !== pts[0]) {
      // Nothing clear at all (should not happen: neighbours always are): keep the grid route
      const grid = [a, ...corners.map((i) => pts[i]!), b];
      drawn.set(id, segsOf(grid));
      out.set(id, grid.slice(1, -1));
      continue;
    }
    drawn.set(id, segsOf(chain));
    out.set(id, chain.slice(1, -1));
  }
  return out;
}
