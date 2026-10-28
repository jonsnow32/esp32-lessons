// SimKernel: turns a Project into a live circuit and advances virtual time.
//
//   project ──build()──► netlist (Union-Find) + part instances
//   advanceTo(t):  MCU runs → pad drive changes / part timers → re-solve MNA → pad voltages → MCU
//
// The kernel knows nothing about specific parts or MCUs; everything goes through the Part SDK
// and McuModel interfaces.

import {
  resolveProps,
  type Observable,
  type PartBehavior,
  type PartEnv,
  type PartEvent,
  type PartManifest,
  type PartModule,
  type SimTime,
} from '@esp32lab/part-sdk';
import {
  expandBreadboard,
  resolvePlacement,
  type BoardDef,
  type BoardNode,
  type BreadboardDef,
  type Endpoint,
  type ExpandedBreadboard,
  type Project,
} from '@esp32lab/project-model';
import { padBehavior, supplyBehavior } from './builtins';
import type { McuModel, PadInput } from './mcu';
import { bindContext, solve, type Stamper } from './mna';
import { GROUND_KEY, Netlist, UnionFind } from './netlist';

export type PartRegistry = Record<string, PartModule<any>>;

export interface KernelOptions {
  project: Project;
  board: BoardDef;
  breadboards: Record<string, BreadboardDef>;
  parts: PartRegistry;
  mcu: McuModel;
  /**
   * Virtual time to start at. Rewiring a running board builds a new kernel around the same
   * MCU, which keeps running: the new kernel continues from the MCU's current time.
   */
  startTime?: SimTime;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: 'unknown-part' | 'bad-placement' | 'not-converged' | 'damaged' | 'unknown-endpoint';
  part?: string;
  message: string;
}

interface Instance {
  id: string;
  behavior: PartBehavior;
  /** Terminal name → netlist key */
  keys: Record<string, string>;
  /** Terminal name → net index, filled after the netlist is frozen */
  nets: Record<string, number>;
}

// Netlist keys for every kind of connection point
export const keyOf = {
  hole: (bb: string, hole: string) => `h:${bb}:${hole}`,
  boardPin: (pin: string) => `bp:${pin}`,
  pad: (pad: string) => `pad:${pad}`,
  net: (net: string) => `net:${net}`,
  terminal: (part: string, terminal: string) => `p:${part}:${terminal}`,
  boardNode: (node: string) => `n:board:${node}`,
};

export function endpointKey(e: Endpoint): string {
  switch (e.kind) {
    case 'hole':
      return keyOf.hole(e.bb, e.hole);
    case 'board':
      return keyOf.boardPin(e.pin);
    case 'part':
      return keyOf.terminal(e.part, e.terminal);
  }
}

function boardNodeKey(n: BoardNode): string {
  if ('pad' in n) return keyOf.pad(n.pad);
  if ('net' in n) return keyOf.net(n.net);
  return keyOf.boardNode(n.node);
}

/** Mulberry32 – small, fast, deterministic. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimKernel {
  now: SimTime = 0;
  netlist!: Netlist;
  readonly diagnostics: Diagnostic[] = [];
  readonly breadboards = new Map<string, ExpandedBreadboard>();

  private instances = new Map<string, Instance>();
  private queue: { t: SimTime; seq: number; part: string; tag: string }[] = [];
  private seq = 0;
  private dirty = true;
  private voltages: Float64Array = new Float64Array(1);
  private floating: boolean[] = [];
  private lastSolve: SimTime = 0;
  private readonly random: () => number;

  constructor(private readonly opts: KernelOptions) {
    this.random = prng(opts.project.seed ?? 1);
    this.now = opts.startTime ?? 0;
    this.lastSolve = this.now;
    this.build();
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  private env(partId: string): PartEnv {
    return {
      now: () => this.now,
      schedule: (at, tag) => this.schedule(at, partId, tag),
      random: this.random,
      invalidate: () => {
        this.dirty = true;
      },
    };
  }

  private addInstance(id: string, behavior: PartBehavior, keys: Record<string, string>): void {
    this.instances.set(id, { id, behavior, keys, nets: {} });
  }

  private build(): void {
    const { project, board, breadboards, parts, mcu } = this.opts;
    const uf = new UnionFind();
    const manifests = new Map<string, PartManifest>();

    // Breadboards: each metal strip merges its holes
    for (const bb of project.breadboards) {
      const def = breadboards[bb.type];
      if (!def) {
        this.diagnostics.push({ severity: 'error', code: 'unknown-part', part: bb.id, message: `Unknown breadboard "${bb.type}"` });
        continue;
      }
      const expanded = expandBreadboard(def);
      this.breadboards.set(bb.id, expanded);
      for (const strip of expanded.strips) {
        for (const hole of strip) uf.union(keyOf.hole(bb.id, strip[0]!), keyOf.hole(bb.id, hole));
      }
    }

    // Board: header pins, supplies, MCU pads, onboard parts
    for (const pin of board.pins) uf.union(keyOf.boardPin(pin.name), boardNodeKey(pin.connect));
    for (const supply of board.supplies) {
      this.addInstance(`board.supply.${supply.net}`, supplyBehavior(supply), { out: keyOf.net(supply.net), gnd: GROUND_KEY });
    }
    for (const pad of mcu.pads) {
      this.addInstance(`mcu.${pad}`, padBehavior(mcu, pad), {
        pad: keyOf.pad(pad),
        vdd: keyOf.net(mcu.electrical.vddNet),
        gnd: GROUND_KEY,
      });
    }
    for (const part of board.onboard) {
      const module = parts[part.type];
      if (!module) {
        this.diagnostics.push({ severity: 'error', code: 'unknown-part', part: part.id, message: `Unknown part type "${part.type}"` });
        continue;
      }
      const id = `board.${part.id}`;
      const keys: Record<string, string> = {};
      for (const t of module.manifest.terminals) {
        keys[t.name] = keyOf.terminal(id, t.name);
        const node = part.connect[t.name];
        if (node) uf.union(keys[t.name]!, boardNodeKey(node));
      }
      manifests.set(id, module.manifest);
      this.addInstance(id, module.create(resolveProps(module.manifest, part.props), this.env(id)), keys);
    }

    // User parts: legs land in breadboard holes
    for (const part of project.parts) {
      const module = parts[part.type];
      if (!module) {
        this.diagnostics.push({ severity: 'error', code: 'unknown-part', part: part.id, message: `Unknown part type "${part.type}"` });
        continue;
      }
      const keys: Record<string, string> = {};
      for (const t of module.manifest.terminals) keys[t.name] = keyOf.terminal(part.id, t.name);
      if (part.placement) {
        const bb = this.breadboards.get(part.placement.bb);
        const placed = bb && resolvePlacement(bb, module.manifest, part.placement.hole, part.placement.rot);
        if (placed?.ok) {
          for (const [t, hole] of Object.entries(placed.holes)) uf.union(keys[t]!, keyOf.hole(part.placement.bb, hole));
        } else {
          this.diagnostics.push({
            severity: 'error',
            code: 'bad-placement',
            part: part.id,
            message: `${part.id}: legs ${placed ? placed.missing.join(', ') : '(all)'} do not land in a hole`,
          });
        }
      }
      manifests.set(part.id, module.manifest);
      this.addInstance(part.id, module.create(resolveProps(module.manifest, part.props), this.env(part.id)), keys);
    }

    // In-part shorts (pushbutton legs) behave like zero-length wires
    for (const [id, manifest] of manifests) {
      for (const [a, b] of manifest.internalShorts ?? []) uf.union(keyOf.terminal(id, a), keyOf.terminal(id, b));
    }

    for (const wire of project.wires) uf.union(endpointKey(wire.a), endpointKey(wire.b));
    // Terminals nothing connects to (pads not brought out to a header...) still get their own net
    for (const inst of this.instances.values()) for (const key of Object.values(inst.keys)) uf.add(key);

    this.netlist = new Netlist(uf);
    for (const inst of this.instances.values()) {
      for (const [t, key] of Object.entries(inst.keys)) inst.nets[t] = this.netlist.net(key)!;
    }
    this.voltages = new Float64Array(this.netlist.netCount);
  }

  // -------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------

  private schedule(t: SimTime, part: string, tag: string): void {
    const ev = { t: Math.max(t, this.now), seq: this.seq++, part, tag };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1]!.t > ev.t || (this.queue[i - 1]!.t === ev.t && this.queue[i - 1]!.seq > ev.seq))) i--;
    this.queue.splice(i, 0, ev);
  }

  /** Let every part account for the time spent in the current operating point. */
  private elapse(t: SimTime): void {
    const dt = t - this.lastSolve;
    if (dt <= 0) return;
    this.notifySolved(dt);
    this.lastSolve = t;
  }

  /** Advance virtual time, running the MCU and part timers, re-solving whenever something changed. */
  advanceTo(target: SimTime): void {
    for (;;) {
      const next = Math.min(this.queue[0]?.t ?? Infinity, target);
      const step = this.opts.mcu.runUntil(next);
      this.elapse(step.t);
      this.now = step.t;
      if (step.padsChanged) this.dirty = true;
      while (this.queue[0] && this.queue[0].t <= this.now) {
        const ev = this.queue.shift()!;
        this.instances.get(ev.part)?.behavior.onEvent?.({ kind: 'timer', tag: ev.tag });
      }
      if (this.dirty) this.solve();
      if (this.now >= target) break;
    }
    this.elapse(target);
  }

  // -------------------------------------------------------------------------
  // Solve
  // -------------------------------------------------------------------------

  solve(): void {
    const elements: Stamper[] = [];
    for (const inst of this.instances.values()) {
      const b = inst.behavior;
      elements.push({
        stampInto: (sys, v) => {
          const ctx = bindContext(sys, inst.nets, v);
          b.stamp?.(ctx);
          b.stampNonlinear?.(ctx);
        },
      });
    }
    const result = solve(this.netlist.netCount, elements, this.voltages);
    if (!result.converged) {
      this.diagnostics.push({ severity: 'warning', code: 'not-converged', message: `Solver did not converge at t=${this.now} ns` });
    }
    this.voltages = result.v;
    this.floating = result.floating;
    this.dirty = false;
    this.lastSolve = this.now;
    this.notifySolved(0);

    const inputs = new Map<string, PadInput>();
    for (const pad of this.opts.mcu.pads) {
      const net = this.netlist.net(keyOf.pad(pad))!;
      inputs.set(pad, { volts: this.voltages[net] ?? 0, floating: this.floating[net] ?? true });
    }
    this.opts.mcu.setInputs(inputs, this.now);
    // A part destroyed by this operating point changed the circuit; damage only happens once per
    // part, so this terminates
    if (this.dirty) this.solve();
  }

  private notifySolved(dt: SimTime): void {
    for (const inst of this.instances.values()) {
      const wasDamaged = inst.behavior.damaged;
      inst.behavior.onSolved?.({ v: (t) => this.voltages[inst.nets[t]!] ?? 0, dt, t: this.now });
      if (!wasDamaged && inst.behavior.damaged) {
        // A part failing changes the circuit (LED goes open), so solve again
        this.dirty = true;
        this.diagnostics.push({ severity: 'error', code: 'damaged', part: inst.id, message: `${inst.id} was destroyed` });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interaction and inspection
  // -------------------------------------------------------------------------

  send(partId: string, ev: PartEvent): void {
    this.instances.get(partId)?.behavior.onEvent?.(ev);
    if (this.dirty) this.solve();
  }

  press(partId: string): void {
    this.send(partId, { kind: 'press' });
  }

  release(partId: string): void {
    this.send(partId, { kind: 'release' });
  }

  observables(partId: string): Record<string, Observable> {
    const inst = this.instances.get(partId);
    if (!inst) throw new Error(`Unknown part "${partId}"`);
    return inst.behavior.observables();
  }

  /** Voltage at any key (use keyOf / endpointKey). */
  voltage(key: string): number {
    const net = this.netlist.net(key);
    return net === undefined ? NaN : (this.voltages[net] ?? NaN);
  }

  isFloating(key: string): boolean {
    const net = this.netlist.net(key);
    return net === undefined || (this.floating[net] ?? true);
  }

  /** Part id → terminal → netlist key, for lesson checks that walk the circuit. */
  terminals(): ReadonlyMap<string, { type?: string; keys: Record<string, string> }> {
    const out = new Map<string, { type?: string; keys: Record<string, string> }>();
    const types = new Map<string, string>([
      ...this.opts.project.parts.map((p) => [p.id, p.type] as const),
      ...this.opts.board.onboard.map((p) => [`board.${p.id}`, p.type] as const),
    ]);
    for (const inst of this.instances.values()) out.set(inst.id, { type: types.get(inst.id), keys: inst.keys });
    return out;
  }
}
