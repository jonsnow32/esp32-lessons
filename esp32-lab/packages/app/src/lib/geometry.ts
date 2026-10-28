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

/** Is the point over a breadboard (holes, rails or the plastic around them)? */
export function onBreadboard(project: Project, p: Pt): boolean {
  return project.breadboards.some((inst) => {
    const holes = [...(breadboard(inst.type)?.holes.values() ?? [])];
    if (!holes.length) return false;
    const xs = holes.map((h) => inst.x + h.x);
    const ys = holes.map((h) => inst.y + h.y);
    return p.x > Math.min(...xs) - 1.5 && p.x < Math.max(...xs) + 1.5 && p.y > Math.min(...ys) - 1.5 && p.y < Math.max(...ys) + 1.5;
  });
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
