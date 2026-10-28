// World coordinates of the workbench are breadboard pitches (2.54 mm). Breadboards and the
// board have a position in the project; holes and pins are offsets from it.

import { expandBreadboard, rotate, type BoardDef, type Endpoint, type ExpandedBreadboard, type PartInstance, type Project } from '@esp32lab/project-model';
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

/** Where a part terminal is drawn (its hole when plugged in). */
export function terminalPos(project: Project, part: PartInstance, terminal: string): Pt | undefined {
  const m = PARTS[part.type]?.manifest;
  if (!m || !part.placement) return undefined;
  const anchor = holePos(project, part.placement.bb, part.placement.hole);
  const first = m.terminals[0]!;
  const t = m.terminals.find((q) => q.name === terminal);
  if (!anchor || !t) return undefined;
  const [dx, dy] = rotate(t.dx - first.dx, t.dy - first.dy, part.placement.rot);
  return { x: anchor.x + dx, y: anchor.y + dy };
}

export function endpointPos(project: Project, e: Endpoint): Pt | undefined {
  if (e.kind === 'hole') return holePos(project, e.bb, e.hole);
  if (e.kind === 'board') return pinPos(project, e.pin);
  const part = project.parts.find((p) => p.id === e.part);
  return part ? terminalPos(project, part, e.terminal) : undefined;
}

/** Nearest hole or board pin within half a pitch. */
export function endpointAt(project: Project, p: Pt): Endpoint | null {
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
