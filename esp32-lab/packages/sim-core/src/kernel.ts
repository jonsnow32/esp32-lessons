// SimKernel: turns a Project into a live circuit and advances virtual time.
//
//   project ──build()──► netlist (Union-Find) + part instances
//   advanceTo(t):  MCU runs → pad drive changes / part timers → re-solve MNA → pad voltages → MCU
//
// The kernel knows nothing about specific parts or MCUs; everything goes through the Part SDK
// and McuModel interfaces.

import {
  resolveProps,
  type I2cTarget,
  type PulseTrain,
  type Observable,
  type PartBehavior,
  type PartEnv,
  type PartEvent,
  type PartManifest,
  type PartModule,
  type PwmSignal,
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
import type { I2cReply, I2cTransaction, McuModel, PadInput } from './mcu';
import { edgeCurrents, terminalCurrents, type Edge, type FlowEdge } from './flow';
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
  /** Part state from the kernel this one replaces (`carryState()`), restored by part id and type. */
  carry?: ReadonlyMap<string, { type: string; state: unknown }>;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: 'unknown-part' | 'bad-placement' | 'not-converged' | 'damaged' | 'unknown-endpoint';
  part?: string;
  message: string;
}

/**
 * One stretch of a PWM period during which every PWM pad holds one level: `w` is its share of
 * the period, `levels` which pads are HIGH, `v` / `floating` the circuit solved for it.
 */
interface Segment {
  w: number;
  levels: Map<string, boolean>;
  v: Float64Array;
  floating: boolean[];
}

/** Re-solves a single solve() may trigger (a part failing, the MCU entering reset...). */
const MAX_RESOLVES = 8;

interface Instance {
  id: string;
  behavior: PartBehavior;
  /** Terminal name → netlist key */
  keys: Record<string, string>;
  /** Terminal name → net index, filled after the netlist is frozen */
  nets: Record<string, number>;
  type?: string;
  /** I2C devices: the terminals carrying SDA and SCL. */
  bus?: { sda: string; scl: string };
}

/** Why an I2C bus answered nothing, for explanations. */
export type I2cBusFault = 'not-routed' | 'same-net' | 'no-pull-up';

/** The last transaction on an I2C port: who was addressed and who answered. */
export interface I2cActivity {
  port: number;
  sda?: string;
  scl?: string;
  fault?: I2cBusFault;
  /** 7-bit addresses the controller called, and whether a device ACKed each. */
  addressed: { address: number; acked: boolean }[];
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
  /** Physical connections the netlist was built from (for current-flow display). */
  private edges: Edge[] = [];
  private queue: { t: SimTime; seq: number; part: string; tag: string }[] = [];
  private seq = 0;
  private dirty = true;
  private voltages: Float64Array = new Float64Array(1);
  private floating: boolean[] = [];
  private lastSolve: SimTime = 0;
  private readonly random: () => number;
  /** The PWM stretches of the present operating point; empty when no pad puts out PWM. */
  private segments: Segment[] = [];
  /** Level of each PWM pad in the stretch being solved or reported; null outside that. */
  private pwmLevels: Map<string, boolean> | null = null;
  private pwmByNet = new Map<number, PwmSignal>();
  /** Numeric observables that differ between PWM stretches, averaged over the period. */
  private averaged = new Map<string, Record<string, number>>();
  /** Per I2C port: the device addressed since the last START, and whether the next byte is an address. */
  private i2cState = new Map<number, { target: I2cTarget | null; address: boolean }>();
  /** Latest transaction per I2C port. */
  readonly i2cActivity = new Map<number, I2cActivity>();

  constructor(private readonly opts: KernelOptions) {
    this.random = prng(opts.project.seed ?? 1);
    this.now = opts.startTime ?? 0;
    this.lastSolve = this.now;
    this.build();
    opts.mcu.setI2cBus?.((tx) => this.i2c(tx));
    opts.mcu.setPulseSink?.((pad, train) => {
      const net = this.netlist.net(keyOf.pad(pad));
      if (net !== undefined) this.deliver(net, train);
    });
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
      emit: (terminal, train) => {
        const inst = this.instances.get(partId);
        const net = inst?.nets[terminal];
        if (net !== undefined) this.deliver(net, train, inst);
      },
    };
  }

  private addInstance(id: string, behavior: PartBehavior, keys: Record<string, string>, type?: string, bus?: Instance['bus']): void {
    const carried = type === undefined ? undefined : this.opts.carry?.get(id);
    if (carried && carried.type === type) behavior.restore?.(carried.state);
    this.instances.set(id, { id, behavior, keys, nets: {}, type, bus });
  }

  /** State of every part that keeps some across rebuilds, for the kernel that replaces this one. */
  carryState(): Map<string, { type: string; state: unknown }> {
    const out = new Map<string, { type: string; state: unknown }>();
    for (const inst of this.instances.values()) {
      if (inst.type !== undefined && inst.behavior.persist) out.set(inst.id, { type: inst.type, state: inst.behavior.persist() });
    }
    return out;
  }

  private build(): void {
    const { project, board, breadboards, parts, mcu } = this.opts;
    const uf = new UnionFind();
    const manifests = new Map<string, PartManifest>();
    const link = (a: string, b: string, kind: Edge['kind'], id?: string) => {
      uf.union(a, b);
      if (a !== b) this.edges.push({ kind, a, b, id });
    };

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
        // Neighbouring holes, so current can be drawn along the metal clip
        for (let k = 1; k < strip.length; k++) link(keyOf.hole(bb.id, strip[k - 1]!), keyOf.hole(bb.id, strip[k]!), 'strip');
      }
    }

    // Board: header pins, supplies, MCU pads, onboard parts
    for (const pin of board.pins) link(keyOf.boardPin(pin.name), boardNodeKey(pin.connect), 'pin');
    for (const supply of board.supplies) {
      this.addInstance(`board.supply.${supply.net}`, supplyBehavior(supply), { out: keyOf.net(supply.net), gnd: GROUND_KEY });
    }
    for (const pad of mcu.pads) {
      this.addInstance(`mcu.${pad}`, padBehavior(mcu, pad, () => this.pwmLevels?.get(pad)), {
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
        if (node) link(keys[t.name]!, boardNodeKey(node), 'onboard', id);
      }
      manifests.set(id, module.manifest);
      this.addInstance(id, module.create(resolveProps(module.manifest, part.props), this.env(id)), keys, part.type, module.bus);
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
          for (const [t, hole] of Object.entries(placed.holes)) link(keys[t]!, keyOf.hole(part.placement.bb, hole), 'leg', part.id);
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
      this.addInstance(part.id, module.create(resolveProps(module.manifest, part.props), this.env(part.id)), keys, part.type, module.bus);
    }

    // In-part shorts (pushbutton legs) behave like zero-length wires
    for (const [id, manifest] of manifests) {
      for (const [a, b] of manifest.internalShorts ?? []) link(keyOf.terminal(id, a), keyOf.terminal(id, b), 'internal', id);
    }

    for (const wire of project.wires) link(endpointKey(wire.a), endpointKey(wire.b), 'wire', wire.id);
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
    // The MCU must see a solved circuit (powered devices, pulled-up buses) from its first step
    if (this.dirty) this.solve();
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

  solve(depth = 0): void {
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
    const n = this.netlist.netCount;
    const segments = this.pwmSegments();
    let guess = this.voltages;
    for (const seg of segments) {
      this.pwmLevels = seg.levels;
      const result = solve(n, elements, guess);
      if (!result.converged) {
        this.diagnostics.push({ severity: 'warning', code: 'not-converged', message: `Solver did not converge at t=${this.now} ns` });
      }
      seg.v = result.v;
      seg.floating = result.floating;
      guess = result.v;
    }
    this.pwmLevels = null;
    // What a meter (and a slow input) sees: the average over the period
    this.voltages = new Float64Array(n);
    this.floating = Array.from({ length: n }, () => false);
    for (const seg of segments) {
      for (let i = 0; i < n; i++) {
        this.voltages[i]! += seg.w * (seg.v[i] ?? 0);
        this.floating[i] ||= seg.floating[i] ?? true;
      }
    }
    this.segments = segments.length > 1 ? segments : [];
    this.dirty = false;
    this.lastSolve = this.now;
    this.notifySolved(0);

    const inputs = new Map<string, PadInput>();
    for (const pad of this.opts.mcu.pads) {
      const net = this.netlist.net(keyOf.pad(pad))!;
      inputs.set(pad, { volts: this.voltages[net] ?? 0, floating: this.floating[net] ?? true });
    }
    if (this.opts.mcu.setInputs(inputs, this.now) === true) this.dirty = true;
    // A part destroyed by this operating point changed the circuit; damage only happens once per
    // part (and the MCU only enters or leaves reset once per edge), so this terminates. Parts
    // that flip with every PWM stretch would not, hence the cap
    if (this.dirty && depth < MAX_RESOLVES) this.solve(depth + 1);
  }

  /**
   * Split the PWM period at every pad's duty: in stretch i, the pads whose duty reaches past it
   * are HIGH. Duties are compared as if every waveform started HIGH at the same moment, which
   * gives each part the right share of time at each level as long as it hangs off one pad.
   */
  private pwmSegments(): Segment[] {
    const pwm: { pad: string; duty: number }[] = [];
    this.pwmByNet.clear();
    for (const pad of this.opts.mcu.pads) {
      const d = this.opts.mcu.drive(pad);
      if (!d.pwm || d.output === 'z') continue;
      pwm.push({ pad, duty: d.pwm.highNs / d.pwm.periodNs });
      this.pwmByNet.set(this.netlist.net(keyOf.pad(pad))!, d.pwm);
    }
    const cuts = [0, ...new Set(pwm.map((p) => p.duty).sort((a, b) => a - b)), 1];
    const out: Segment[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const w = cuts[i + 1]! - cuts[i]!;
      if (w <= 0) continue;
      out.push({ w, levels: new Map(pwm.map((p) => [p.pad, p.duty > cuts[i]!])), v: new Float64Array(0), floating: [] });
    }
    // Report the longest stretch last: parts keep the state of the last one they saw
    return out.sort((a, b) => a.w - b.w);
  }

  private notifySolved(dt: SimTime): void {
    if (this.segments.length === 0) {
      this.averaged.clear();
      this.report(this.voltages, dt);
      return;
    }
    const sums = new Map<string, Record<string, number>>();
    const varies = new Map<string, Set<string>>();
    const first = new Map<string, Record<string, Observable>>();
    for (const seg of this.segments) {
      this.pwmLevels = seg.levels;
      this.report(seg.v, dt * seg.w);
      for (const inst of this.instances.values()) {
        const obs = inst.behavior.observables();
        const sum = sums.get(inst.id) ?? {};
        const seen = first.get(inst.id) ?? obs;
        const diff = varies.get(inst.id) ?? new Set<string>();
        for (const [key, value] of Object.entries(obs)) {
          if (typeof value !== 'number') continue;
          sum[key] = (sum[key] ?? 0) + seg.w * value;
          if (value !== seen[key]) diff.add(key);
        }
        sums.set(inst.id, sum);
        first.set(inst.id, seen);
        varies.set(inst.id, diff);
      }
    }
    this.pwmLevels = null;
    this.averaged.clear();
    for (const [id, diff] of varies) {
      if (diff.size) this.averaged.set(id, Object.fromEntries([...diff].map((key) => [key, sums.get(id)![key]!])));
    }
  }

  /** Hand one operating point to every part. */
  private report(voltages: Float64Array, dt: SimTime): void {
    for (const inst of this.instances.values()) {
      const wasDamaged = inst.behavior.damaged;
      inst.behavior.onSolved?.({
        v: (t) => voltages[inst.nets[t]!] ?? 0,
        dt,
        t: this.now,
        pwm: (t) => this.pwmByNet.get(inst.nets[t]!),
      });
      if (!wasDamaged && inst.behavior.damaged) {
        // A part failing changes the circuit (LED goes open), so solve again
        this.dirty = true;
        this.diagnostics.push({ severity: 'error', code: 'damaged', part: inst.id, message: `${inst.id} was destroyed` });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pulse trains
  // -------------------------------------------------------------------------

  private delivering = 0;

  /** Hand a pulse train to every part terminal on `net` but the sender's. */
  private deliver(net: number, train: PulseTrain, from?: Instance): void {
    // A chain wired back onto itself would pass the data round for ever
    if (this.delivering > 64) return;
    this.delivering++;
    try {
      for (const inst of this.instances.values()) {
        if (inst === from || !inst.behavior.pulses || inst.behavior.damaged) continue;
        for (const [terminal, n] of Object.entries(inst.nets)) {
          if (n === net) inst.behavior.pulses(terminal, train);
        }
      }
    } finally {
      this.delivering--;
    }
  }

  // -------------------------------------------------------------------------
  // I2C
  // -------------------------------------------------------------------------

  /**
   * The devices that can hear the controller: SDA and SCL routed to two different nets, both
   * pulled up to a valid HIGH at rest (open-drain lines read LOW, or nothing, without a pull-up),
   * and the device's SDA / SCL terminals on those nets.
   */
  private i2cTargets(tx: I2cTransaction): { targets: I2cTarget[]; fault?: I2cBusFault } {
    if (!tx.sda || !tx.scl) return { targets: [], fault: 'not-routed' };
    const sda = this.netlist.net(keyOf.pad(tx.sda));
    const scl = this.netlist.net(keyOf.pad(tx.scl));
    if (sda === undefined || scl === undefined) return { targets: [], fault: 'not-routed' };
    if (sda === scl) return { targets: [], fault: 'same-net' };
    const vdd = this.voltages[this.netlist.net(keyOf.net(this.opts.mcu.electrical.vddNet)) ?? 0] ?? 3.3;
    const high = (n: number) => !this.floating[n] && (this.voltages[n] ?? 0) >= 0.7 * vdd;
    if (!high(sda) || !high(scl)) return { targets: [], fault: 'no-pull-up' };
    const targets: I2cTarget[] = [];
    for (const inst of this.instances.values()) {
      const t = inst.behavior.i2c;
      if (t && inst.bus && inst.nets[inst.bus.sda] === sda && inst.nets[inst.bus.scl] === scl) targets.push(t);
    }
    return { targets };
  }

  /** Play one command list on the bus: START, address, data, STOP, as the devices answer. */
  private i2c(tx: I2cTransaction): I2cReply {
    const { targets, fault } = this.i2cTargets(tx);
    const st = this.i2cState.get(tx.port) ?? { target: null, address: false };
    this.i2cState.set(tx.port, st);
    const activity = this.i2cActivity.get(tx.port);
    const addressed = activity && activity.sda === tx.sda && !activity.fault === !fault ? activity.addressed : [];
    const acks: boolean[] = [];
    const data: number[] = [];
    let aborted = false;
    for (const op of tx.ops) {
      if (op.kind === 'start') st.address = true;
      else if (op.kind === 'stop') {
        st.target?.end?.();
        st.target = null;
      } else if (op.kind === 'write') {
        for (const b of op.bytes) {
          let ack = false;
          if (!aborted && st.address) {
            st.address = false;
            const t = targets.find((d) => d.address === b >> 1) ?? null;
            if (st.target && st.target !== t) st.target.end?.();
            st.target = t && t.begin((b & 1) === 1) ? t : null;
            ack = st.target !== null;
            addressed.push({ address: b >> 1, acked: ack });
          } else if (!aborted && st.target) {
            ack = st.target.write(b);
          }
          acks.push(ack);
          // The controller gives up at the first answer it was not told to expect
          if (op.ackCheck && ack === op.ackExp) aborted = true;
        }
      } else if (op.kind === 'read') {
        for (let i = 0; i < op.len; i++) data.push(!aborted && st.target ? st.target.read() & 0xff : 0xff);
      }
    }
    if (aborted) {
      st.target?.end?.();
      st.target = null;
    }
    // Keep the last few addresses: enough to tell what a sketch talks to
    this.i2cActivity.set(tx.port, { port: tx.port, sda: tx.sda, scl: tx.scl, fault, addressed: addressed.slice(-16) });
    return { acks, data };
  }

  // -------------------------------------------------------------------------
  // Interaction and inspection
  // -------------------------------------------------------------------------

  send(partId: string, ev: PartEvent): void {
    this.instances.get(partId)?.behavior.onEvent?.(ev);
    if (this.dirty) this.solve();
  }

  press(partId: string, key?: string): void {
    this.send(partId, key === undefined ? { kind: 'press' } : { kind: 'press', key });
  }

  release(partId: string, key?: string): void {
    this.send(partId, key === undefined ? { kind: 'release' } : { kind: 'release', key });
  }

  observables(partId: string): Record<string, Observable> {
    const inst = this.instances.get(partId);
    if (!inst) throw new Error(`Unknown part "${partId}"`);
    // Under PWM, what changes with the waveform (an LED's current) is shown as its average
    return { ...inst.behavior.observables(), ...this.averaged.get(partId) };
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

  /** Current into every terminal of every part at the present operating point (A). */
  terminalCurrents(): Map<string, Record<string, number>> {
    const out = new Map<string, Record<string, number>>();
    const segments = this.segments.length ? this.segments : [{ w: 1, levels: null, v: this.voltages }];
    for (const seg of segments) {
      this.pwmLevels = seg.levels;
      for (const inst of this.instances.values()) {
        const v = (t: string) => seg.v[inst.nets[t]!] ?? 0;
        const sum = out.get(inst.id) ?? {};
        for (const [t, i] of Object.entries(terminalCurrents(inst.behavior, v, Object.keys(inst.keys)))) sum[t] = (sum[t] ?? 0) + seg.w * i;
        out.set(inst.id, sum);
      }
    }
    this.pwmLevels = null;
    return out;
  }

  /** Terminal currents plus the current along every wire, strip segment, leg and pin. */
  flows(): { terminals: Map<string, Record<string, number>>; edges: FlowEdge[] } {
    const terminals = this.terminalCurrents();
    // A part drawing I at a terminal takes I out of the node there
    const injected = new Map<string, number>();
    for (const [id, currents] of terminals) {
      const keys = this.instances.get(id)!.keys;
      for (const [t, i] of Object.entries(currents)) injected.set(keys[t]!, (injected.get(keys[t]!) ?? 0) - i);
    }
    return { terminals, edges: edgeCurrents(this.edges, injected) };
  }

  /** Voltage and floating flag at every key of the netlist. */
  keyVoltages(): Map<string, { v: number; floating: boolean }> {
    const out = new Map<string, { v: number; floating: boolean }>();
    for (let net = 0; net < this.netlist.netCount; net++) {
      const state = { v: this.voltages[net] ?? 0, floating: this.floating[net] ?? true };
      for (const key of this.netlist.keysOf(net)) out.set(key, state);
    }
    return out;
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
