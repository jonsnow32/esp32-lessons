// The boundary between firmware and circuit is the chip's pads. An McuModel (the Xtensa emulator
// in WASM, or ScriptedMcu in tests) only ever exchanges pad drive states and pad voltages with the
// circuit, so any MCU can be dropped in without touching the kernel.

import type { PulseTrain, PwmSignal, SimTime } from '@esp32lab/part-sdk';

export interface PadDrive {
  output: 'high' | 'low' | 'z';
  pull: 'up' | 'down' | 'none';
  /** Drive-strength setting (ESP32 FUN_DRV 0–3). */
  strength: number;
  /** The output toggles with this waveform instead of holding `output` (which is then 'high'). */
  pwm?: PwmSignal;
}

export const PAD_Z: PadDrive = { output: 'z', pull: 'none', strength: 2 };

export interface PadInput {
  volts: number;
  /** No DC path anywhere – a real chip would read noise. */
  floating: boolean;
}

export interface PadElectrical {
  /** Name of the supply net the output stage and pull resistors connect to, e.g. "3V3". */
  vddNet: string;
  /** Output on-resistance per drive strength (Ω). */
  rOn: number[];
  rPull: number;
  /** Per-pad current the pad survives continuously (A). */
  currentMax: number;
}

/** One step of an I2C command list, as an MCU's controller clocks it out. */
export type I2cOp =
  | { kind: 'start' }
  | { kind: 'write'; bytes: number[]; ackCheck: boolean; ackExp: boolean }
  | { kind: 'read'; len: number; nack: boolean }
  | { kind: 'stop' }
  | { kind: 'end' };

export interface I2cTransaction {
  port: number;
  /** Pads carrying the controller's SDA and SCL; undefined if not routed to any pad. */
  sda?: string;
  scl?: string;
  ops: I2cOp[];
}

/** The bus's answer: per written byte its ACK (true = ACK), then the bytes read. */
export interface I2cReply {
  acks: boolean[];
  data: number[];
}

export interface McuStep {
  /** Time actually reached; earlier than requested when a pad drive changed. */
  t: SimTime;
  padsChanged: boolean;
}

export interface McuModel {
  readonly pads: readonly string[];
  readonly electrical: PadElectrical;
  drive(pad: string): PadDrive;
  /**
   * Latest circuit voltages at every pad, delivered after each solve. Return true if this
   * changed the chip's own pad drives (e.g. its reset pin went low and every pad let go), so
   * the circuit is solved again.
   */
  setInputs(inputs: ReadonlyMap<string, PadInput>, t: SimTime): boolean | void;
  /** Run firmware until `t`, stopping early as soon as any pad drive changes. */
  runUntil(t: SimTime): McuStep;
  /** The circuit destroyed a pad's output stage (sustained overcurrent). */
  padDamaged?(pad: string): void;
  onSerial?(listener: (port: number, bytes: Uint8Array) => void): void;
  /** Who answers the MCU's I2C transactions; without one, nobody does (every address NACKed). */
  setI2cBus?(bus: ((tx: I2cTransaction) => I2cReply) | null): void;
  /** Who gets the pulse trains the chip puts out on a pad (RMT), each once it is complete. */
  setPulseSink?(sink: ((pad: string, train: PulseTrain) => void) | null): void;
}

/** ESP32 pad characteristics (datasheet §5, approximate – to be calibrated against real boards). */
export const ESP32_PAD_ELECTRICAL: PadElectrical = {
  vddNet: '3V3',
  // VOH ≥ 0.8·VDD at 5 / 10 / 20 / 40 mA for drive strength 0–3
  rOn: [132, 66, 33, 16.5],
  rPull: 45_000,
  currentMax: 0.04,
};

/**
 * MCU stand-in for tests and for lessons without firmware: pad drives follow a timed script and
 * digital reads use the ESP32 input thresholds (VIL ≤ 0.25·VDD, VIH ≥ 0.75·VDD).
 */
export class ScriptedMcu implements McuModel {
  readonly electrical: PadElectrical;
  private drives = new Map<string, PadDrive>();
  private script: { t: SimTime; pad: string; drive: PadDrive }[] = [];
  private inputs = new Map<string, PadInput>();
  private levels = new Map<string, 0 | 1>();
  private now = 0;
  /** Every logic-level change seen on an input pad: what a logic analyzer on the pin would show. */
  readonly edges: { t: SimTime; pad: string; level: 0 | 1 }[] = [];
  readonly damagedPads = new Set<string>();
  private i2cBus: ((tx: I2cTransaction) => I2cReply) | null = null;
  private pulseSink: ((pad: string, train: PulseTrain) => void) | null = null;

  constructor(
    readonly pads: readonly string[],
    electrical: PadElectrical = ESP32_PAD_ELECTRICAL,
    private readonly vdd = 3.3,
  ) {
    this.electrical = electrical;
  }

  setI2cBus(bus: ((tx: I2cTransaction) => I2cReply) | null): void {
    this.i2cBus = bus;
  }

  setPulseSink(sink: ((pad: string, train: PulseTrain) => void) | null): void {
    this.pulseSink = sink;
  }

  /** Put a pulse train out on `pad`, as the RMT would (starting now unless `t` says otherwise). */
  pulse(pad: string, pulses: PulseTrain['pulses'], t: SimTime = this.now): void {
    this.pulseSink?.(pad, { t, pulses });
  }

  /** Clock a command list out on the I2C bus, as a controller on these pads would. */
  i2c(ops: I2cOp[], sda = 'GPIO21', scl = 'GPIO22', port = 0): I2cReply {
    return this.i2cBus?.({ port, sda, scl, ops }) ?? { acks: [], data: [] };
  }

  set(pad: string, drive: Partial<PadDrive>, at: SimTime = this.now): this {
    const prev = this.script.filter((s) => s.pad === pad).at(-1)?.drive ?? this.drive(pad);
    const next = { ...prev, ...drive };
    // Already due: the pad drives it now (the first solve sees it); the script entry still
    // reports the change on the next run so a solved circuit is solved again
    if (at <= this.now) this.drives.set(pad, next);
    this.script.push({ t: at, pad, drive: next });
    this.script.sort((a, b) => a.t - b.t);
    return this;
  }

  drive(pad: string): PadDrive {
    return this.damagedPads.has(pad) ? PAD_Z : (this.drives.get(pad) ?? PAD_Z);
  }

  /** Logic level with hysteresis; a floating pin keeps its last value, as real CMOS inputs tend to. */
  read(pad: string): 0 | 1 {
    return this.levels.get(pad) ?? 0;
  }

  setInputs(inputs: ReadonlyMap<string, PadInput>, t: SimTime): void {
    this.inputs = new Map(inputs);
    for (const [pad, input] of inputs) {
      const prev = this.levels.get(pad);
      let level = prev ?? (input.volts > this.vdd / 2 ? 1 : 0);
      if (!input.floating) {
        if (input.volts >= 0.75 * this.vdd) level = 1;
        else if (input.volts <= 0.25 * this.vdd) level = 0;
      }
      if (level !== prev) {
        this.levels.set(pad, level);
        if (prev !== undefined) this.edges.push({ t, pad, level });
      }
    }
  }

  input(pad: string): PadInput | undefined {
    return this.inputs.get(pad);
  }

  runUntil(t: SimTime): McuStep {
    const next = this.script[0];
    if (next && next.t <= t) {
      this.now = Math.max(this.now, next.t);
      while (this.script[0] && this.script[0].t <= this.now) {
        const s = this.script.shift()!;
        this.drives.set(s.pad, s.drive);
      }
      return { t: this.now, padsChanged: true };
    }
    this.now = t;
    return { t, padsChanged: false };
  }

  padDamaged(pad: string): void {
    this.damagedPads.add(pad);
  }
}
