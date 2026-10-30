// Several things on the bench at once: what goes along when they move, moving them together by
// whole pitches, and copying them.

import { resolvePlacement, type Endpoint, type Project, type Wire } from '@esp32lab/project-model';
import { PARTS } from './catalog';
import { board, boardBox, breadboard, breadboardBox, holePos, terminalPos, type Box, type Pt } from './geometry';

/** One selectable thing on the bench. */
export type Item = { kind: 'part' | 'wire' | 'breadboard'; id: string } | { kind: 'board' };

export const sameItem = (a: Item, b: Item) => a.kind === b.kind && (a.kind === 'board' || a.id === (b as { id: string }).id);

interface Movers {
  board: boolean;
  bbs: Set<string>;
  parts: Set<string>;
}

const idsOf = (items: Item[], kind: Item['kind']) => new Set(items.flatMap((i) => (i.kind === kind && 'id' in i ? [i.id] : [])));

/** What moves with the items: the board, breadboards and parts, those plugged into a moving breadboard too. */
function movers(project: Project, items: Item[]): Movers {
  const bbs = idsOf(items, 'breadboard');
  const parts = idsOf(items, 'part');
  for (const p of project.parts) if (p.placement && bbs.has(p.placement.bb)) parts.add(p.id);
  return { board: items.some((i) => i.kind === 'board'), bbs, parts };
}

const endMoves = (e: Endpoint, m: Movers) => (e.kind === 'hole' ? m.bbs.has(e.bb) : e.kind === 'board' ? m.board : m.parts.has(e.part));

/** The breadboard hole exactly at a grid point (the top breadboard where they overlap). */
function holeAt(project: Project, p: Pt): { bb: string; hole: string } | undefined {
  for (const inst of [...project.breadboards].reverse()) {
    const h = breadboard(inst.type)?.holeAt(p.x - inst.x, p.y - inst.y);
    if (h) return { bb: inst.id, hole: h.name };
  }
  return undefined;
}

/** Do the moving parts plugged into a breadboard fit: every leg in a hole, no hole taken twice? */
function fits(project: Project, moving: Set<string>): boolean {
  const legs = (id: string) => {
    const p = project.parts.find((q) => q.id === id)!;
    const inst = project.breadboards.find((b) => b.id === p.placement!.bb);
    const ex = inst && breadboard(inst.type);
    const m = PARTS[p.type]?.manifest;
    const r = ex && m && resolvePlacement(ex, m, p.placement!.hole, p.placement!.rot);
    return r?.ok ? Object.values(r.holes).map((h) => `${inst!.id}:${h}`) : null;
  };
  const plugged = project.parts.filter((p) => p.placement);
  const taken = new Set(plugged.filter((p) => !moving.has(p.id)).flatMap((p) => legs(p.id) ?? []));
  for (const p of plugged.filter((q) => moving.has(q.id))) {
    const holes = legs(p.id);
    if (!holes || holes.some((h) => taken.has(h))) return false;
    holes.forEach((h) => taken.add(h));
  }
  return true;
}

/**
 * The project with the items moved by (dx, dy) pitches. Parts plugged into a breadboard that
 * stays go to the holes there; when one has no hole to go to, or its legs land on taken holes,
 * it is not `ok` (it lies on the bench in the result, to show where it would be).
 */
export function shiftGroup(base: Project, items: Item[], dx: number, dy: number): { project: Project; ok: boolean } {
  const project = structuredClone(base);
  const m = movers(base, items);
  if (m.board) project.board = { ...project.board, x: project.board.x + dx, y: project.board.y + dy };
  for (const inst of project.breadboards) {
    if (!m.bbs.has(inst.id)) continue;
    inst.x += dx;
    inst.y += dy;
  }
  let ok = true;
  for (const p of project.parts) {
    if (!m.parts.has(p.id)) continue;
    if (!p.placement) {
      if (p.bench) p.bench = { ...p.bench, x: p.bench.x + dx, y: p.bench.y + dy };
      continue;
    }
    if (m.bbs.has(p.placement.bb)) continue;
    const at = holePos(base, p.placement.bb, p.placement.hole);
    const to = at && holeAt(project, { x: at.x + dx, y: at.y + dy });
    if (to) p.placement = { ...p.placement, ...to };
    else {
      ok = false;
      if (at) p.bench = { x: at.x + dx, y: at.y + dy, rot: p.placement.rot };
      p.placement = null;
    }
  }
  // A wire with both ends moving keeps its shape
  for (const w of project.wires) {
    if (w.points && endMoves(w.a, m) && endMoves(w.b, m)) w.points = w.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
  }
  return { project, ok: ok && fits(project, m.parts) };
}

/** The breadboards picked, and the board if asked for, as boxes on the bench. */
function boxes(project: Project, pick: (bb: string) => boolean, withBoard: boolean): Box[] {
  const out: Box[] = [];
  if (withBoard) {
    const b = boardBox(board(project));
    out.push({ ...b, x: project.board.x + b.x, y: project.board.y + b.y });
  }
  for (const inst of project.breadboards) {
    const b = breadboardBox(inst.type);
    if (b && pick(inst.id)) out.push({ ...b, x: inst.x + b.x, y: inst.y + b.y });
  }
  return out;
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function freshId(taken: Set<string>, base: string, start: number): string {
  let n = start;
  while (taken.has(`${base}${n}`)) n++;
  const id = `${base}${n}`;
  taken.add(id);
  return id;
}

/**
 * A copy of the items beside them (the board stays one of a kind): breadboards with the parts
 * plugged into them, parts, and the wires between what is copied (a wire to a board pin is
 * copied too, to the same pin). The copy goes below the originals, or as near as there is room.
 */
export function duplicate(project: Project, items: Item[]): { project: Project; items: Item[] } | null {
  const m = movers(project, items);
  if (!m.bbs.size && !m.parts.size) return null;
  const out = structuredClone(project);
  const bbIds = new Map<string, string>();
  const partIds = new Map<string, string>();
  const takenBbs = new Set(project.breadboards.map((b) => b.id));
  const takenParts = new Set(project.parts.map((p) => p.id));
  for (const inst of project.breadboards.filter((b) => m.bbs.has(b.id))) {
    const id = freshId(takenBbs, 'bb', project.breadboards.length + 1);
    bbIds.set(inst.id, id);
    out.breadboards.push({ ...structuredClone(inst), id });
  }
  for (const p of project.parts.filter((q) => m.parts.has(q.id))) {
    const id = freshId(takenParts, p.type, project.parts.filter((q) => q.type === p.type).length + 1);
    partIds.set(p.id, id);
    const copy = structuredClone(p);
    copy.id = id;
    if (copy.placement) copy.placement.bb = bbIds.get(copy.placement.bb) ?? copy.placement.bb;
    out.parts.push(copy);
  }
  const remap = (e: Endpoint): Endpoint | null =>
    e.kind === 'board' ? e : e.kind === 'hole' ? (bbIds.has(e.bb) ? { ...e, bb: bbIds.get(e.bb)! } : null) : partIds.has(e.part) ? { ...e, part: partIds.get(e.part)! } : null;
  const wires: Wire[] = [];
  const stamp = Date.now().toString(36);
  for (const w of project.wires) {
    const a = remap(w.a);
    const b = remap(w.b);
    // Not between two board pins: that would only lie on top of the original
    if (a && b && !(a.kind === 'board' && b.kind === 'board')) wires.push({ ...structuredClone(w), id: `w${stamp}c${wires.length}`, a, b });
  }
  out.wires.push(...wires);
  const fresh = new Set(bbIds.values());
  // Parts plugged into a copied breadboard go with it, as the originals do
  const loose = out.parts.filter((p) => [...partIds.values()].includes(p.id) && !(p.placement && fresh.has(p.placement.bb)));
  const copied: Item[] = [
    ...[...fresh].map((id) => ({ kind: 'breadboard' as const, id })),
    ...loose.map((p) => ({ kind: 'part' as const, id: p.id })),
    ...wires.map((w) => ({ kind: 'wire' as const, id: w.id })),
  ];
  // Room for the copy: below the originals first, then nearer and further around them
  const height = Math.ceil(bounds(project, m).h) + 1;
  const tries: Pt[] = [];
  for (let dy = height; dy <= height + 12; dy++) for (let dx = 0; dx <= 12; dx++) tries.push({ x: dx, y: dy }, { x: -dx, y: dy });
  for (let r = 1; r <= 20; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) tries.push({ x: dx, y: dy });
  for (const d of tries) {
    const r = shiftGroup(out, copied, d.x, d.y);
    if (!r.ok) continue;
    // A copied breadboard must not lie over another one or the board
    const mine = boxes(r.project, (id) => fresh.has(id), false);
    const others = boxes(r.project, (id) => !fresh.has(id), true);
    if (mine.some((a) => others.some((b) => overlap(a, b)))) continue;
    return { project: r.project, items: copied };
  }
  return null;
}

/** The box around what moves with the items. */
function bounds(project: Project, m: Movers): Box {
  const pts: Pt[] = [];
  for (const b of boxes(project, (id) => m.bbs.has(id), false)) pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
  for (const p of project.parts) {
    if (!m.parts.has(p.id)) continue;
    for (const t of PARTS[p.type]?.manifest.terminals ?? []) {
      const at = terminalPos(project, p, t.name);
      if (at) pts.push(at);
    }
  }
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...pts.map((p) => p.x));
  const y = Math.min(...pts.map((p) => p.y));
  return { x, y, w: Math.max(...pts.map((p) => p.x)) - x, h: Math.max(...pts.map((p) => p.y)) - y };
}
