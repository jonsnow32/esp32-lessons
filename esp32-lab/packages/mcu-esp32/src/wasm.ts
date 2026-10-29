// The ESP32 emulator (crates/esp32-wasm) as an McuModel: real firmware on emulated Xtensa
// cores, exchanging only pad drive states and pad voltages with the circuit simulator.

import type { PulseTrain, SimTime } from '@esp32lab/part-sdk';
import {
  ESP32_PAD_ELECTRICAL,
  type I2cOp,
  type I2cReply,
  type I2cTransaction,
  type McuModel,
  type McuStep,
  type PadDrive,
  type PadElectrical,
  type PadInput,
} from '@esp32lab/sim-core';

/** Emulated CPU clock: 240 cycles per µs. */
const CYCLES_PER_NS = 0.24;
const VDD = 3.3;

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  scratch_ptr(): number;
  last_error_len(): number;
  soc_new(elf: number, elfLen: number, bin: number, binLen: number, boot: number, bootLen: number, parts: number, partsLen: number): number;
  soc_free(soc: number): void;
  soc_run_until(soc: number, until: number): number;
  soc_cycles(soc: number): number;
  soc_uart_take(soc: number, port: number): number;
  soc_uart_push(soc: number, port: number, byte: number): void;
  soc_pad_state(soc: number, gpio: number): number;
  soc_pad_pwm_period(soc: number, gpio: number): number;
  soc_pad_pwm_high(soc: number, gpio: number): number;
  soc_i2c_take(soc: number): number;
  soc_i2c_answer(soc: number, ptr: number, len: number): void;
  soc_rmt_take(soc: number): number;
  soc_set_pad_input(soc: number, gpio: number, level: number): void;
  soc_set_pad_volts(soc: number, gpio: number, volts: number): void;
  soc_set_board_pull_ups(soc: number, lo: number, hi: number): void;
}

const REQUIRED_EXPORTS = [
  'alloc', 'dealloc', 'scratch_ptr', 'last_error_len', 'soc_new', 'soc_free', 'soc_run_until', 'soc_cycles',
  'soc_uart_take', 'soc_uart_push', 'soc_pad_state', 'soc_pad_pwm_period', 'soc_pad_pwm_high', 'soc_i2c_take', 'soc_i2c_answer', 'soc_rmt_take', 'soc_set_pad_input', 'soc_set_pad_volts', 'soc_set_board_pull_ups',
] as const satisfies readonly Exclude<keyof Exports, 'memory'>[];

/** A PlatformIO build: .pio/build/<env>/{firmware.elf, firmware.bin, bootloader.bin, partitions.bin}. */
export interface Firmware {
  elf: Uint8Array;
  bin: Uint8Array;
  bootloader?: Uint8Array;
  partitions?: Uint8Array;
}

export class Esp32Wasm {
  private constructor(private readonly x: Exports) {}

  static async load(source: BufferSource | Response | Promise<Response>): Promise<Esp32Wasm> {
    const module =
      source instanceof Response || source instanceof Promise
        ? (await WebAssembly.instantiateStreaming(source, {})).instance
        : (await WebAssembly.instantiate(source, {})).instance;
    // A module built before the TypeScript side last changed (or a stale cached copy) would
    // otherwise fail later with "x.soc_... is not a function"
    const missing = REQUIRED_EXPORTS.filter((name) => typeof module.exports[name] !== 'function');
    if (missing.length) {
      throw new Error(`ESP32 emulator (esp32.wasm) is out of date, it lacks ${missing.join(', ')}: run scripts/build-wasm.sh and reload the page`);
    }
    return new Esp32Wasm(module.exports as unknown as Exports);
  }

  scratch(len: number): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, this.x.scratch_ptr(), len).slice();
  }

  copyIn(data: Uint8Array | undefined): [number, number] {
    if (!data || data.length === 0) return [0, 0];
    const ptr = this.x.alloc(data.length);
    new Uint8Array(this.x.memory.buffer, ptr, data.length).set(data);
    return [ptr, data.length];
  }

  /** Create a freshly reset SoC running `fw`; returns its handle. */
  createSoc(fw: Firmware): number {
    const args = [fw.elf, fw.bin, fw.bootloader, fw.partitions].map((d) => this.copyIn(d));
    const soc = this.x.soc_new(...(args.flat() as [number, number, number, number, number, number, number, number]));
    for (const [ptr, len] of args) if (len) this.x.dealloc(ptr, len);
    if (soc === 0) throw new Error(`ESP32 boot failed: ${new TextDecoder().decode(this.scratch(this.x.last_error_len()))}`);
    return soc;
  }

  boot(fw: Firmware): Esp32Mcu {
    return new Esp32Mcu(this.x, this, fw);
  }
}

/** Nobody on the bus: every byte NACKed, every byte read 0xFF. */
function emptyReply(tx: I2cTransaction): I2cReply {
  const acks: boolean[] = [];
  const data: number[] = [];
  for (const op of tx.ops) {
    if (op.kind === 'write') acks.push(...op.bytes.map(() => false));
    if (op.kind === 'read') data.push(...Array<number>(op.len).fill(0xff));
  }
  return { acks, data };
}

/** GPIO number for each pad name the board uses ("GPIO18" → 18); EN is handled separately. */
function gpioNumber(pad: string): number | undefined {
  const m = /^GPIO(\d+)$/.exec(pad);
  return m ? Number(m[1]) : undefined;
}

/** The chip-enable pin: LOW holds the whole chip in reset, the rising edge boots it. */
const EN = 'EN';

export class Esp32Mcu implements McuModel {
  readonly pads: readonly string[];
  readonly electrical: PadElectrical = ESP32_PAD_ELECTRICAL;
  /** Set when the emulator stopped for good (BREAK, unimplemented ROM call, reset). */
  halted: string | null = null;
  private drives = new Map<string, PadDrive>();
  private levels = new Map<string, 0 | 1>();
  /** Last voltage handed to the ADCs at each pad. */
  private volts = new Map<string, number>();
  private serialListeners: ((port: number, bytes: Uint8Array) => void)[] = [];
  private damaged = new Set<string>();
  private soc: number;
  /** Chip held in reset by EN being LOW: no code runs and every pad is high-impedance. */
  private inReset = false;
  /** Kernel time at which the current SoC instance came out of reset (its cycle 0). */
  private bootedAt: SimTime = 0;
  /** Number of times EN has rebooted the chip. */
  resets = 0;
  private i2cBus: ((tx: I2cTransaction) => I2cReply) | null = null;
  private pulseSink: ((pad: string, train: PulseTrain) => void) | null = null;

  constructor(
    private readonly x: Exports,
    private readonly wasm: Esp32Wasm,
    private readonly firmware: Firmware,
    pads: readonly string[] = [
      ...Array.from({ length: 40 }, (_, n) => `GPIO${n}`).filter((p) => ![20, 24, 28, 29, 30, 31].includes(gpioNumber(p)!)),
      EN,
    ],
  ) {
    this.pads = pads;
    this.soc = this.boot();
  }

  private boot(): number {
    const soc = this.wasm.createSoc(this.firmware);
    // The circuit models the board's own pull-ups (BOOT, EN), so the chip must not assume them
    this.x.soc_set_board_pull_ups(soc, 0, 0);
    this.soc = soc;
    this.levels.clear();
    this.volts.clear();
    this.refreshDrives();
    return soc;
  }

  /** Virtual time in ns. */
  get now(): SimTime {
    return this.bootedAt + this.x.soc_cycles(this.soc) / CYCLES_PER_NS;
  }

  private refreshDrives(): void {
    for (const pad of this.pads) {
      const n = gpioNumber(pad);
      if (n === undefined) continue;
      const s = this.x.soc_pad_state(this.soc, n);
      const periodNs = this.x.soc_pad_pwm_period(this.soc, n);
      this.drives.set(pad, {
        output: s & 1 ? (s & 2 ? 'high' : 'low') : 'z',
        pull: s & 4 ? 'up' : s & 8 ? 'down' : 'none',
        strength: (s >> 8) & 3,
        ...(periodNs > 0 && { pwm: { periodNs, highNs: this.x.soc_pad_pwm_high(this.soc, n) } }),
      });
    }
  }

  drive(pad: string): PadDrive {
    if (this.inReset || this.damaged.has(pad)) return { output: 'z', pull: 'none', strength: 2 };
    return this.drives.get(pad) ?? { output: 'z', pull: 'none', strength: 2 };
  }

  setInputs(inputs: ReadonlyMap<string, PadInput>, t: SimTime): boolean {
    // EN: below VIL the chip is in reset; above VIH it runs. Floating EN keeps the last state.
    const en = inputs.get(EN);
    if (en && !en.floating) {
      if (!this.inReset && en.volts <= 0.25 * VDD) {
        this.inReset = true;
        return true; // every pad just let go
      }
      if (this.inReset && en.volts >= 0.75 * VDD) {
        this.inReset = false;
        this.x.soc_free(this.soc);
        this.boot();
        this.bootedAt = t;
        this.resets++;
        return true;
      }
    }
    if (this.inReset) return false;
    for (const [pad, input] of inputs) {
      const n = gpioNumber(pad);
      if (n === undefined) continue;
      // CMOS input with hysteresis: VIL ≤ 0.25·VDD, VIH ≥ 0.75·VDD; a floating pin keeps its value
      const prev = this.levels.get(pad);
      let level = prev ?? (input.volts > VDD / 2 ? 1 : 0);
      if (!input.floating) {
        if (input.volts >= 0.75 * VDD) level = 1;
        else if (input.volts <= 0.25 * VDD) level = 0;
      }
      if (level !== prev) {
        this.levels.set(pad, level);
        this.x.soc_set_pad_input(this.soc, n, level);
      }
      // The ADCs see the voltage itself (a floating pin reads whatever the solver left there)
      if (Math.abs(input.volts - (this.volts.get(pad) ?? NaN)) < 1e-4) continue;
      this.volts.set(pad, input.volts);
      this.x.soc_set_pad_volts(this.soc, n, input.volts);
    }
    return false;
  }

  runUntil(t: SimTime): McuStep {
    if (this.halted || this.inReset) return { t, padsChanged: false };
    let code: number;
    // An I2C transaction is answered on the spot and the chip runs on
    while ((code = this.x.soc_run_until(this.soc, Math.ceil((t - this.bootedAt) * CYCLES_PER_NS))) === 3) this.answerI2c();
    this.flushSerial();
    this.flushPulses();
    if (code === 2) {
      this.halted = new TextDecoder().decode(this.wasm.scratch(this.x.last_error_len()));
      return { t, padsChanged: false };
    }
    if (code === 1) {
      this.refreshDrives();
      return { t: Math.min(t, this.now), padsChanged: true };
    }
    return { t, padsChanged: false };
  }

  setI2cBus(bus: ((tx: I2cTransaction) => I2cReply) | null): void {
    this.i2cBus = bus;
  }

  setPulseSink(sink: ((pad: string, train: PulseTrain) => void) | null): void {
    this.pulseSink = sink;
  }

  /** Hand finished RMT transmissions to the circuit. */
  private flushPulses(): void {
    const len = this.x.soc_rmt_take(this.soc);
    if (len === 0) return;
    const b = this.wasm.scratch(len);
    const w = new Uint32Array(b.buffer, b.byteOffset, len / 4);
    for (let i = 0; i < w.length; ) {
      const [gpio, lo, hi, n] = [w[i]!, w[i + 1]!, w[i + 2]!, w[i + 3]!];
      const pulses = Array.from(w.subarray(i + 4, i + 4 + n), (p) => [(p >>> 31) as 0 | 1, p & 0x7fff_ffff] as const);
      i += 4 + n;
      if (gpio === 255 || this.damaged.has(`GPIO${gpio}`)) continue;
      this.pulseSink?.(`GPIO${gpio}`, { t: this.bootedAt + (hi * 2 ** 32 + lo) / CYCLES_PER_NS, pulses });
    }
  }

  private answerI2c(): void {
    const b = this.wasm.scratch(this.x.soc_i2c_take(this.soc));
    if (b.length < 4) return;
    const pad = (n: number) => (n === 255 ? undefined : `GPIO${n}`);
    const ops: I2cOp[] = [];
    let i = 4;
    for (let k = 0; k < b[3]!; k++) {
      const kind = b[i++]!;
      if (kind === 0) ops.push({ kind: 'start' });
      else if (kind === 1) {
        const [ackCheck, ackExp, len] = [b[i]!, b[i + 1]!, b[i + 2]!];
        ops.push({ kind: 'write', ackCheck: ackCheck !== 0, ackExp: ackExp !== 0, bytes: [...b.subarray(i + 3, i + 3 + len)] });
        i += 3 + len;
      } else if (kind === 2) {
        ops.push({ kind: 'read', len: b[i]!, nack: b[i + 1] !== 0 });
        i += 2;
      } else ops.push({ kind: kind === 3 ? 'stop' : 'end' });
    }
    const tx: I2cTransaction = { port: b[0]!, sda: pad(b[1]!), scl: pad(b[2]!), ops };
    const reply = this.i2cBus?.(tx) ?? emptyReply(tx);
    const out = new Uint8Array([...reply.acks.map((a) => (a ? 0 : 1)), ...reply.data]);
    const [ptr, len] = this.wasm.copyIn(out);
    this.x.soc_i2c_answer(this.soc, ptr, len);
    if (len) this.x.dealloc(ptr, len);
  }

  padDamaged(pad: string): void {
    this.damaged.add(pad);
  }

  onSerial(listener: (port: number, bytes: Uint8Array) => void): void {
    this.serialListeners.push(listener);
  }

  /** Type into the serial monitor (UART0 RX). */
  serialWrite(bytes: Uint8Array, port = 0): void {
    for (const b of bytes) this.x.soc_uart_push(this.soc, port, b);
  }

  private flushSerial(): void {
    const len = this.x.soc_uart_take(this.soc, 0);
    if (len === 0) return;
    const bytes = this.wasm.scratch(len);
    for (const l of this.serialListeners) l(0, bytes);
  }

  dispose(): void {
    this.x.soc_free(this.soc);
  }
}
