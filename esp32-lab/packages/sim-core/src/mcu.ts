// The boundary between firmware and circuit is the chip's pads. An McuModel (the Xtensa emulator
// in WASM, or ScriptedMcu in tests) only ever exchanges pad drive states and pad voltages with the
// circuit, so any MCU can be dropped in without touching the kernel.

import type { SimTime } from '@esp32lab/part-sdk';

export interface PadDrive {
  output: 'high' | 'low' | 'z';
  pull: 'up' | 'down' | 'none';
  /** Drive-strength setting (ESP32 FUN_DRV 0–3). */
  strength: number;
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

export interface McuStep {
  /** Time actually reached; earlier than requested when a pad drive changed. */
  t: SimTime;
  padsChanged: boolean;
}

export interface McuModel {
  readonly pads: readonly string[];
  readonly electrical: PadElectrical;
  drive(pad: string): PadDrive;
  /** Latest circuit voltages at every pad, delivered after each solve. */
  setInputs(inputs: ReadonlyMap<string, PadInput>, t: SimTime): void;
  /** Run firmware until `t`, stopping early as soon as any pad drive changes. */
  runUntil(t: SimTime): McuStep;
  /** The circuit destroyed a pad's output stage (sustained overcurrent). */
  padDamaged?(pad: string): void;
  onSerial?(listener: (port: number, bytes: Uint8Array) => void): void;
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

  constructor(
    readonly pads: readonly string[],
    electrical: PadElectrical = ESP32_PAD_ELECTRICAL,
    private readonly vdd = 3.3,
  ) {
    this.electrical = electrical;
  }

  set(pad: string, drive: Partial<PadDrive>, at: SimTime = this.now): this {
    const prev = this.script.filter((s) => s.pad === pad).at(-1)?.drive ?? this.drive(pad);
    this.script.push({ t: at, pad, drive: { ...prev, ...drive } });
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
