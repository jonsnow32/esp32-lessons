// World coordinates of the workbench are breadboard pitches (2.54 mm). Breadboards and the
// board have a position in the project; holes and pins are offsets from it.

import { expandBreadboard, rotate, type BoardDef, type Endpoint, type ExpandedBreadboard, type PartInstance, type Project, type Rotation } from '@esp32lab/project-model';
import { BOARDS, BREADBOARDS, PARTS } from './catalog';

export interface Pt {
  x: number;
  y: number;
}

const expanded = new Map<string, ExpandedBreadboard>();
export function breadboard(type: string): ExpandedBreadboard | undefined {
  if (!expanded.has(type) && BREADBOARDS[type]) expanded.set(type, expandBreadboard(BREADBOARDS[type]!));
  return expanded.get(type);
}

export function board(project: Project): BoardDef {
  return BOARDS[project.board.type]!;
}

export function holePos(project: Project, bbId: string, hole: string): Pt | undefined {
  const inst = project.breadboards.find((b) => b.id === bbId);
  const h = inst && breadboard(inst.type)?.holes.get(hole);
  return inst && h ? { x: inst.x + h.x, y: inst.y + h.y } : undefined;
}

export function pinPos(project: Project, pin: string): Pt | undefined {
  const p = board(project).pins.find((q) => q.name === pin);
  return p ? { x: project.board.x + p.x, y: project.board.y + p.y } : undefined;
}

/** Where a part's first terminal sits and how it is turned: its hole, or its spot on the bench. */
export function partAnchor(project: Project, part: PartInstance): { at: Pt; rot: Rotation } | undefined {
  if (part.placement) {
    const at = holePos(project, part.placement.bb, part.placement.hole);
    return at && { at, rot: part.placement.rot };
  }
  return part.bench && { at: { x: part.bench.x, y: part.bench.y }, rot: part.bench.rot };
}

/** Where a part terminal is drawn (its hole when plugged in, the leg's tip on the bench). */
export function terminalPos(project: Project, part: PartInstance, terminal: string): Pt | undefined {
  const m = PARTS[part.type]?.manifest;
  const anchor = partAnchor(project, part);
  if (!m || !anchor) return undefined;
  const first = m.terminals[0]!;
  const t = m.terminals.find((q) => q.name === terminal);
  if (!t) return undefined;
  const [dx, dy] = rotate(t.dx - first.dx, t.dy - first.dy, anchor.rot);
  return { x: anchor.at.x + dx, y: anchor.at.y + dy };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The plastic of a breadboard type, relative to its a1 hole (as BreadboardView draws it). */
export function breadboardBox(type: string): Box | undefined {
  const def = breadboard(type)?.def;
  if (!def) return undefined;
  const top = Math.min(0, ...def.rails.map((r) => r.y)) - 1.2;
  const bottom = Math.max(...def.rails.map((r) => r.y), ...def.blocks.map((k) => k.y0 + k.rows.length - 1)) + 1.2;
  return { x: -1.6, y: top, w: def.columns + 2.2, h: bottom - top };
}

/** The board's PCB, relative to its first header pin (as BoardView draws it). */
export function boardBox(def: BoardDef): Box {
  const right = Math.max(...def.pins.map((p) => p.x));
  return { x: -1.1, y: -3.4, w: right + 2.2, h: def.height + 2.5 };
}

const inBox = (p: Pt, at: Pt, b: Box) => p.x > at.x + b.x && p.x < at.x + b.x + b.w && p.y > at.y + b.y && p.y < at.y + b.y + b.h;

/** The breadboard under the point (the top one where they overlap), if any. */
export function breadboardAt(project: Project, p: Pt): string | undefined {
  return [...project.breadboards].reverse().find((inst) => {
    const b = breadboardBox(inst.type);
    return b && inBox(p, inst, b);
  })?.id;
}

/** Is the point over a breadboard (holes, rails or the plastic around them)? */
export function onBreadboard(project: Project, p: Pt): boolean {
  return breadboardAt(project, p) !== undefined;
}

export function onBoard(project: Project, p: Pt): boolean {
  return inBox(p, project.board, boardBox(board(project)));
}

/** Everything on the bench (board, breadboards, parts lying beside them), with a margin. */
export function benchBounds(project: Project, margin = 1): Box {
  const boxes: Box[] = [];
  const b = boardBox(board(project));
  boxes.push({ ...b, x: project.board.x + b.x, y: project.board.y + b.y });
  for (const inst of project.breadboards) {
    const bb = breadboardBox(inst.type);
    if (bb) boxes.push({ ...bb, x: inst.x + bb.x, y: inst.y + bb.y });
  }
  for (const part of project.parts) if (part.bench) boxes.push({ x: part.bench.x - 2, y: part.bench.y - 3, w: 4, h: 4 });
  const x = Math.min(...boxes.map((k) => k.x)) - margin;
  const y = Math.min(...boxes.map((k) => k.y)) - margin;
  return { x, y, w: Math.max(...boxes.map((k) => k.x + k.w)) + margin - x, h: Math.max(...boxes.map((k) => k.y + k.h)) + margin - y };
}

export function endpointPos(project: Project, e: Endpoint): Pt | undefined {
  if (e.kind === 'hole') return holePos(project, e.bb, e.hole);
  if (e.kind === 'board') return pinPos(project, e.pin);
  const part = project.parts.find((p) => p.id === e.part);
  return part ? terminalPos(project, part, e.terminal) : undefined;
}

/** Nearest leg of a part on the bench, hole or board pin within half a pitch. */
export function endpointAt(project: Project, p: Pt): Endpoint | null {
  for (const part of project.parts) {
    if (part.placement || !part.bench) continue;
    for (const t of PARTS[part.type]?.manifest.terminals ?? []) {
      const at = terminalPos(project, part, t.name);
      if (at && Math.hypot(at.x - p.x, at.y - p.y) < 0.45) return { kind: 'part', part: part.id, terminal: t.name };
    }
  }
  for (const inst of project.breadboards) {
    const bb = breadboard(inst.type);
    const h = bb?.holeAt(Math.round(p.x - inst.x), Math.round(p.y - inst.y));
    if (h && Math.abs(p.x - inst.x - h.x) < 0.5 && Math.abs(p.y - inst.y - h.y) < 0.5) {
      return { kind: 'hole', bb: inst.id, hole: h.name };
    }
  }
  for (const pin of board(project).pins) {
    if (Math.abs(project.board.x + pin.x - p.x) < 0.5 && Math.abs(project.board.y + pin.y - p.y) < 0.5) {
      return { kind: 'board', pin: pin.name };
    }
  }
  return null;
}

export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const half = (v: number) => Math.round(v * 2) / 2;
/** A wire corner on the half-pitch grid. */
export const snapCorner = (p: Pt): Pt => ({ x: half(p.x), y: half(p.y) });

/** Without repeated points or corners that are not bends. */
function simplify(route: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of route) {
    const q = out[out.length - 1];
    if (q && q.x === p.x && q.y === p.y) continue;
    const o = out[out.length - 2];
    if (o && q && ((o.x === q.x && q.x === p.x) || (o.y === q.y && q.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

/**
 * The points a wire runs through, from a to b, every segment horizontal or vertical. Without
 * corners it leaves a and enters b vertically, crossing over halfway; with them, it leaves a
 * vertically and reaches every later point (and b) horizontally first.
 */
export function wireRoute(a: Pt, b: Pt, points: Pt[] = []): Pt[] {
  const out: Pt[] = [a];
  if (!points.length) {
    const my = half((a.y + b.y) / 2);
    if (a.x !== b.x && a.y !== b.y) out.push({ x: a.x, y: my }, { x: b.x, y: my });
  } else {
    let p = a;
    for (const q of [...points, b]) {
      if (p.x !== q.x && p.y !== q.y) out.push(p === a ? { x: a.x, y: q.y } : { x: q.x, y: p.y });
      out.push(q);
      p = q;
    }
    out.pop();
  }
  out.push(b);
  return simplify(out);
}

/** A wire along its route, its bends slightly rounded. */
export function wirePath(a: Pt, b: Pt, points?: Pt[]): string {
  return routePath(wireRoute(a, b, points));
}

/** SVG path through a route's points, its bends slightly rounded. */
export function routePath(r: Pt[]): string {
  const [a, b] = [r[0]!, r[r.length - 1]!];
  const toward = (from: Pt, to: Pt, k: number): Pt => {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: from.x + ((to.x - from.x) * k) / d, y: from.y + ((to.y - from.y) * k) / d };
  };
  let d = `M${a.x},${a.y}`;
  for (let i = 1; i < r.length - 1; i++) {
    const [p, c, n] = [r[i - 1]!, r[i]!, r[i + 1]!];
    const k = Math.min(0.4, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const u = toward(c, p, k);
    const v = toward(c, n, k);
    d += ` L${u.x},${u.y} Q${c.x},${c.y} ${v.x},${v.y}`;
  }
  return d + ` L${b.x},${b.y}`;
}

/**
 * The corners of a wire after its segment i (route[i] to route[i + 1]) is moved sideways by d.
 * An end segment leaves the wire's end where it is: a short stub joins them.
 */
export function moveSegment(route: Pt[], i: number, d: number): Pt[] {
  const horizontal = route[i]!.y === route[i + 1]!.y;
  const shift = (p: Pt): Pt => (horizontal ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y });
  const last = route.length - 1;
  const moved = [
    ...route.slice(0, i + (i === 0 ? 1 : 0)),
    shift(route[i]!),
    shift(route[i + 1]!),
    ...route.slice(i + 1 === last ? i + 1 : i + 2),
  ];
  return simplify(moved).slice(1, -1);
}
