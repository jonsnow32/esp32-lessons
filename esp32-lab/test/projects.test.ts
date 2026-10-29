// Featured projects: each circuit is sound (every part plugged in, no shorted legs, nothing
// loose), and its sketch, built by scripts/build-projects.sh, does what the card promises on
// the emulated ESP32 wired to that circuit. Firmware checks are skipped when the builds or the
// WASM module are missing.

import { explain } from '@esp32lab/explain';
import { ESP32_PADS, Esp32Wasm, type Firmware } from '@esp32lab/mcu-esp32';
import { MS, S } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOARD, BREADBOARDS, PARTS } from './helpers';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const wasmPath = root('packages/mcu-esp32/wasm/esp32.wasm');
const IDS = readdirSync(root('projects'));
const projectOf = (id: string) => JSON.parse(readFileSync(root(`projects/${id}/project.json`), 'utf8')).project as Project;
const manifests = Object.fromEntries(Object.entries(PARTS).map(([k, m]) => [k, m.manifest]));

function firmware(id: string): Firmware | null {
  const dir = root(`.build/projects/${id}/.pio/build/${id}`);
  if (!existsSync(`${dir}/firmware.elf`)) return null;
  const read = (f: string) => (existsSync(`${dir}/${f}`) ? new Uint8Array(readFileSync(`${dir}/${f}`)) : undefined);
  return { elf: read('firmware.elf')!, bin: read('firmware.bin')!, bootloader: read('bootloader.bin'), partitions: read('partitions.bin') };
}

async function boot(id: string) {
  const fw = firmware(id);
  if (!fw || !existsSync(wasmPath)) return null;
  const wasm = await Esp32Wasm.load(readFileSync(wasmPath));
  const mcu = wasm.boot(fw);
  let serial = '';
  mcu.onSerial((_port, bytes) => (serial += new TextDecoder().decode(bytes)));
  const project = projectOf(id);
  const make = (p: Project, startTime = 0) => new SimKernel({ project: p, board: BOARD, breadboards: BREADBOARDS, parts: PARTS, mcu, startTime });
  const b = { k: make(project), mcu, project, serial: () => serial };
  /** Change a prop the way the app does: rebuild the circuit around the running chip. */
  const setProp = (part: string, key: string, value: number | string | boolean) => {
    const p = b.project.parts.find((x) => x.id === part)!;
    p.props = { ...p.props, [key]: value };
    b.k = make(b.project, b.k.now);
    b.k.solve();
  };
  /** Hold a button for `ms`, then let go. */
  const tap = (part: string, ms = 150) => {
    b.k.press(part);
    b.k.advanceTo(b.k.now + ms * MS);
    b.k.release(part);
  };
  return Object.assign(b, { setProp, tap });
}

const lit = (k: SimKernel, id: string) => Number(k.observables(id).current ?? 0) > 0.001;

describe('featured project circuits', () => {
  it.each(IDS)('%s: every part plugged in, nothing shorted or loose', (id) => {
    const p = projectOf(id);
    const k = new SimKernel({ project: p, board: BOARD, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });
    k.solve();
    const ids = p.parts.map((x) => x.id);
    expect(new Set(ids).size, 'part ids are unique').toBe(ids.length);
    expect(k.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const notes = explain({ kernel: k, project: p, board: BOARD, pads: ESP32_PADS, manifests }).map((n) => n.text);
    expect(notes.filter((t) => t.includes('nối tắt') || t.includes('chưa nối vào mạch')), notes.join('\n')).toEqual([]);
    expect(existsSync(root(`projects/${id}/main.cpp`))).toBe(true);
  });
});

describe.skipIf(!existsSync(wasmPath))('featured projects on the emulated ESP32', () => {
  it('traffic-light cycles green → yellow → red', async () => {
    const b = await boot('traffic-light');
    if (!b) return;
    b.k.advanceTo(1 * S);
    expect([lit(b.k, 'led3'), lit(b.k, 'led2'), lit(b.k, 'led1')]).toEqual([true, false, false]);
    b.k.advanceTo(4.8 * S);
    expect([lit(b.k, 'led3'), lit(b.k, 'led2'), lit(b.k, 'led1')]).toEqual([false, true, false]);
    b.k.advanceTo(6.5 * S);
    expect([lit(b.k, 'led3'), lit(b.k, 'led2'), lit(b.k, 'led1')]).toEqual([false, false, true]);
    expect(b.serial()).toContain('Den VANG - cham lai');
    expect(b.mcu.halted).toBeNull();
  });

  it('rgb-colors mixes the colours', async () => {
    const b = await boot('rgb-colors');
    if (!b) return;
    const rgb = () => ['red', 'green', 'blue'].map((c) => Number(b.k.observables('rgb1')[c]) > 0.02);
    b.k.advanceTo(0.5 * S);
    expect(rgb()).toEqual([true, false, false]);
    b.k.advanceTo(1.3 * S);
    expect(rgb()).toEqual([false, true, false]);
    b.k.advanceTo(2.9 * S); // 4th colour: yellow = red + green
    expect(rgb()).toEqual([true, true, false]);
    b.k.advanceTo(5.3 * S); // 7th: white
    expect(rgb()).toEqual([true, true, true]);
    expect(b.serial()).toContain('Mau: Trang');
  });

  it('doorbell rings once per press, bouncing contacts and all', async () => {
    const b = await boot('doorbell');
    if (!b) return;
    b.k.advanceTo(1 * S);
    expect(b.k.observables('bz1').sounding).toBe(false);
    b.tap('btn1');
    b.k.advanceTo(b.k.now + 20 * MS); // ~170 ms after the press: first beep
    expect(b.k.observables('bz1').sounding).toBe(true);
    b.k.advanceTo(2 * S);
    expect(b.k.observables('bz1').sounding).toBe(false);
    b.tap('btn1');
    b.k.advanceTo(3 * S);
    expect(b.serial()).toContain('Ding dong! (lan 2)');
    expect(b.serial()).not.toContain('lan 3');
  });

  it('night-light turns the LED on in the dark and off in the light', async () => {
    const b = await boot('night-light');
    if (!b) return;
    b.k.advanceTo(1 * S);
    expect(lit(b.k, 'led1')).toBe(false);
    b.setProp('ldr1', 'light', 1);
    b.k.advanceTo(b.k.now + 200 * MS);
    expect(lit(b.k, 'led1')).toBe(true);
    b.setProp('ldr1', 'light', 1000);
    b.k.advanceTo(b.k.now + 200 * MS);
    expect(lit(b.k, 'led1')).toBe(false);
    expect(b.serial()).toContain('Troi toi -> bat den');
  });

  it('thermometer reads the NTC through the ADC', async () => {
    const b = await boot('thermometer');
    if (!b) return;
    /** Last temperature the sketch printed. */
    const celsius = () => Number([...b.serial().matchAll(/\| +(-?[\d.]+) C/g)].at(-1)?.[1]);
    b.k.advanceTo(1.2 * S);
    expect(celsius()).toBeCloseTo(25, 0);
    expect(lit(b.k, 'led1')).toBe(false);
    b.setProp('ntc1', 'temperature', 50);
    b.k.advanceTo(b.k.now + 600 * MS);
    expect(Math.abs(celsius() - 50)).toBeLessThan(1.5);
    expect(lit(b.k, 'led1')).toBe(true);
    b.setProp('ntc1', 'temperature', 5);
    b.k.advanceTo(b.k.now + 600 * MS);
    expect(Math.abs(celsius() - 5)).toBeLessThan(1.5);
    expect(lit(b.k, 'led1')).toBe(false);
  });

  it('mode-switch blinks slow or fast with the lever', async () => {
    const b = await boot('mode-switch');
    if (!b) return;
    const edges = (seconds: number) => {
      let n = 0;
      let was = lit(b.k, 'led1');
      const end = b.k.now + seconds * S;
      while (b.k.now < end) {
        b.k.advanceTo(b.k.now + 10 * MS);
        if (lit(b.k, 'led1') !== was) (n++, (was = !was));
      }
      return n;
    };
    b.k.advanceTo(0.5 * S);
    expect(edges(2)).toBeLessThanOrEqual(5); // 500 ms
    b.setProp('sw1', 'position', 'b');
    expect(edges(2)).toBeGreaterThanOrEqual(18); // 100 ms
    expect(b.serial()).toContain('Che do: NHANH');
  });

  it('reaction-game measures the time from LED to press', async () => {
    const b = await boot('reaction-game');
    if (!b) return;
    b.k.advanceTo(1 * S);
    b.tap('btn1', 100);
    expect(b.serial()).toContain('San sang');
    const deadline = b.k.now + 5 * S;
    while (!lit(b.k, 'led1') && b.k.now < deadline) b.k.advanceTo(b.k.now + 10 * MS);
    expect(lit(b.k, 'led1')).toBe(true);
    b.k.advanceTo(b.k.now + 250 * MS);
    b.tap('btn1', 100);
    b.k.advanceTo(b.k.now + 100 * MS);
    expect(b.serial()).toMatch(/Phan xa: (2[5-9]\d) ms/);
    expect(lit(b.k, 'led1')).toBe(false);
  });

  it('seven-segment-counter counts up once a second and starts over on a press', async () => {
    const b = await boot('seven-segment-counter');
    if (!b) return;
    const digit = () => b.k.observables('disp1').digit;
    b.k.advanceTo(0.5 * S);
    expect(digit()).toBe(0);
    b.k.advanceTo(3.7 * S);
    expect(digit()).toBe(3);
    b.tap('btn1');
    b.k.advanceTo(b.k.now + 50 * MS);
    expect(digit()).toBe(0);
    expect(b.serial()).toContain('Dem lai tu 0');
  });

  it('keypad-lock opens on 1234# and refuses a wrong code', async () => {
    const b = await boot('keypad-lock');
    if (!b) return;
    const type = (keys: string) => {
      for (const key of keys) {
        b.k.press('kp1', key);
        b.k.advanceTo(b.k.now + 80 * MS);
        b.k.release('kp1', key);
        b.k.advanceTo(b.k.now + 80 * MS);
      }
    };
    b.k.advanceTo(0.5 * S);
    type('1234#');
    expect(lit(b.k, 'led1')).toBe(true);
    expect(lit(b.k, 'led2')).toBe(false);
    expect(b.serial()).toContain('Mo khoa!');
    b.k.advanceTo(b.k.now + 3.2 * S);
    expect(lit(b.k, 'led1')).toBe(false);
    type('99#');
    expect(lit(b.k, 'led2')).toBe(true);
    expect(b.serial()).toContain('Sai ma');
  });

  it('relay-lamp toggles the lamp through the relay contacts', async () => {
    const b = await boot('relay-lamp');
    if (!b) return;
    b.k.advanceTo(0.5 * S);
    expect(lit(b.k, 'led1')).toBe(false);
    b.tap('btn1');
    b.k.advanceTo(b.k.now + 50 * MS);
    expect(b.k.observables('rl1').closed).toBe(true);
    expect(lit(b.k, 'led1')).toBe(true);
    b.tap('btn1');
    b.k.advanceTo(b.k.now + 50 * MS);
    expect(lit(b.k, 'led1')).toBe(false);
    expect(b.serial()).toContain('Relay TAT');
  });
});
