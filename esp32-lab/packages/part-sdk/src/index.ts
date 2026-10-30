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
  /**
   * Terminal groups with no electrical path between them inside the part (a relay's coil side
   * and its contacts): sharing a net across groups is wiring, not a short.
   */
  isolated?: string[][];
  props: Record<string, PropSchema>;
  /**
   * Props that make a different physical item to keep in stock (a 220 Ω vs a 10 kΩ resistor), as
   * opposed to props the simulation varies (temperature, knob position). Omitted: the type alone.
   */
  stock?: string[];
  ratings?: Ratings;
  /** Beginner card shown when the part is selected (UI language: Vietnamese). */
  learn?: {
    summary: string;
    howToPlug: string[];
    tips?: string[];
  };
  /** How the part is usually wired to the ESP32, for the one-click plug-in (see PlugSpec). */
  plug?: PlugSpec;
}

/**
 * What a terminal connects to: a supply, GND, a free GPIO that can drive (`out`) or read (`in`),
 * an ADC1 pin, the I2C pins, or `common`, which follows the part's `common` prop (GND for a
 * common cathode, 3V3 for a common anode).
 */
export type PlugRole = 'gnd' | '3v3' | '5v' | 'out' | 'in' | 'adc' | 'sda' | 'scl' | 'common';

export interface PlugSpec {
  /** Terminals left out stay free. */
  pins: Record<string, PlugRole>;
  /** A resistor between the terminal and what it connects to (Ω): an LED's current limit. */
  series?: Record<string, number>;
  /** A resistor from the terminal to a supply as well (Ω): a pull-up, the low half of a divider. */
  pull?: Record<string, ['3v3' | 'gnd', number]>;
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

/** A repeating waveform an MCU pad puts out (LEDC: analogWrite, ledcWrite, tone). */
export interface PwmSignal {
  periodNs: number;
  /** Time HIGH in each period, 0 < highNs < periodNs. */
  highNs: number;
}

/**
 * A burst of pulses on a wire, too fast for the circuit solve to follow: an RMT transmission,
 * the data stream of a WS2812 chain. Parts get it whole, with when each level began.
 */
export interface PulseTrain {
  /** Time the first pulse started. */
  t: SimTime;
  /** [level, duration in ns]; neighbours alternate. */
  pulses: readonly (readonly [0 | 1, number])[];
}

/**
 * The solved operating point, handed to the part after each converged solve. While a pad puts
 * out PWM the circuit is solved once per stretch of the period with a fixed set of pads HIGH,
 * and the part sees each stretch in turn with its share of `dt`.
 */
export interface OperatingPoint {
  v(terminal: string): number;
  /** Time since the previous solve, for overstress accumulation. */
  dt: SimTime;
  t: SimTime;
  /** The PWM waveform on the terminal's net, if an MCU pad drives one there directly. */
  pwm?(terminal: string): PwmSignal | undefined;
}

export type PartEvent =
  /** `key` names which of the part's press controls it was (a keypad key); absent for one-button parts. */
  | { kind: 'press'; key?: string }
  | { kind: 'release'; key?: string }
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
  /** Put a pulse train out on one of the part's terminals (a WS2812 passing data on at DOUT). */
  emit(terminal: string, train: PulseTrain): void;
  /**
   * What the bench's parts share without a wire, by name: the water a pump pours into the pot
   * a soil probe sits in. Rebuilt empty with the circuit; whoever writes a value re-derives it.
   */
  world: World;
}

export interface World {
  get(key: string): number;
  set(key: string, value: number): void;
}

export type Observable = number | string | boolean;

/**
 * A device on an I2C bus, at transaction level: the kernel decodes START, the address byte, data
 * bytes and STOP from what the MCU's controller clocks out, once the bus is electrically sound.
 */
export interface I2cTarget {
  /** 7-bit address the device answers to. */
  readonly address: number;
  /** START + its address: ACK (true) to take part, false to stay silent (e.g. unpowered). */
  begin(read: boolean): boolean;
  /** A byte from the controller; true = ACK. */
  write(byte: number): boolean;
  /** The next byte for the controller. */
  read(): number;
  /** STOP, or a repeated START that addresses someone else. */
  end?(): void;
}

export interface PartBehavior {
  /** Present on I2C devices; the part's `bus` terminals carry SDA and SCL. */
  readonly i2c?: I2cTarget;
  stamp?(ctx: StampContext): void;
  stampNonlinear?(ctx: NonlinearContext): void;
  /** Called once per converged solve: update observables, check ratings. */
  onSolved?(op: OperatingPoint): void;
  onEvent?(ev: PartEvent): void;
  /** A pulse train arrived on `terminal`, from an MCU pad or another part's `emit` on its net. */
  pulses?(terminal: string, train: PulseTrain): void;
  observables(): Record<string, Observable>;
  readonly damaged: boolean;
  /**
   * State that must outlive a circuit rebuild (a wire moved, a prop changed while the firmware
   * runs on): what a display shows, where a servo points. The new instance of the same part
   * gets it back through `restore`. Anything electrical is re-derived from the solve instead.
   */
  persist?(): unknown;
  restore?(state: unknown): void;
}

export type PartProps = Record<string, number | string | boolean>;

/**
 * SVG markup for the part, unrotated, in breadboard-pitch units with the first terminal at
 * (0, 0). Pure function of props and the latest observables: no logic, no events.
 */
export type PartView<P extends PartProps = PartProps> = (props: P, obs: Record<string, Observable>) => string;

export type PartControl = { cx: number; cy: number; r: number } & ({ kind: 'press'; key?: string } | { kind: 'toggle'; prop: string });

export interface PartModule<P extends PartProps = PartProps> {
  manifest: PartManifest;
  create(props: P, env: PartEnv): PartBehavior;
  view?: PartView<P>;
  /**
   * SVG <defs> content (gradients, filters) the view references. Inserted once per workbench;
   * prefix ids with the part id to avoid clashes, e.g. "led-lens-red".
   */
  defs?: string;
  /** Library icon frame (SVG viewBox in pitch units) around the unrotated view. */
  icon?: string;
  /**
   * Clickable spot(s) on the part (pitch units, unrotated). `press` sends press/release while held
   * (a push button; with `key`, one of several, like a keypad's keys); `toggle` flips a boolean
   * prop or steps an enum prop to its next option (a slide switch). Props survive circuit
   * rebuilds, events do not, hence the two kinds.
   */
  control?: PartControl | PartControl[];
  /** The part's detail page: key figures and drawings (UI language: Vietnamese). */
  doc?: PartDoc<P>;
  /** Terminals of an I2C device's bus lines (its behavior provides `i2c`). */
  bus?: { sda: string; scl: string };
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

/**
 * What the part's detail page shows besides the manifest (pinout, ratings and the learn card
 * are drawn from the manifest). Figures are a function of the props the reader picks on the
 * page, so a curve can mark the chosen value and a wiring diagram can show the chosen variant.
 */
export interface PartDoc<P extends PartProps = PartProps> {
  /** Key figures as label / value rows, e.g. ['Điện áp thuận', '1,8 V']. */
  specs(props: P): [string, string][];
  /** Observables that show the part at work (a lit LED, a pressed button), next to it at rest. */
  active?: Record<string, Observable>;
  figures(props: P): DocFigure[];
}

export type DocFigure = { title: string; caption?: string } & (
  /** Hand-drawn SVG; classes from schematic.ts pick up the page's colours. */
  | { kind: 'svg'; viewBox: string; svg: string }
  | { kind: 'chart'; x: ChartAxis; y: ChartAxis; series: ChartSeries[]; marks?: ChartMark[] }
  | { kind: 'timing'; end: number; signals: TimingSignal[]; spans?: TimingSpan[] }
);

export interface ChartAxis {
  label: string;
  min: number;
  max: number;
  /** Logarithmic scale (min must be > 0); ticks default to the decades. */
  log?: boolean;
  ticks?: number[];
  format?: (v: number) => string;
}

export interface ChartSeries {
  points: [number, number][];
  label?: string;
  color?: string;
  /** Drawn thin and grey behind the others, e.g. the LED colours not picked. */
  muted?: boolean;
}

/** A point when both x and y are given, else a dashed line across the plot at x or y. */
export interface ChartMark {
  x?: number;
  y?: number;
  label: string;
  tone?: 'accent' | 'error' | 'signal';
}

/** One digital line in a timing diagram: [time, level 0 | 1] wherever it changes, from time 0. */
export interface TimingSignal {
  name: string;
  steps: [number, 0 | 1][];
  color?: string;
}

/** A bracket under signal `row` between two times, labelled with the real duration. */
export interface TimingSpan {
  row: number;
  from: number;
  to: number;
  label: string;
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

const G_MIN = 1e-12; // keeps the matrix regular when a junction is off

/**
 * Shockley diode for diodes and LEDs: I = Is·(exp(v / nVt) − 1), stamped as a Newton companion
 * model with pnjlim step limiting. Keep one instance per junction: it remembers the last iterate.
 */
export class Junction {
  readonly nVt: number;
  private readonly vCrit: number;
  private vLast = 0;

  constructor(
    readonly is: number,
    n: number,
  ) {
    this.nVt = n * VT;
    this.vCrit = this.nVt * Math.log(this.nVt / (Math.SQRT2 * is));
  }

  /** The junction that carries `i` amperes at forward voltage `v` (datasheet point). */
  static fit(v: number, i: number, n: number): Junction {
    return new Junction(i / Math.exp(v / (n * VT)), n);
  }

  current(vd: number): number {
    return this.is * (Math.exp(vd / this.nVt) - 1);
  }

  stamp(ctx: NonlinearContext, anode: string, cathode: string): void {
    const vRaw = ctx.v(anode) - ctx.v(cathode);
    const vd = pnjlim(vRaw, this.vLast, this.nVt, this.vCrit);
    if (vd !== vRaw) ctx.limited();
    this.vLast = vd;
    const e = Math.exp(vd / this.nVt);
    const i = this.is * (e - 1);
    const g = (this.is * e) / this.nVt;
    // Companion model: I(v) ≈ g·v + (i − g·vd)
    ctx.conductance(anode, cathode, g + G_MIN);
    ctx.current(anode, cathode, i - g * vd);
  }
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

export * as sch from './schematic';
