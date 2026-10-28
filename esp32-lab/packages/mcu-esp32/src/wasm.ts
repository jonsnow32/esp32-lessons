// The ESP32 emulator (crates/esp32-wasm) as an McuModel: real firmware on emulated Xtensa
// cores, exchanging only pad drive states and pad voltages with the circuit simulator.

import type { SimTime } from '@esp32lab/part-sdk';
import { ESP32_PAD_ELECTRICAL, type McuModel, type McuStep, type PadDrive, type PadElectrical, type PadInput } from '@esp32lab/sim-core';

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
  soc_set_pad_input(soc: number, gpio: number, level: number): void;
  soc_set_board_pull_ups(soc: number, lo: number, hi: number): void;
}

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
    return new Esp32Wasm(module.exports as unknown as Exports);
  }

  scratch(len: number): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, this.x.scratch_ptr(), len).slice();
  }

  private copyIn(data: Uint8Array | undefined): [number, number] {
    if (!data || data.length === 0) return [0, 0];
    const ptr = this.x.alloc(data.length);
    new Uint8Array(this.x.memory.buffer, ptr, data.length).set(data);
    return [ptr, data.length];
  }

  boot(fw: Firmware): Esp32Mcu {
    const args = [fw.elf, fw.bin, fw.bootloader, fw.partitions].map((d) => this.copyIn(d));
    const soc = this.x.soc_new(...(args.flat() as [number, number, number, number, number, number, number, number]));
    for (const [ptr, len] of args) if (len) this.x.dealloc(ptr, len);
    if (soc === 0) throw new Error(`ESP32 boot failed: ${new TextDecoder().decode(this.scratch(this.x.last_error_len()))}`);
    return new Esp32Mcu(this.x, this, soc);
  }
}

/** GPIO number for each pad name the board uses ("GPIO18" → 18); EN is handled separately. */
function gpioNumber(pad: string): number | undefined {
  const m = /^GPIO(\d+)$/.exec(pad);
  return m ? Number(m[1]) : undefined;
}

export class Esp32Mcu implements McuModel {
  readonly pads: readonly string[];
  readonly electrical: PadElectrical = ESP32_PAD_ELECTRICAL;
  /** Set when the emulator stopped for good (BREAK, unimplemented ROM call, reset). */
  halted: string | null = null;
  private drives = new Map<string, PadDrive>();
  private levels = new Map<string, 0 | 1>();
  private serialListeners: ((port: number, bytes: Uint8Array) => void)[] = [];
  private damaged = new Set<string>();

  constructor(
    private readonly x: Exports,
    private readonly wasm: Esp32Wasm,
    private readonly soc: number,
    pads: readonly string[] = Array.from({ length: 40 }, (_, n) => `GPIO${n}`).filter((p) => ![20, 24, 28, 29, 30, 31].includes(gpioNumber(p)!)),
  ) {
    this.pads = pads;
    // The circuit models the board's own pull-ups (BOOT, EN), so the chip must not assume them
    this.x.soc_set_board_pull_ups(soc, 0, 0);
    this.refreshDrives();
  }

  /** Virtual time in ns. */
  get now(): SimTime {
    return this.x.soc_cycles(this.soc) / CYCLES_PER_NS;
  }

  private refreshDrives(): void {
    for (const pad of this.pads) {
      const n = gpioNumber(pad);
      if (n === undefined) continue;
      const s = this.x.soc_pad_state(this.soc, n);
      this.drives.set(pad, {
        output: s & 1 ? (s & 2 ? 'high' : 'low') : 'z',
        pull: s & 4 ? 'up' : s & 8 ? 'down' : 'none',
        strength: (s >> 8) & 3,
      });
    }
  }

  drive(pad: string): PadDrive {
    if (this.damaged.has(pad)) return { output: 'z', pull: 'none', strength: 2 };
    return this.drives.get(pad) ?? { output: 'z', pull: 'none', strength: 2 };
  }

  setInputs(inputs: ReadonlyMap<string, PadInput>, _t: SimTime): void {
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
    }
  }

  runUntil(t: SimTime): McuStep {
    if (this.halted) return { t, padsChanged: false };
    const code = this.x.soc_run_until(this.soc, Math.ceil(t * CYCLES_PER_NS));
    this.flushSerial();
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
