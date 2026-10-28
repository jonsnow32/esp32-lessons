// Part SDK – the contract every component (LED, resistor, sensor, board-level part, pad) implements.
// A part is three independent layers:
//   manifest  (part.json)  – static data: terminals, footprint, props, ratings
//   behavior  (behavior.ts) – electrical + timed behavior, stamped into the MNA solver
//   view      (view.ts)     – SVG drawn from props + observables, no logic

/** Virtual simulation time in nanoseconds. 2^53 ns ≈ 104 days, enough for any lesson. */
export type SimTime = number;

export const NS = 1;
export const US = 1_000;
export const MS = 1_000_000;
export const S = 1_000_000_000;

// ---------------------------------------------------------------------------
// Manifest (part.json)
// ---------------------------------------------------------------------------

export interface TerminalDef {
  /** Name used by the behavior when stamping, e.g. "anode". */
  name: string;
  /** Offset from the anchor terminal, in breadboard pitches (2.54 mm). */
  dx: number;
  dy: number;
  label?: string;
}

export type PropSchema =
  | { type: 'number'; default: number; unit?: string; min?: number; max?: number; options?: number[] }
  | { type: 'enum'; default: string; options: string[] }
  | { type: 'boolean'; default: boolean };

export interface Ratings {
  /** Max continuous current through the part (A). Above it, overstress time accumulates. */
  currentMax?: number;
  /** Instant destruction above this current (A). */
  currentAbsMax?: number;
  /** Max reverse voltage (V), e.g. LED ≈ 5 V. */
  reverseVoltageMax?: number;
  powerMax?: number;
  /** How long the part survives above currentMax / powerMax. */
  overstressTime?: SimTime;
}

export interface PartManifest {
  /** Globally unique type id, e.g. "led". */
  id: string;
  version: string;
  name: string;
  category: 'passive' | 'output' | 'input' | 'sensor' | 'display' | 'power' | 'mcu' | 'instrument';
  tags?: string[];
  terminals: TerminalDef[];
  /** Terminal pairs that are always joined inside the part (e.g. pushbutton legs). Merged in the netlist. */
  internalShorts?: [string, string][];
  props: Record<string, PropSchema>;
  ratings?: Ratings;
}

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

/**
 * Linear stamping into the MNA matrix. All addressing is by terminal name; the kernel
 * maps terminals to nets. Sign convention: current(a, b, i) pushes i amperes from a to b
 * through the part.
 */
export interface StampContext {
  conductance(a: string, b: string, g: number): void;
  current(a: string, b: string, i: number): void;
  /** Ideal source v(pos) - v(neg) = v. Use a series conductance for real-world sources. */
  voltageSource(pos: string, neg: string, v: number): void;
}

/** Stamping for one Newton-Raphson iteration: voltages are from the previous iterate. */
export interface NonlinearContext extends StampContext {
  v(terminal: string): number;
  /**
   * The part limited its step this iteration (e.g. pnjlim), so the solution is not final even if
   * node voltages stopped moving – without this an LED can look "converged" while still open.
   */
  limited(): void;
}

/** The solved operating point, handed to the part after each converged solve. */
export interface OperatingPoint {
  v(terminal: string): number;
  /** Time since the previous solve, for overstress accumulation. */
  dt: SimTime;
  t: SimTime;
}

export type PartEvent =
  | { kind: 'press' }
  | { kind: 'release' }
  | { kind: 'timer'; tag: string }
  | { kind: 'set'; key: string; value: number | string | boolean };

export interface PartEnv {
  now(): SimTime;
  /** Schedule a timer event back to this part. */
  schedule(at: SimTime, tag: string): void;
  /** Deterministic PRNG in [0, 1), seeded per project so runs are reproducible. */
  random(): number;
  /** Tell the kernel the circuit must be re-solved (switch moved, value changed...). */
  invalidate(): void;
}

export type Observable = number | string | boolean;

export interface PartBehavior {
  stamp?(ctx: StampContext): void;
  stampNonlinear?(ctx: NonlinearContext): void;
  /** Called once per converged solve: update observables, check ratings. */
  onSolved?(op: OperatingPoint): void;
  onEvent?(ev: PartEvent): void;
  observables(): Record<string, Observable>;
  readonly damaged: boolean;
}

export type PartProps = Record<string, number | string | boolean>;

export interface PartModule<P extends PartProps = PartProps> {
  manifest: PartManifest;
  create(props: P, env: PartEnv): PartBehavior;
}

/** Fill in defaults from the manifest for any prop the project did not set. */
export function resolveProps(manifest: PartManifest, props: PartProps = {}): PartProps {
  const out: PartProps = {};
  for (const [key, schema] of Object.entries(manifest.props)) out[key] = props[key] ?? schema.default;
  return out;
}

// ---------------------------------------------------------------------------
// Helpers shared by part authors
// ---------------------------------------------------------------------------

/** Thermal voltage at 300 K. */
export const VT = 0.025852;

/**
 * SPICE pnjlim: limits the junction-voltage step between Newton iterations so exp() cannot
 * overflow and the solver converges.
 */
export function pnjlim(vNew: number, vOld: number, nVt: number, vCrit: number): number {
  if (vNew > vCrit && Math.abs(vNew - vOld) > 2 * nVt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / nVt;
      return arg > 0 ? vOld + nVt * Math.log(arg) : vCrit;
    }
    return nVt * Math.log(vNew / nVt);
  }
  return vNew;
}

/** Tracks time spent above a rating; reports when the part should be marked damaged. */
export class Overstress {
  private accumulated = 0;
  constructor(private readonly limit: SimTime) {}

  /** Returns true when the part has now been destroyed. */
  update(over: boolean, dt: SimTime): boolean {
    this.accumulated = over ? this.accumulated + dt : Math.max(0, this.accumulated - dt);
    return this.accumulated > this.limit;
  }
}
