// End to end: the unmodified lesson firmware runs on the emulated ESP32 (WASM), its pads drive
// the circuit solver, and the board's own parts (blue LED on GPIO2, BOOT button with contact
// bounce on GPIO0) behave physically. Skipped if the WASM module or the PlatformIO build is
// missing (scripts/build-wasm.sh, `pio run -e lesson01`).

import { Esp32Wasm, type Firmware } from '@esp32lab/mcu-esp32';
import { MS, S } from '@esp32lab/part-sdk';
import { SimKernel } from '@esp32lab/sim-core';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOARD, BREADBOARDS, PARTS, project } from './helpers';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const wasmPath = root('packages/mcu-esp32/wasm/esp32.wasm');

function firmware(env: string): Firmware | null {
  const dir = root(`../.pio/build/${env}`);
  if (!existsSync(`${dir}/firmware.elf`)) return null;
  const read = (f: string) => (existsSync(`${dir}/${f}`) ? new Uint8Array(readFileSync(`${dir}/${f}`)) : undefined);
  return { elf: read('firmware.elf')!, bin: read('firmware.bin')!, bootloader: read('bootloader.bin'), partitions: read('partitions.bin') };
}

async function boardWith(env: string) {
  const fw = firmware(env);
  if (!fw || !existsSync(wasmPath)) return null;
  const wasm = await Esp32Wasm.load(readFileSync(wasmPath));
  const mcu = wasm.boot(fw);
  let serial = '';
  mcu.onSerial((_port, bytes) => (serial += new TextDecoder().decode(bytes)));
  const k = new SimKernel({ project: project(), board: BOARD, breadboards: BREADBOARDS, parts: PARTS, mcu });
  return { k, mcu, serial: () => serial };
}

describe.skipIf(!existsSync(wasmPath))('real firmware on the emulated ESP32', () => {
  it('lesson 01 lights the onboard LED through its resistor, on the firmware\'s timing', async () => {
    const b = await boardWith('lesson01');
    if (!b) return;
    b.k.advanceTo(1.05 * S);
    expect(b.mcu.halted).toBeNull();
    expect(b.serial()).toContain('=== Hello ESP32! ===');
    expect(b.serial()).toContain('[0] LED ON');
    // Blue LED (Vf ≈ 3 V) behind 1 kΩ from a 3.3 V pin: a fraction of a milliamp
    const on = b.k.observables('board.led').current as number;
    expect(on).toBeGreaterThan(0.0002);
    expect(on).toBeLessThan(0.002);
    b.k.advanceTo(1.2 * S);
    expect(b.k.observables('board.led').current as number).toBeLessThan(1e-6);
  });

  it('lesson 02 debounces a bouncing BOOT button and toggles the LED', async () => {
    const b = await boardWith('lesson02');
    if (!b) return;
    b.k.advanceTo(1.2 * S);
    b.k.press('board.boot');
    b.k.advanceTo(1.2 * S + 150 * MS);
    b.k.release('board.boot');
    b.k.advanceTo(1.6 * S);
    expect(b.mcu.halted).toBeNull();
    expect(b.serial()).toContain('Press #1 -> LED ON');
    expect(b.serial()).not.toContain('Press #2');
    expect(b.k.observables('board.led').current as number).toBeGreaterThan(0.0002);
  });

  it('holding EN keeps the chip in reset (pads let go); releasing it reboots the firmware', async () => {
    const b = await boardWith('lesson01');
    if (!b) return;
    b.k.advanceTo(1.05 * S);
    expect(b.k.observables('board.led').current as number).toBeGreaterThan(0.0002);
    // EN pulled to GND through the button: chip in reset, GPIO2 high-impedance, LED dark
    b.k.press('board.en');
    b.k.advanceTo(1.06 * S);
    expect(b.k.observables('mcu.GPIO2').output).toBe('z');
    expect(b.k.observables('board.led').current as number).toBeLessThan(1e-6);
    b.k.advanceTo(1.3 * S);
    expect(b.k.observables('board.led').current as number).toBeLessThan(1e-6);
    b.k.release('board.en');
    b.k.advanceTo(1.31 * S);
    expect(b.mcu.resets).toBeGreaterThan(0);
    // Boots again: banner a second time, LED on again after setup's delay(1000)
    b.k.advanceTo(2.0 * S);
    expect(b.k.observables('board.led').current as number).toBeLessThan(1e-6);
    b.k.advanceTo(2.36 * S);
    expect(b.serial().split('=== Hello ESP32! ===').length - 1).toBe(2);
    expect(b.k.observables('board.led').current as number).toBeGreaterThan(0.0002);
  });
});
