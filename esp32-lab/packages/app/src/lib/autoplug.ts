// Plugging a part in with one click, the way its manifest says (PlugSpec). A part lying on the
// bench goes onto a breadboard first, where each leg gets a strip to itself (a button straddles
// the gap on its own, since that is where its four legs land in four strips). Then each leg is
// wired: supplies through the power rails (the rail is fed from the board the first time),
// signals to the nearest free GPIO that can do the job, a series resistor or a pull-up into a
// free strip beside it. Without a breadboard the legs are wired straight to the board.

import type { PlugRole, PlugSpec } from '@esp32lab/part-sdk';
import { resolvePlacement, type BoardDef, type BoardPin, type Endpoint, type ExpandedBreadboard, type PartInstance, type Project, type Rotation } from '@esp32lab/project-model';
import { keyOf, type SimKernel } from '@esp32lab/sim-core';
import { PARTS } from './catalog';
import { board, breadboard, breadboardBox, endpointPos, holePos, pinPos, terminalPos, type Pt } from './geometry';
import { pinInfo } from './pinout';
import { RAIL_COLORS, SIGNAL_COLORS } from './wiring';

type Supply = 'gnd' | '3v3' | '5v';
const NET: Record<Supply, string> = { gnd: 'GND', '3v3': '3V3', '5v': '5V' };
const ROTS: Rotation[] = [0, 90, 180, 270];
/** A resistor's legs are this many holes apart. */
const RESISTOR_SPAN = 4;

export type PlugResult = { ok: true; project: Project; report: string[] } | { ok: false; reason: string };

/**
 * The project with part `partId` plugged in and wired, and a line per leg saying where it went.
 * `netlist` builds the kernel of a project (only its netlist is used).
 */
export function autoPlug(project: Project, partId: string, netlist: (p: Project) => SimKernel | null): PlugResult {
  const part = project.parts.find((p) => p.id === partId);
  const manifest = part && PARTS[part.type]?.manifest;
  const spec = manifest?.plug;
  if (!part || !manifest || !spec) return { ok: false, reason: 'Linh kiện này chưa có cách cắm mẫu.' };
  const kernel = netlist(project);
  if (!kernel) return { ok: false, reason: 'Không đọc được mạch hiện tại.' };

  // Legs something already reaches are left as they are
  const wired = new Set(manifest.terminals.filter((t) => reached(kernel, partId, t.name)).map((t) => t.name));
  if (Object.keys(spec.pins).every((t) => wired.has(t))) return { ok: false, reason: `${partId} đã được nối dây đủ rồi.` };

  // On the bench with free legs: onto the breadboard spot that needs the fewest resistors off it
  if (!part.placement && wired.size === 0) {
    let best: (PlugResult & { ok: true; offBoard: number }) | null = null;
    let reason = '';
    for (const spot of spots(project, part)) {
      const trial = structuredClone(project);
      const p = trial.parts.find((q) => q.id === partId)!;
      p.placement = spot;
      delete p.bench;
      const r = plan(trial, kernel, p, spec, wired);
      if (!r.ok) {
        reason = r.reason;
        continue;
      }
      if (!best || r.offBoard < best.offBoard) best = r;
      if (r.offBoard === 0) break;
    }
    if (best) return best;
    if (reason) return { ok: false, reason };
  }
  return plan(project, kernel, part, spec, wired);
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

/**
 * Where on the breadboards the part could go, best first: unturned, near the board's side,
 * close to the middle gap. Every leg in a strip nobody uses, legs sharing a strip only if the
 * part joins them inside anyway.
 */
function* spots(project: Project, part: PartInstance): Generator<{ bb: string; hole: string; rot: Rotation }> {
  const m = PARTS[part.type]!.manifest;
  const taken = takenHoles(project);
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
        if (fits) yield { bb: inst.id, hole: anchor.name, rot };
      }
    }
  }
}

/** Where a wire can reach a leg: any free hole of its strip, or the leg itself on the bench. */
type Spot = { at: Pt; bb: string; strip: string[] } | { at: Pt; end: Endpoint };

class Unpluggable extends Error {}

/** Wire the legs of `part` (placed or on the bench) in a copy of `project`. */
function plan(project: Project, kernel: SimKernel, part: PartInstance, spec: PlugSpec, wired: Set<string>): PlugResult & { offBoard: number } | { ok: false; reason: string } {
  const out = structuredClone(project);
  const manifest = PARTS[part.type]!.manifest;
  const taken = takenHoles(out);
  const claimed = new Set<string[]>();
  const usedPins = new Set<string>();
  const railNet = new Map<string, string>();
  const bodies: { bb: string; y: number; x0: number; x1: number }[] = [];
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
  const resistor = (s: Spot, ohms: number): Spot => {
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
            if (pass === 0 && bodies.some((b) => b.bb === s.bb && b.y === h.y && b.x0 <= x1 && x0 <= b.x1)) continue;
            out.parts.push({ id, type: 'resistor', props: { resistance: ohms }, placement: { bb: s.bb, hole: h.name, rot: dir > 0 ? 0 : 180 } });
            taken.add(`${s.bb}:${h.name}`).add(`${s.bb}:${far.name}`);
            claimed.add(strip);
            bodies.push({ bb: s.bb, y: h.y, x0, x1 });
            return { at: holePos(out, s.bb, far.name)!, bb: s.bb, strip };
          }
        }
      }
    }
    // No room on the breadboard: on the bench below everything, a wire from the leg to it
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
        supply(resistor(leg, pull[1]), pull[0]);
        notes.push(`${pull[0] === 'gnd' ? 'kéo xuống GND' : 'kéo lên 3V3'} qua ${ohm(pull[1])}`);
      }
      const series = spec.series?.[t.name];
      if (series) {
        leg = resistor(leg, series);
        notes.push(`qua ${ohm(series)}`);
      }
      let where: string;
      if (role === 'gnd' || role === '3v3' || role === '5v') {
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
