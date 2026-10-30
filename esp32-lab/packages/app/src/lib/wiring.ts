// Taking a breadboard away without breaking the circuit: the parts plugged into it stay where
// they lie, now on the bench, and wherever its metal strips used to join things, new wires do.
// For each net that ran through the breadboard, the pieces left after it is gone (an ESP32 pin,
// a lone leg, a part on another breadboard…) are joined again by the shortest wires between
// them (a minimum spanning tree), so no more wires are added than needed.

import type { Endpoint, Project, Wire } from '@esp32lab/project-model';
import { resolvePlacement } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, type SimKernel } from '@esp32lab/sim-core';
import { PARTS } from './catalog';
import { breadboard, endpointPos, partAnchor } from './geometry';

export const RAIL_COLORS: Record<string, string> = { GND: '#1f2023', '3V3': '#e5484d', '5V': '#f76b15' };
export const SIGNAL_COLORS = ['#3e63dd', '#30a46c', '#f5d90a', '#8e4ec6', '#12a594', '#d6409f'];

/**
 * The project without breadboard `bb`, its parts on the bench and rewired. `netlist` builds the
 * kernel of a project (only its netlist is used).
 */
export function unplugBreadboard(project: Project, bb: string, netlist: (p: Project) => SimKernel | null): Project {
  const before = netlist(project);
  const out = structuredClone(project);
  if (!before) return out;

  // The parts lie where they were plugged in, wires to its holes go
  const onHole = (e: Endpoint) => e.kind === 'hole' && e.bb === bb;
  const cut = project.wires.filter((w) => onHole(w.a) || onHole(w.b));
  for (const part of out.parts) {
    if (part.placement?.bb !== bb) continue;
    const anchor = partAnchor(project, part);
    if (anchor) part.bench = { x: anchor.at.x, y: anchor.at.y, rot: anchor.rot };
    part.placement = null;
  }
  out.breadboards = out.breadboards.filter((b) => b.id !== bb);
  out.wires = out.wires.filter((w) => !onHole(w.a) && !onHole(w.b));
  const after = netlist(out);
  if (!after) return out;

  // Nets that ran through the breadboard: through its holes, or the legs of its parts
  const touched = new Set<number>();
  const mark = (key: string) => {
    const n = before.netlist.net(key);
    if (n !== undefined) touched.add(n);
  };
  for (const hole of before.breadboards.get(bb)?.holes.keys() ?? []) mark(keyOf.hole(bb, hole));
  for (const p of project.parts) {
    if (p.placement?.bb === bb) for (const t of PARTS[p.type]?.manifest.terminals ?? []) mark(keyOf.terminal(p.id, t.name));
  }

  const legHoles = occupiedHoles(out);
  const stamp = Date.now().toString(36);
  let signals = 0;
  for (const net of touched) {
    const keys = before.netlist.keysOf(net);
    // What is left of the net, in pieces, and where on each piece a wire could end
    const pieces = new Map<number, Endpoint[]>();
    for (const key of keys) {
      const end = endpointOf(key, out, legHoles);
      const piece = after.netlist.net(key);
      if (end && piece !== undefined) pieces.set(piece, [...(pieces.get(piece) ?? []), end]);
    }
    // Only pieces with something on them count: an ESP32 pin, a part's leg
    const live = [...pieces.entries()].filter(([piece]) =>
      after.netlist.keysOf(piece).some((k) => k.startsWith('bp:') || (k.startsWith('p:') && !k.startsWith('p:board.'))),
    );
    if (live.length < 2) continue;
    const rail = net === before.netlist.net(GROUND_KEY) ? 'GND' : keys.includes(keyOf.net('3V3')) ? '3V3' : keys.includes(keyOf.net('5V')) ? '5V' : undefined;
    // Rails in their usual colours; a signal keeps the colour of a wire it had, if any
    const color = rail ? RAIL_COLORS[rail]! : (cut.find((w) => before.netlist.net(wireKey(w)) === net)?.color ?? SIGNAL_COLORS[signals++ % SIGNAL_COLORS.length]!);
    joinPieces(out, live.map(([, ends]) => ends)).forEach(([a, b], k) => out.wires.push({ id: `w${stamp}n${net}_${k}`, a, b, color }));
  }
  return out;
}

/** The netlist key of a wire's first end. */
function wireKey(w: Wire): string {
  const e = w.a;
  return e.kind === 'hole' ? keyOf.hole(e.bb, e.hole) : e.kind === 'board' ? keyOf.boardPin(e.pin) : keyOf.terminal(e.part, e.terminal);
}

/** Where a wire can end for a netlist key: a board pin, a leg on the bench, a free hole. */
function endpointOf(key: string, project: Project, legHoles: Set<string>): Endpoint | undefined {
  const [kind, a, b] = key.split(':');
  if (kind === 'bp') return { kind: 'board', pin: a! };
  if (kind === 'h' && !legHoles.has(key) && project.breadboards.some((x) => x.id === a)) return { kind: 'hole', bb: a!, hole: b! };
  if (kind === 'p' && project.parts.find((p) => p.id === a)?.bench) return { kind: 'part', part: a!, terminal: b! };
  return undefined;
}

/** Holes holding a leg of a part, as netlist keys. */
function occupiedHoles(project: Project): Set<string> {
  const taken = new Set<string>();
  for (const p of project.parts) {
    const inst = p.placement && project.breadboards.find((b) => b.id === p.placement!.bb);
    const ex = inst && breadboard(inst.type);
    const m = PARTS[p.type]?.manifest;
    const r = inst && ex && m && resolvePlacement(ex, m, p.placement!.hole, p.placement!.rot);
    if (inst && r && r.ok) for (const h of Object.values(r.holes)) taken.add(keyOf.hole(inst.id, h));
  }
  return taken;
}

/**
 * Prim's algorithm over the pieces: each step joins the nearest two ends of a joined and a
 * loose piece. Starts from the piece with the ESP32's pins, so wires run out from the board.
 */
function joinPieces(project: Project, pieces: Endpoint[][]): [Endpoint, Endpoint][] {
  const at = pieces.map((ends) => ends.flatMap((e) => {
    const p = endpointPos(project, e);
    return p ? [{ e, p }] : [];
  }));
  const start = Math.max(0, pieces.findIndex((ends) => ends.some((e) => e.kind === 'board')));
  const joined = new Set([start]);
  const wires: [Endpoint, Endpoint][] = [];
  while (joined.size < pieces.length) {
    let best: { d: number; a: Endpoint; b: Endpoint; piece: number } | null = null;
    for (const i of joined) {
      for (let j = 0; j < pieces.length; j++) {
        if (joined.has(j)) continue;
        for (const x of at[i]!) {
          for (const y of at[j]!) {
            const d = Math.hypot(x.p.x - y.p.x, x.p.y - y.p.y);
            if (!best || d < best.d) best = { d, a: x.e, b: y.e, piece: j };
          }
        }
      }
    }
    if (!best) break;
    joined.add(best.piece);
    wires.push([best.a, best.b]);
  }
  return wires;
}
