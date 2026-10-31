// Plugging a part in with one click, the way its manifest says (PlugSpec). A part lying on the
// bench goes onto a breadboard first, where each leg gets a strip to itself (a button straddles
// the gap on its own, since that is where its four legs land in four strips). Then each leg is
// wired: supplies through the power rails (the rail is fed from the board the first time),
// signals to the nearest free GPIO that can do the job, a series resistor or a pull-up into a
// free strip beside it. Without a breadboard the legs are wired straight to the board.

import type { PartProps, PlugRole, PlugSpec } from '@esp32lab/part-sdk';
import { resolvePlacement, type BoardDef, type BoardPin, type Endpoint, type ExpandedBreadboard, type PartInstance, type Project, type Rotation } from '@esp32lab/project-model';
import { keyOf, type SimKernel } from '@esp32lab/sim-core';
import { PARTS } from './catalog';
import { board, boardBox, boxesMeet, breadboard, breadboardBox, endpointPos, holePos, partRect, pinPos, terminalPos, type Box, type Pt } from './geometry';
import { pinInfo } from './pinout';
import { RAIL_COLORS, SIGNAL_COLORS } from './wiring';

type Supply = 'gnd' | '3v3' | '5v';
const NET: Record<Supply, string> = { gnd: 'GND', '3v3': '3V3', '5v': '5V' };
const ROTS: Rotation[] = [0, 90, 180, 270];
/** A resistor's legs are this many holes apart. */
const RESISTOR_SPAN = 4;
/** Room kept around a part's body (pitches each side), so parts placed side by side read apart. */
const ROOM = 0.5;
/** Spots tried for a part before the best of them is taken. */
const SPOTS_TRIED = 60;
/** What a pitch of wire costs, in wires: twenty-five pitches of it weigh as much as one more wire. */
const PER_PITCH = 0.04;
/** What each step down the list of spots (farther from the board, off the middle) costs, in wires. */
const FARTHER = 0.02;
/** Less room around a resistor placed for a part: it belongs next to that part's leg. */
const RESISTOR_ROOM = 0.15;

/**
 * How to plug a part in: its manifest's PlugSpec, or one made for it (see arrange.ts) where a leg
 * may name the exact header pin it goes to.
 */
export interface Spec extends Omit<PlugSpec, 'pins'> {
  pins: Record<string, PlugRole | { pin: string }>;
}

/** Each part's drawn box, by part id, as the workbench measured it (see lab.partBoxes). */
export type Bodies = ReadonlyMap<string, Box>;

/** Where a part's body lies: as drawn if measured; a resistor is no more than its legs; else its icon frame. */
function rectOf(project: Project, part: PartInstance, bodies?: Bodies): Box | undefined {
  const drawn = bodies?.get(part.id) ?? (part.type === 'resistor' ? { x: -0.45, y: -0.45, w: RESISTOR_SPAN + 0.9, h: 0.9 } : undefined);
  return partRect(project, part, drawn);
}

/** `wired`: nothing left to plug, every leg the manifest names is already wired. */
export type PlugResult = { ok: true; project: Project; report: string[] } | { ok: false; reason: string; wired?: boolean };

/**
 * The project with part `partId` plugged in and wired, and a line per leg saying where it went.
 * `netlist` builds the kernel of a project (only its netlist is used).
 */
/** A leg of the part and a point it will be wired to later: the spot that brings them close wins. */
export interface Toward {
  terminal: string;
  at: Pt;
}

/** How far the legs land from where they are going, in pitches (as a wire runs: across, then along). */
function pull(project: Project, part: PartInstance, toward: Toward[]): number {
  return toward.reduce((sum, t) => {
    const at = terminalPos(project, part, t.terminal);
    return sum + (at ? Math.abs(at.x - t.at.x) + Math.abs(at.y - t.at.y) : 0);
  }, 0);
}

export function autoPlug(project: Project, partId: string, netlist: (p: Project) => SimKernel | null, bodies?: Bodies, given?: Spec, toward: Toward[] = []): PlugResult {
  const part = project.parts.find((p) => p.id === partId);
  const manifest = part && PARTS[part.type]?.manifest;
  const spec = given ?? manifest?.plug;
  if (!part || !manifest || !spec) return { ok: false, reason: 'Linh kiện này chưa có cách cắm mẫu.' };
  const kernel = netlist(project);
  if (!kernel) return { ok: false, reason: 'Không đọc được mạch hiện tại.' };

  // Legs something already reaches are left as they are
  const wired = new Set(manifest.terminals.filter((t) => reached(kernel, partId, t.name)).map((t) => t.name));
  if (Object.keys(spec.pins).every((t) => wired.has(t))) return { ok: false, reason: `${partId} đã được nối dây đủ rồi.`, wired: true };

  // On the bench with free legs: onto the breadboard spot that leaves no resistor off it and takes
  // the fewest wires (a resistor stood straight in a rail saves one), the nearer the board the better
  if (!part.placement && wired.size === 0) {
    let best: { r: PlugResult & { ok: true }; score: number } | null = null;
    let reason = '';
    let rank = 0;
    for (const spot of spots(project, part, bodies)) {
      if (rank >= SPOTS_TRIED) break;
      const trial = structuredClone(project);
      const p = trial.parts.find((q) => q.id === partId)!;
      p.placement = spot;
      delete p.bench;
      const r = plan(trial, kernel, p, spec, wired, bodies);
      if (!r.ok) {
        reason = r.reason;
        continue;
      }
      // Shorter wires too: a part sits near the pins and rails it is wired to
      const added = r.project.wires.slice(project.wires.length);
      const length = added.reduce((sum, w) => {
        const [a, b] = [endpointPos(r.project, w.a), endpointPos(r.project, w.b)];
        return sum + (a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 0);
      }, 0);
      const score = r.offBoard * 100 + added.length + (length + pull(r.project, p, toward)) * PER_PITCH + rank++ * FARTHER;
      if (!best || score < best.score) best = { r, score };
    }
    if (best) return best.r;
    if (reason) return { ok: false, reason };
    // No breadboard to go on: a clear spot on the bench around the board, near what each leg goes to
    const at = benchSpot(project, part, bodies, spec, toward);
    if (at) {
      const trial = structuredClone(project);
      trial.parts.find((q) => q.id === partId)!.bench = at;
      return plan(trial, kernel, trial.parts.find((q) => q.id === partId)!, spec, wired, bodies);
    }
  }
  return plan(project, kernel, part, spec, wired, bodies);
}

/** Does anything besides breadboard holes and the part's own legs reach this leg? */
function reached(kernel: SimKernel, part: string, terminal: string): boolean {
  const net = kernel.netlist.net(keyOf.terminal(part, terminal));
  return net !== undefined && kernel.netlist.keysOf(net).some((k) => !k.startsWith('h:') && !k.startsWith(`p:${part}:`));
}

/** Holes taken by a leg or a wire end, as `bb:hole`. */
function takenHoles(project: Project): Set<string> {
  const taken = new Set<string>();
  for (const p of project.parts) {
    const inst = p.placement && project.breadboards.find((b) => b.id === p.placement!.bb);
    const ex = inst && breadboard(inst.type);
    const m = PARTS[p.type]?.manifest;
    const r = ex && m && resolvePlacement(ex, m, p.placement!.hole, p.placement!.rot);
    if (r && r.ok) for (const h of Object.values(r.holes)) taken.add(`${p.placement!.bb}:${h}`);
  }
  for (const w of project.wires) for (const e of [w.a, w.b]) if (e.kind === 'hole') taken.add(`${e.bb}:${e.hole}`);
  return taken;
}

/** The strip each hole is in, and which strips are power rails. */
interface Strips {
  of: Map<string, string[]>;
  rails: Set<string[]>;
}
const stripCache = new Map<ExpandedBreadboard, Strips>();
function strips(ex: ExpandedBreadboard): Strips {
  let s = stripCache.get(ex);
  if (!s) {
    const of = new Map<string, string[]>();
    for (const strip of ex.strips) for (const h of strip) of.set(h, strip);
    // expandBreadboard puts the rails after the terminal blocks
    s = { of, rails: new Set(ex.strips.slice(ex.strips.length - ex.def.rails.length)) };
    stripCache.set(ex, s);
  }
  return s;
}

/** Where the board's module lies on the bench. */
function boardRect(project: Project): Box {
  const b = boardBox(board(project));
  return { ...b, x: project.board.x + b.x, y: project.board.y + b.y };
}

/** Where the header pins on a supply net are ("GND", "3V3", "5V"). */
function supplyPins(project: Project, net: string): Pt[] {
  return board(project).pins.filter((p) => 'net' in p.connect && p.connect.net === net).map((p) => pinPos(project, p.name)!);
}

const manhattan = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const nearest = (from: Pt, to: Pt[]) => Math.min(...to.map((t) => manhattan(from, t)));

/** Room kept between the board and a part laid beside it on the bench: the wires to its pins run there. */
const BOARD_ROOM = 2;
/** Room between parts laid on an open bench, each side: wires run between them there, not through holes. */
const BENCH_ROOM = 1.25;
/** How far around the board a part lying on the bench may be laid, in pitches. */
const BENCH_REACH = { left: 24, right: 34, up: 8, down: 14 };

/**
 * A clear place on the bench for a part with no breadboard to go on: on the grid around the board,
 * any way round, its body off the board and with room from every other part, its legs as close as
 * can be to the pins, supplies and legs they will be wired to.
 */
function benchSpot(project: Project, part: PartInstance, bodies: Bodies | undefined, spec: Spec, toward: Toward[]): { x: number; y: number; rot: Rotation } | undefined {
  const m = PARTS[part.type]!.manifest;
  const module = boardRect(project);
  const others = project.parts.filter((p) => p.id !== part.id).map((p) => rectOf(project, p, bodies)).filter((b): b is Box => !!b);
  // Where each leg is going, as far as is known before it is wired
  const goals: { terminal: string; to: Pt[] }[] = toward.map((t) => ({ terminal: t.terminal, to: [t.at] }));
  for (const t of m.terminals) {
    let role = spec.pins[t.name];
    if (role === 'common') role = String(part.props?.common ?? m.props.common?.default) === 'anode' ? '3v3' : 'gnd';
    if (typeof role === 'object') goals.push({ terminal: t.name, to: [pinPos(project, role.pin)!] });
    else if (role === 'gnd' || role === '3v3' || role === '5v') goals.push({ terminal: t.name, to: supplyPins(project, NET[role]) });
    else if (role) goals.push({ terminal: t.name, to: [{ x: module.x + module.w, y: module.y + module.h / 2 }] });
    const pull = spec.pull?.[t.name];
    if (pull) goals.push({ terminal: t.name, to: supplyPins(project, NET[pull[0]]) });
  }
  let best: { at: { x: number; y: number; rot: Rotation }; score: number } | undefined;
  for (let y = Math.floor(module.y - BENCH_REACH.up); y <= module.y + module.h + BENCH_REACH.down; y++) {
    for (let x = Math.floor(module.x - BENCH_REACH.left); x <= module.x + module.w + BENCH_REACH.right; x++) {
      for (const rot of ROTS) {
        const trial: PartInstance = { ...part, placement: null, bench: { x, y, rot } };
        const body = rectOf(project, trial, bodies);
        if (!body || boxesMeet(body, module, BOARD_ROOM) || others.some((o) => boxesMeet(body, o, BENCH_ROOM))) continue;
        let score = 0;
        for (const g of goals) {
          const at = terminalPos(project, trial, g.terminal);
          if (at && g.to.length) score += nearest(at, g.to);
        }
        // Unturned, then near the board, settle ties
        score += (rot ? 0.5 : 0) + manhattan({ x: body.x + body.w / 2, y: body.y + body.h / 2 }, { x: module.x + module.w / 2, y: module.y + module.h / 2 }) * 0.01;
        if (!best || score < best.score) best = { at: { x, y, rot }, score };
      }
    }
  }
  return best?.at;
}

/** The part laid on a clear spot of the bench around the board, near `toward`. Did one turn up? */
export function placeOnBench(project: Project, part: PartInstance, bodies?: Bodies, toward: Toward[] = []): boolean {
  const at = benchSpot(project, part, bodies, { pins: {} }, toward);
  if (!at) return false;
  part.placement = null;
  part.bench = at;
  return true;
}

/**
 * The part moved from the bench onto a breadboard: the spot nearest the board, or of the first
 * SPOTS_TRIED the one bringing its legs closest to `toward`. Left where it is if none fits. Did it fit?
 */
export function placeOnBreadboard(project: Project, part: PartInstance, bodies?: Bodies, toward: Toward[] = []): boolean {
  let best: { spot: { bb: string; hole: string; rot: Rotation }; score: number } | null = null;
  let rank = 0;
  for (const spot of spots(project, part, bodies)) {
    if (rank >= (toward.length ? SPOTS_TRIED : 1)) break;
    const score = pull(project, { ...part, placement: spot }, toward) * PER_PITCH + rank++ * FARTHER;
    if (!best || score < best.score) best = { spot, score };
  }
  if (!best) return false;
  part.placement = best.spot;
  delete part.bench;
  return true;
}

/**
 * Where on the breadboards the part could go, best first: unturned, near the board's side,
 * close to the middle gap. Every leg in a strip nobody uses, legs sharing a strip only if the
 * part joins them inside anyway, and the body clear of every other part's with room around it.
 */
function* spots(project: Project, part: PartInstance, bodies?: Bodies): Generator<{ bb: string; hole: string; rot: Rotation }> {
  const m = PARTS[part.type]!.manifest;
  const taken = takenHoles(project);
  const others = project.parts.filter((p) => p.id !== part.id).map((p) => rectOf(project, p, bodies)).filter((b): b is Box => !!b);
  const joined = (a: string, b: string) => (m.internalShorts ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  for (const inst of project.breadboards) {
    const ex = breadboard(inst.type);
    if (!ex) continue;
    const { of, rails } = strips(ex);
    const block = [...ex.holes.values()].filter((h) => !rails.has(of.get(h.name)!));
    const ys = block.map((h) => h.y);
    const gap = (Math.min(...ys) + Math.max(...ys)) / 2;
    const towardBoard = project.board.x < inst.x ? 1 : -1;
    block.sort((a, b) => towardBoard * (a.x - b.x) || Math.abs(a.y - gap) - Math.abs(b.y - gap));
    for (const rot of ROTS) {
      for (const anchor of block) {
        const r = resolvePlacement(ex, m, anchor.name, rot);
        if (!r.ok) continue;
        const legs = Object.entries(r.holes);
        const fits = legs.every(([t, h]) => {
          const strip = of.get(h)!;
          if (rails.has(strip) || strip.some((x) => taken.has(`${inst.id}:${x}`))) return false;
          return legs.every(([u, k]) => u === t || of.get(k) !== strip || joined(t, u));
        });
        if (!fits) continue;
        const spot = { bb: inst.id, hole: anchor.name, rot };
        const body = rectOf(project, { ...part, placement: spot }, bodies);
        if (body && others.some((o) => boxesMeet(body, o, ROOM))) continue;
        yield spot;
      }
    }
  }
}

/** Where a wire can reach a leg: any free hole of its strip, or the leg itself on the bench. */
type Spot = { at: Pt; bb: string; strip: string[] } | { at: Pt; end: Endpoint };

class Unpluggable extends Error {}

/** Wire the legs of `part` (placed or on the bench) in a copy of `project`. */
function plan(project: Project, kernel: SimKernel, part: PartInstance, spec: Spec, wired: Set<string>, bodies?: Bodies): PlugResult & { offBoard: number } | { ok: false; reason: string } {
  const out = structuredClone(project);
  const manifest = PARTS[part.type]!.manifest;
  const taken = takenHoles(out);
  const claimed = new Set<string[]>();
  const usedPins = new Set<string>();
  const railNet = new Map<string, string>();
  /** Resistors laid on the breadboard so far, by row. */
  const laid: { bb: string; y: number; x0: number; x1: number }[] = [];
  const report: string[] = [];
  const stamp = Date.now().toString(36);
  const def = board(out);
  let offBoard = 0;
  let signals = 0;

  const addWire = (a: Endpoint, b: Endpoint, color: string) => out.wires.push({ id: `w${stamp}p${out.wires.length}`, a, b, color });
  const inst = (bb: string) => out.breadboards.find((b) => b.id === bb)!;
  const ex = (bb: string) => breadboard(inst(bb).type)!;
  const free = (bb: string, h: string) => !taken.has(`${bb}:${h}`);

  /** An end for a wire at the spot, as near `toward` as it gets. */
  const end = (s: Spot, toward: Pt): Endpoint => {
    if ('end' in s) return s.end;
    let best: { h: string; d: number } | null = null;
    for (const h of s.strip) {
      const p = holePos(out, s.bb, h)!;
      const d = Math.hypot(p.x - toward.x, p.y - toward.y);
      if (free(s.bb, h) && (!best || d < best.d)) best = { h, d };
    }
    if (!best) throw new Unpluggable('Một dãy lỗ trên breadboard đã kín, không còn chỗ cắm dây.');
    taken.add(`${s.bb}:${best.h}`);
    return { kind: 'hole', bb: s.bb, hole: best.h };
  };

  const pinEnd = (pin: BoardPin): Endpoint => ({ kind: 'board', pin: pin.name });
  const nearestPin = (pins: BoardPin[], to: Pt) =>
    pins.map((p) => ({ p, d: dist(pinPos(out, p.name)!, to) })).sort((a, b) => a.d - b.d)[0]?.p;

  /**
   * The rail of the breadboard nearest to `near` that carries `s`: one already fed, or an empty
   * one fed now, by a jumper from a rail that has it or else from the board's supply pin.
   */
  const rail = (bb: string, s: Supply, near: Pt): string[] | undefined => {
    const e = ex(bb);
    const { of } = strips(e);
    const want = NET[s];
    const state = (id: string, strip: string[]): 'fed' | 'free' | 'other' => {
      const mine = railNet.get(`${bb}:${id}`);
      if (mine) return mine === want ? 'fed' : 'other';
      const net = kernel.netlist.net(keyOf.hole(bb, strip[0]!));
      const keys = net === undefined ? [] : kernel.netlist.keysOf(net);
      if (keys.includes(keyOf.net(want))) return 'fed';
      return keys.every((k) => k.startsWith(`h:${bb}:`)) && strip.every((h) => free(bb, h)) ? 'free' : 'other';
    };
    const candidates = e.def.rails
      .filter((r) => r.polarity === (s === 'gnd' ? '-' : '+'))
      .map((r) => ({ id: r.id, strip: of.get(`${r.id}1`)!, y: inst(bb).y + r.y }))
      .sort((a, b) => Math.abs(a.y - near.y) - Math.abs(b.y - near.y));
    for (const r of candidates) {
      const st = state(r.id, r.strip);
      if (st === 'fed') return r.strip;
      if (st === 'other') continue;
      const spot = { at: near, bb, strip: r.strip };
      const source = candidates.find((q) => q !== r && state(q.id, q.strip) === 'fed');
      if (source) {
        const a = end({ at: near, bb, strip: source.strip }, { x: near.x, y: r.y });
        addWire(a, end(spot, endpointPos(out, a)!), RAIL_COLORS[want]!);
      } else {
        const pin = nearestPin(def.pins.filter((p) => 'net' in p.connect && p.connect.net === want), near);
        if (!pin) return undefined;
        addWire(pinEnd(pin), end(spot, pinPos(out, pin.name)!), RAIL_COLORS[want]!);
      }
      railNet.set(`${bb}:${r.id}`, want);
      return r.strip;
    }
    return undefined;
  };

  const supply = (s: Spot, to: Supply) => {
    const want = NET[to];
    const r = 'strip' in s ? rail(s.bb, to, s.at) : undefined;
    if (r && 'strip' in s) {
      // Straight across to the rail, from the hole of the strip nearest to it
      const a = end(s, { x: s.at.x, y: holePos(out, s.bb, r[0]!)!.y });
      const from = endpointPos(out, a)!;
      addWire(a, end({ at: from, bb: s.bb, strip: r }, from), RAIL_COLORS[want]!);
      return;
    }
    const pin = nearestPin(def.pins.filter((p) => 'net' in p.connect && p.connect.net === want), s.at);
    if (!pin) throw new Unpluggable(`Board không có chân ${want}.`);
    addWire(pinEnd(pin), end(s, pinPos(out, pin.name)!), RAIL_COLORS[want]!);
  };

  /** The nearest free GPIO pin that can do `role`. */
  const gpio = (role: PlugRole, near: Pt): BoardPin => {
    let best: { pin: BoardPin; tier: number; d: number } | null = null;
    for (const pin of def.pins) {
      const info = pinInfo(def, pin);
      const tier = gpioTier(def, info, role);
      if (tier === undefined) continue;
      const shared = role === 'sda' || role === 'scl';
      if (!shared && (usedPins.has(pin.name) || pinTaken(kernel, pin.name))) continue;
      const d = dist(pinPos(out, pin.name)!, near);
      if (!best || tier < best.tier || (tier === best.tier && d < best.d)) best = { pin, tier, d };
    }
    if (!best) throw new Unpluggable(role === 'sda' || role === 'scl' ? `${def.name} không khai báo chân I2C mặc định.` : 'Không còn chân GPIO trống phù hợp.');
    usedPins.add(best.pin.name);
    return best.pin;
  };

  /** A resistor from the spot into a free strip beside it (or on the bench); its far leg. */
  /**
   * A resistor standing up from the leg's strip with its far leg right in a rail carrying `to`, as
   * one would plug it by hand: no wire needed. Did it fit?
   */
  const toRail = (s: Spot, ohms: number, to: Supply): boolean => {
    if (!('strip' in s)) return false;
    const e = ex(s.bb);
    const r = rail(s.bb, to, s.at);
    if (!r) return false;
    const resistorDef = PARTS.resistor!.manifest;
    for (const h of s.strip.filter((x) => free(s.bb, x))) {
      for (const rot of [90, 270] as const) {
        const legs = resolvePlacement(e, resistorDef, h, rot);
        const far = legs.ok ? legs.holes.b : undefined;
        if (!far || !r.includes(far) || !free(s.bb, far)) continue;
        const placed: PartInstance = { id: newId(out, 'resistor'), type: 'resistor', props: { resistance: ohms }, placement: { bb: s.bb, hole: h, rot } };
        const body = rectOf(out, placed, bodies)!;
        const clash = out.parts.some((p) => {
          const o = rectOf(out, p, bodies);
          return !!o && boxesMeet(body, o, p.id === part.id || p.type === 'resistor' ? 0 : RESISTOR_ROOM);
        });
        if (clash) continue;
        out.parts.push(placed);
        taken.add(`${s.bb}:${h}`).add(`${s.bb}:${far}`);
        return true;
      }
    }
    return false;
  };

  const resistor = (s: Spot, ohms: number, goal?: Pt[]): Spot => {
    const id = newId(out, 'resistor');
    if ('strip' in s) {
      const e = ex(s.bb);
      const { of, rails } = strips(e);
      const towardBoard = out.board.x < inst(s.bb).x ? -1 : 1;
      // Holes far from the part first, so the resistor clears its body
      const leg = { x: s.at.x - inst(s.bb).x, y: s.at.y - inst(s.bb).y };
      const holes = s.strip.filter((h) => free(s.bb, h)).map((h) => e.holes.get(h)!).sort((a, b) => dist(b, leg) - dist(a, leg));
      for (const pass of [0, 1]) {
        for (const h of holes) {
          for (const dir of [towardBoard, -towardBoard]) {
            const far = e.holeAt(h.x + dir * RESISTOR_SPAN, h.y);
            const strip = far && of.get(far.name);
            if (!far || !strip || rails.has(strip) || claimed.has(strip) || !strip.every((x) => free(s.bb, x))) continue;
            const [x0, x1] = [Math.min(h.x, far.x), Math.max(h.x, far.x)];
            // First try to keep resistors from lying on top of each other
            if (pass === 0 && laid.some((b) => b.bb === s.bb && b.y === h.y && b.x0 <= x1 && x0 <= b.x1)) continue;
            const placed: PartInstance = { id, type: 'resistor', props: { resistance: ohms }, placement: { bb: s.bb, hole: h.name, rot: dir > 0 ? 0 : 180 } };
            // Nor on a part's body: right up against the part it serves, a little room from the others
            const body = rectOf(out, placed, bodies)!;
            const clash = out.parts.some((p) => {
              const o = rectOf(out, p, bodies);
              return !!o && boxesMeet(body, o, p.id === part.id || p.type === 'resistor' ? 0 : RESISTOR_ROOM);
            });
            if (clash) continue;
            out.parts.push(placed);
            taken.add(`${s.bb}:${h.name}`).add(`${s.bb}:${far.name}`);
            claimed.add(strip);
            laid.push({ bb: s.bb, y: h.y, x0, x1 });
            return { at: holePos(out, s.bb, far.name)!, bb: s.bb, strip };
          }
        }
      }
    }
    // No breadboard here: on the bench right by the leg, on the way to where it goes
    const module = boardRect(out);
    let near: { at: Pt; rot: Rotation; score: number } | undefined;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        for (const rot of ROTS) {
          const at = { x: Math.round(s.at.x) + dx, y: Math.round(s.at.y) + dy };
          const placed: PartInstance = { id, type: 'resistor', props: { resistance: ohms }, placement: null, bench: { ...at, rot } };
          const body = rectOf(out, placed, bodies)!;
          if (boxesMeet(body, module, BOARD_ROOM - 0.5)) continue;
          const clash = out.parts.some((p) => {
            const o = rectOf(out, p, bodies);
            return !!o && boxesMeet(body, o, p.id === part.id || p.type === 'resistor' ? BENCH_ROOM / 2 : BENCH_ROOM);
          });
          if (clash) continue;
          const [a, b] = [terminalPos(out, placed, 'a')!, terminalPos(out, placed, 'b')!];
          const score = manhattan(s.at, a) + (goal?.length ? nearest(b, goal) : 0);
          if (!near || score < near.score) near = { at, rot, score };
        }
      }
    }
    if (near) {
      const placed: PartInstance = { id, type: 'resistor', props: { resistance: ohms }, placement: null, bench: { ...near.at, rot: near.rot } };
      out.parts.push(placed);
      offBoard++;
      addWire(end(s, terminalPos(out, placed, 'a')!), { kind: 'part', part: id, terminal: 'a' }, SIGNAL_COLORS[signals++ % SIGNAL_COLORS.length]!);
      return { at: terminalPos(out, placed, 'b')!, end: { kind: 'part', part: id, terminal: 'b' } };
    }
    // Nowhere near: below everything, a wire from the leg to it
    const below = Math.max(s.at.y + 3, ...out.breadboards.map((b) => b.y + (breadboardBox(b.type)?.h ?? 0)));
    const at = { x: s.at.x - 2, y: below + 1.5 * offBoard++ };
    out.parts.push({ id, type: 'resistor', props: { resistance: ohms }, placement: null, bench: { ...at, rot: 0 } });
    addWire(end(s, at), { kind: 'part', part: id, terminal: 'a' }, SIGNAL_COLORS[signals++ % SIGNAL_COLORS.length]!);
    return { at: { x: at.x + RESISTOR_SPAN, y: at.y }, end: { kind: 'part', part: id, terminal: 'b' } };
  };

  try {
    const self = out.parts.find((p) => p.id === part.id)!;
    for (const t of manifest.terminals) {
      let role = spec.pins[t.name];
      if (!role || wired.has(t.name)) continue;
      if (role === 'common') role = String(self.props?.common ?? manifest.props.common?.default) === 'anode' ? '3v3' : 'gnd';
      const at = terminalPos(out, self, t.name)!;
      let leg: Spot = self.placement
        ? { at, bb: self.placement.bb, strip: strips(ex(self.placement.bb)).of.get(holeOf(out, self, t.name)!)! }
        : { at, end: { kind: 'part', part: self.id, terminal: t.name } };
      const name = t.label ?? t.name;
      const notes: string[] = [];
      const pull = spec.pull?.[t.name];
      if (pull) {
        if (!toRail(leg, pull[1], pull[0])) supply(resistor(leg, pull[1], supplyPins(out, NET[pull[0]])), pull[0]);
        notes.push(`${pull[0] === 'gnd' ? 'kéo xuống GND' : 'kéo lên 3V3'} qua ${ohm(pull[1])}`);
      }
      const series = spec.series?.[t.name];
      const toSupply = role === 'gnd' || role === '3v3' || role === '5v' ? role : undefined;
      let railed = false;
      if (series) {
        // To a supply through a resistor: stood straight in the rail when it fits
        railed = !!toSupply && toRail(leg, series, toSupply);
        if (!railed) {
          const goal = typeof role === 'object' ? [pinPos(out, role.pin)!] : toSupply ? supplyPins(out, NET[toSupply]) : undefined;
          leg = resistor(leg, series, goal);
        }
        notes.push(`qua ${ohm(series)}`);
      }
      let where: string;
      if (railed) where = toSupply === '5v' ? '5 V (VIN)' : NET[toSupply!];
      else if (typeof role === 'object') {
        const pin = def.pins.find((p) => p.name === role.pin);
        if (!pin) throw new Unpluggable(`${def.name} không có chân ${role.pin}.`);
        usedPins.add(pin.name);
        addWire(pinEnd(pin), end(leg, pinPos(out, pin.name)!), 'net' in pin.connect ? (RAIL_COLORS[pin.connect.net] ?? SIGNAL_COLORS[0]!) : SIGNAL_COLORS[signals++ % SIGNAL_COLORS.length]!);
        where = pin.name;
      } else if (role === 'gnd' || role === '3v3' || role === '5v') {
        supply(leg, role);
        where = role === '5v' ? '5 V (VIN)' : NET[role];
      } else {
        const pin = gpio(role, leg.at);
        addWire(pinEnd(pin), end(leg, pinPos(out, pin.name)!), SIGNAL_COLORS[signals++ % SIGNAL_COLORS.length]!);
        const pad = 'pad' in pin.connect ? pin.connect.pad : '';
        where = pin.name === pad ? pad : `${pin.name} (${pad})`;
      }
      report.push(`${name} → ${where}${notes.length ? `, ${notes.join(', ')}` : ''}`);
    }
  } catch (e) {
    if (e instanceof Unpluggable) return { ok: false, reason: e.message };
    throw e;
  }
  return { ok: true, project: out, report, offBoard };
}

/**
 * A change to the circuit, as the AI assistant proposes it: parts taken off and legs or header
 * pins unwired first (to fix what is there rather than wire around it), then new parts and wires.
 * A wire end is a part leg ("relay1.com") or a header pin ("board:VIN"). The legs of the new parts
 * left unwired are plugged in the way each one's manifest says, as by the one-click plug-in.
 */
export interface CircuitChange {
  /** Parts to take off the bench, with the wires to them. */
  remove?: string[];
  /** Legs ("led1.anode") and header pins ("board:D4") to take every wire off. */
  disconnect?: string[];
  parts: { id: string; type: string; props?: PartProps }[];
  wires: [string, string][];
}

/**
 * The project with `change` made: each new part onto a breadboard where it fits (on the bench
 * otherwise), the wires run, then the rest of each new part plugged in. A line per thing done.
 */
export function applyChange(project: Project, change: CircuitChange, netlist: (p: Project) => SimKernel | null, bodies?: Bodies): PlugResult {
  let out = structuredClone(project);
  const def = board(out);
  const report: string[] = [];

  // Resistors the new wires use stay, even when the part they served goes
  const keep = new Set(change.wires.flat().filter((r) => !r.startsWith('board:')).map((r) => r.slice(0, r.indexOf('.'))));
  const taken0 = unwire(out, change.remove ?? [], change.disconnect ?? [], keep);
  if (typeof taken0 === 'string') return { ok: false, reason: taken0 };
  report.push(...taken0);

  for (const { id, type, props } of change.parts) {
    const manifest = PARTS[type]?.manifest;
    if (!manifest) return { ok: false, reason: `Không có loại linh kiện "${type}".` };
    if (!/^[A-Za-z][\w-]*$/.test(id)) return { ok: false, reason: `id "${id}" chỉ được có chữ, số, - và _, bắt đầu bằng chữ.` };
    if (out.parts.some((p) => p.id === id)) return { ok: false, reason: `Đã có linh kiện ${id} trên bàn, chọn id khác.` };
    for (const [k, v] of Object.entries(props ?? {})) {
      const schema = manifest.props[k];
      if (!schema) return { ok: false, reason: `${type} không có thông số "${k}". Có: ${Object.keys(manifest.props).join(', ') || '(không có)'}.` };
      const bad =
        schema.type === 'enum' ? !schema.options.includes(String(v))
        : schema.type === 'boolean' ? typeof v !== 'boolean'
        : typeof v !== 'number' || (schema.min !== undefined && v < schema.min) || (schema.max !== undefined && v > schema.max);
      if (bad) return { ok: false, reason: `Giá trị ${JSON.stringify(v)} không hợp cho ${id}.${k}.` };
    }
    // On the bench below everything first, then onto the first breadboard spot it fits
    const below = Math.max(out.board.y + def.height + 3, ...out.breadboards.map((b) => b.y + (breadboardBox(b.type)?.h ?? 0) + 2));
    const part: PartInstance = { id, type, props: { ...props }, placement: null, bench: { x: out.board.x + 2 + 5 * report.length, y: below, rot: 0 } };
    out.parts.push(part);
    const spot = spots(out, part, bodies).next();
    if (!spot.done) {
      part.placement = spot.value;
      delete part.bench;
      report.push(`thêm ${id} (${manifest.name}) vào breadboard ${spot.value.bb} lỗ ${spot.value.hole}`);
    } else report.push(`thêm ${id} (${manifest.name}) trên bàn, ngoài breadboard`);
  }

  // A wire end at a leg: a free hole of its strip on the breadboard, the leg itself on the bench
  const taken = takenHoles(out);
  const resolve = (ref: string): { end?: Endpoint; at?: Pt; reason?: string } => {
    if (ref.startsWith('board:')) {
      const pin = def.pins.find((p) => p.name === ref.slice(6));
      if (!pin) return { reason: `${def.name} không có chân "${ref.slice(6)}". Các chân: ${def.pins.map((p) => p.name).join(', ')}.` };
      return { end: { kind: 'board', pin: pin.name }, at: pinPos(out, pin.name) };
    }
    const dot = ref.indexOf('.');
    const part = out.parts.find((p) => p.id === ref.slice(0, dot));
    const manifest = part && PARTS[part.type]?.manifest;
    if (dot < 0 || !part || !manifest) return { reason: `Không có linh kiện "${ref.slice(0, dot < 0 ? undefined : dot)}" (đầu dây "${ref}").` };
    const terminal = ref.slice(dot + 1);
    if (!manifest.terminals.some((t) => t.name === terminal)) return { reason: `${part.id} không có chân "${terminal}". Các chân: ${manifest.terminals.map((t) => t.name).join(', ')}.` };
    return { at: terminalPos(out, part, terminal) };
  };
  const legEnd = (ref: string, toward: Pt): Endpoint | string => {
    const [id, terminal] = [ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)];
    const part = out.parts.find((p) => p.id === id)!;
    if (!part.placement) return { kind: 'part', part: id, terminal };
    const inst = out.breadboards.find((b) => b.id === part.placement!.bb)!;
    const strip = strips(breadboard(inst.type)!).of.get(holeOf(out, part, terminal)!)!;
    const hole = strip.filter((h) => !taken.has(`${inst.id}:${h}`)).sort((a, b) => dist(holePos(out, inst.id, a)!, toward) - dist(holePos(out, inst.id, b)!, toward))[0];
    if (!hole) return `Dãy lỗ của ${ref} đã kín, không còn chỗ cắm dây.`;
    taken.add(`${inst.id}:${hole}`);
    return { kind: 'hole', bb: inst.id, hole };
  };
  const stamp = Date.now().toString(36);
  let signals = 0;
  const keyOfRef = (ref: string) => (ref.startsWith('board:') ? keyOf.boardPin(ref.slice(6)) : keyOf.terminal(ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)));
  for (const [a, b] of change.wires) {
    const ra = resolve(a);
    const rb = resolve(b);
    const reason = ra.reason ?? rb.reason;
    if (reason) return { ok: false, reason };
    // Joined already (by a strip, a wire, the board itself): another wire would only add clutter
    const nl = netlist(out)?.netlist;
    const [na, nb] = [nl?.net(keyOfRef(a)), nl?.net(keyOfRef(b))];
    if (na !== undefined && na === nb) {
      report.push(`bỏ dây ${a} – ${b}: hai chỗ đã thông nhau rồi`);
      continue;
    }
    const ends: Endpoint[] = [];
    for (const [ref, r, other] of [[a, ra, rb], [b, rb, ra]] as const) {
      const e = r.end ?? legEnd(ref, other.at ?? r.at!);
      if (typeof e === 'string') return { ok: false, reason: e };
      ends.push(e);
    }
    const net = [a, b].map((r) => def.pins.find((p) => `board:${p.name}` === r)?.connect).find((c) => c && 'net' in c);
    const color = (net && 'net' in net && RAIL_COLORS[net.net]) || SIGNAL_COLORS[signals++ % SIGNAL_COLORS.length]!;
    out.wires.push({ id: `w${stamp}a${out.wires.length}`, a: ends[0]!, b: ends[1]!, color });
    report.push(`dây ${a} – ${b}`);
  }

  // The legs still free, the way each new part is usually plugged in
  for (const { id, type } of change.parts) {
    if (!PARTS[type]!.manifest.plug) continue;
    const r = autoPlug(out, id, netlist, bodies);
    if (r.ok) {
      out = r.project;
      report.push(`cắm ${id}: ${r.report.join(' · ')}`);
    } else if (!r.wired) report.push(`chưa cắm tự động được ${id}: ${r.reason}`);
  }
  return { ok: true, project: out, report };
}

/**
 * Take the parts in `remove` off `project`, with the resistors they leave serving nothing (but those
 * in `keep`), and every wire off the legs and header pins in `disconnect`, in place, then the wires
 * left leading to an empty strip. A line per thing done, or why it cannot be done.
 */
function unwire(project: Project, remove: string[], disconnect: string[], keep: Set<string>): string[] | string {
  const report: string[] = [];
  const def = board(project);
  /** Strips (as `bb:first hole`) that lost a leg or a wire end: wires into them may now lead nowhere. */
  const emptied = new Set<string>();
  /** Parts that lost a wire to a leg. */
  const lost = new Set<string>();
  const stripOf = (bb: string, hole: string) => {
    const inst = project.breadboards.find((b) => b.id === bb);
    const strip = inst && strips(breadboard(inst.type)!).of.get(hole);
    return strip ? `${bb}:${strip[0]}` : undefined;
  };
  const legStrips = (part: PartInstance, terminals?: string[]) =>
    PARTS[part.type]!.manifest.terminals.filter((t) => !terminals || terminals.includes(t.name)).flatMap((t) => {
      const h = part.placement && holeOf(project, part, t.name);
      const s = h && stripOf(part.placement!.bb, h);
      return s ? [s] : [];
    });
  const endStrip = (e: Endpoint) => (e.kind === 'hole' ? stripOf(e.bb, e.hole) : undefined);
  /** Take off the wires `hit` picks; what they reached may now be empty. */
  const cut = (hit: (w: Project['wires'][number]) => boolean) => {
    const gone = project.wires.filter(hit);
    project.wires = project.wires.filter((w) => !gone.includes(w));
    for (const w of gone) for (const e of [w.a, w.b]) {
      const s = endStrip(e);
      if (s) emptied.add(s);
      if (e.kind === 'part') lost.add(e.part);
    }
    return gone.length;
  };

  for (const id of remove) {
    const part = project.parts.find((p) => p.id === id);
    if (!part) return `Không có linh kiện "${id}" trên bàn để gỡ.`;
    for (const s of legStrips(part)) emptied.add(s);
    project.parts = project.parts.filter((p) => p !== part);
    const n = cut((w) => [w.a, w.b].some((e) => e.kind === 'part' && e.part === id));
    report.push(`gỡ ${id}${n ? ` và ${n} dây nối vào nó` : ''}`);
  }
  // The resistors a removed part had (a series or pull resistor, as the plug-in puts them): one with
  // a leg left where only such resistors are, and no wire, does nothing now. Off with it too, unless
  // the change wires it again.
  if (remove.length) {
    const legOf = (e: Endpoint, id: string, t: string) => e.kind === 'part' && e.part === id && e.terminal === t;
    /** Where the wires from a leg of a part off the breadboard lead. */
    const reach = (r: PartInstance, t: string) => project.wires.flatMap((w) => (legOf(w.a, r.id, t) ? [w.b] : legOf(w.b, r.id, t) ? [w.a] : []));
    const terminals = PARTS.resistor!.manifest.terminals.map((t) => t.name);
    const near = (r: PartInstance) =>
      r.placement ? legStrips(r).some((s) => emptied.has(s)) : lost.has(r.id) || terminals.some((t) => reach(r, t).some((e) => emptied.has(endStrip(e) ?? '')));
    for (let again = true; again; ) {
      const spare = project.parts.filter((p) => p.type === 'resistor' && !keep.has(p.id) && near(p));
      const fromSpare = (e: Endpoint) => e.kind === 'part' && spare.some((r) => r.id === e.part);
      // A strip nothing but the spare resistors uses
      const dead = (s: string) =>
        !project.parts.some((p) => !spare.includes(p) && legStrips(p).includes(s)) &&
        !project.wires.some((w) => (endStrip(w.a) === s && !fromSpare(w.b)) || (endStrip(w.b) === s && !fromSpare(w.a)));
      const gone = spare.filter((r) => (r.placement ? legStrips(r).some(dead) : terminals.some((t) => reach(r, t).every((e) => !!endStrip(e) && dead(endStrip(e)!)))));
      for (const r of gone) {
        for (const s of legStrips(r)) emptied.add(s);
        project.parts = project.parts.filter((p) => p !== r);
        cut((w) => [w.a, w.b].some((e) => e.kind === 'part' && e.part === r.id));
      }
      if (gone.length) report.push(`gỡ ${gone.map((r) => r.id).join(', ')}: điện trở của linh kiện đã gỡ, không còn dùng`);
      again = gone.length > 0;
    }
  }
  for (const ref of disconnect) {
    let n: number;
    if (ref.startsWith('board:')) {
      const pin = ref.slice(6);
      if (!def.pins.some((p) => p.name === pin)) return `${def.name} không có chân "${pin}".`;
      n = cut((w) => [w.a, w.b].some((e) => e.kind === 'board' && e.pin === pin));
    } else {
      const [id, terminal] = [ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)];
      const part = project.parts.find((p) => p.id === id);
      if (!part || ref.indexOf('.') < 0) return `Không có chân "${ref}" trên bàn để ngắt dây.`;
      if (!PARTS[part.type]!.manifest.terminals.some((t) => t.name === terminal)) return `${id} không có chân "${terminal}".`;
      // A leg on the breadboard: the wires into its strip (other legs there stay where they are)
      const strip = legStrips(part, [terminal])[0];
      n = cut((w) => [w.a, w.b].some((e) => (e.kind === 'part' && e.part === id && e.terminal === terminal) || (!!strip && endStrip(e) === strip)));
    }
    report.push(n ? `ngắt ${n} dây khỏi ${ref}` : `${ref} không có dây nào để ngắt`);
  }

  // A wire into a strip where nothing else is (no leg, no other wire) leads nowhere: off with it too
  const used = (s: string, but: Project['wires'][number]) =>
    project.parts.some((p) => legStrips(p).includes(s)) || project.wires.some((w) => w !== but && [w.a, w.b].some((e) => endStrip(e) === s));
  let dangling = 0;
  for (let again = true; again; ) {
    again = false;
    for (const w of project.wires) {
      const lone = [w.a, w.b].some((e) => {
        const s = endStrip(e);
        return !!s && emptied.has(s) && !used(s, w);
      });
      if (!lone) continue;
      cut((x) => x === w);
      dangling++;
      again = true;
      break;
    }
  }
  if (dangling) report.push(`bỏ ${dangling} dây không còn nối tới đâu`);
  return report;
}

/** Lower is better; undefined: the pin cannot do it. */
function gpioTier(def: BoardDef, info: ReturnType<typeof pinInfo>, role: PlugRole): number | undefined {
  const has = (cat: string) => info.tags.some((t) => t.cat === cat);
  const pad = 'pad' in info.pin.connect ? info.pin.connect.pad : undefined;
  if (info.gpio === undefined || !pad) return undefined;
  const i2c = def.wiring?.i2c;
  if (role === 'sda' || role === 'scl') return pad === i2c?.[role] ? 0 : undefined;
  if (info.verdict === 'avoid' || def.wiring?.avoid?.includes(pad)) return undefined;
  // Input-only pins are the best for analog reads: they keep pins that can drive free
  if (role === 'adc') return has('adc1') ? (has('input') ? 0 : 1) : undefined;
  if (has('input')) return undefined;
  // Strapping pins last; the I2C pins only once the others are gone
  return (info.verdict === 'care' ? 2 : 0) + (pad === i2c?.sda || pad === i2c?.scl ? 1 : 0);
}

/** Is something already wired to this header pin (the board's own parts aside)? */
function pinTaken(kernel: SimKernel, pin: string): boolean {
  const net = kernel.netlist.net(keyOf.boardPin(pin));
  return net !== undefined && kernel.netlist.keysOf(net).some((k) => k.startsWith('h:') || (k.startsWith('p:') && !k.startsWith('p:board.')));
}

function holeOf(project: Project, part: PartInstance, terminal: string): string | undefined {
  const inst = project.breadboards.find((b) => b.id === part.placement?.bb);
  const ex = inst && breadboard(inst.type);
  const r = ex && resolvePlacement(ex, PARTS[part.type]!.manifest, part.placement!.hole, part.placement!.rot);
  return r && r.ok ? r.holes[terminal] : undefined;
}

function newId(project: Project, type: string): string {
  let n = project.parts.filter((p) => p.type === type).length + 1;
  while (project.parts.some((p) => p.id === `${type}${n}`)) n++;
  return `${type}${n}`;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const ohm = (r: number) => (r >= 1000 ? `${String(r / 1000).replace('.', ',')} kΩ` : `${r} Ω`);
