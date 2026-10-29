import { MS } from '@esp32lab/part-sdk';
import type { PartInstance } from '@esp32lab/project-model';
import type { I2cOp, ScriptedMcu } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { hole, kernel, pin, project, wire } from './helpers';

const part = (id: string, type: string, at: string, props: PartInstance['props'] = {}): PartInstance => ({
  id,
  type,
  props,
  placement: { bb: 'bb1', hole: at, rot: 0 },
});

/** One transfer to `addr`: START, address + bytes (ACK checked), STOP. */
const send = (mcu: ScriptedMcu, addr: number, bytes: number[]) =>
  mcu.i2c([{ kind: 'start' }, { kind: 'write', bytes: [addr << 1, ...bytes], ackCheck: true, ackExp: false }, { kind: 'stop' }]);

/** What LiquidCrystal_I2C writes to the PCF8574 for one nibble: data + backlight, E high then low. */
const nibble = (n: number, rs: boolean) => {
  const p = (n << 4) | 0x08 | (rs ? 1 : 0);
  return [p | 0x04, p];
};
const byte = (b: number, rs = false) => [...nibble(b >> 4, rs), ...nibble(b & 15, rs)];
const text = (s: string) => [...s].flatMap((c) => byte(c.charCodeAt(0), true));

describe('LCD 1602 over I2C', () => {
  // GND a5, VCC a6 (VIN), SDA a7 (GPIO21), SCL a8 (GPIO22)
  const setup = (supply = 'VIN', props: PartInstance['props'] = {}, swap = false) => {
    const { k, mcu } = kernel(
      project([part('lcd', 'lcd1602', 'a5', props)], [
        wire('w1', hole('e5'), pin('GND.R')),
        wire('w2', pin(supply), hole('e6')),
        wire('w3', pin(swap ? 'D22' : 'D21'), hole('e7')),
        wire('w4', pin(swap ? 'D21' : 'D22'), hole('e8')),
      ]),
    );
    k.advanceTo(1 * MS);
    return { k, mcu };
  };
  const init = [...nibble(3, false), ...nibble(3, false), ...nibble(3, false), ...nibble(2, false), ...byte(0x28), ...byte(0x0c), ...byte(0x01), ...byte(0x06)];

  it('shows text after the 4-bit init sequence, on both lines', () => {
    const { k, mcu } = setup();
    expect(send(mcu, 0x27, init).acks.every(Boolean)).toBe(true);
    send(mcu, 0x27, [...text('Xin chao'), ...byte(0x80 | 0x40), ...text('ESP32 lab')]);
    expect(k.observables('lcd')).toMatchObject({ line1: 'Xin chao        ', line2: 'ESP32 lab       ', display: true, backlight: true });
    expect(k.observables('lcd').contrast).toBe(1);
  });

  it('draws custom characters from CGRAM', () => {
    const { k, mcu } = setup();
    send(mcu, 0x27, [...init, ...byte(0x40), ...[0x0e, 0x11, 0x11, 0x0e, 0, 0, 0, 0].flatMap((r) => byte(r, true)), ...byte(0x80), ...byte(0, true)]);
    expect(k.observables('lcd').line1).toMatch(/^#/);
    expect(String(k.observables('lcd').cgram).slice(0, 8)).toBe('0e11110e');
  });

  it('keeps what it shows when the circuit is rebuilt around the running chip', async () => {
    const { SimKernel } = await import('@esp32lab/sim-core');
    const { BOARD, BREADBOARDS, PARTS } = await import('./helpers');
    const { k, mcu } = setup();
    send(mcu, 0x27, [...init, ...text('Van con day')]);
    const p = project([part('lcd', 'lcd1602', 'a5')], [
      wire('w1', hole('e5'), pin('GND.R')),
      wire('w2', pin('VIN'), hole('e6')),
      wire('w3', pin('D21'), hole('e7')),
      wire('w4', pin('D22'), hole('e8')),
    ]);
    const next = new SimKernel({ project: p, board: BOARD, breadboards: BREADBOARDS, parts: PARTS, mcu, startTime: k.now, carry: k.carryState() });
    next.advanceTo(k.now + 1 * MS);
    expect(next.observables('lcd').line1).toBe('Van con day     ');
    // Still in 4-bit mode: the next character lands right after
    send(mcu, 0x27, text('!'));
    expect(next.observables('lcd').line1).toBe('Van con day!    ');
  });

  it('is faint on 3.3 V', () => {
    const { k, mcu } = setup('3V3');
    send(mcu, 0x27, init);
    expect(k.observables('lcd').contrast as number).toBeLessThan(0.6);
  });

  it('NACKs the wrong address, and nothing answers with SDA and SCL swapped', () => {
    const { k, mcu } = setup('VIN', { address: '0x3F' });
    expect(send(mcu, 0x27, [1]).acks).toEqual([false, false]);
    expect(send(mcu, 0x3f, [1]).acks[0]).toBe(true);
    expect(k.i2cActivity.get(0)?.addressed.map((a) => a.acked)).toEqual([false, true]);
    const swapped = setup('VIN', {}, true);
    expect(send(swapped.mcu, 0x27, [1]).acks[0]).toBe(false);
  });

  it('explains who answered on the bus', async () => {
    const { explain } = await import('@esp32lab/explain');
    const { ESP32_PADS } = await import('@esp32lab/mcu-esp32');
    const { BOARD, PARTS } = await import('./helpers');
    const manifests = Object.fromEntries(Object.entries(PARTS).map(([t, m]) => [t, m.manifest]));
    const notes = (k: ReturnType<typeof setup>['k'], p: ReturnType<typeof project>) =>
      explain({ kernel: k, project: p, board: BOARD, pads: ESP32_PADS, manifests }).map((n) => n.text).join('\n');
    const { k, mcu } = setup('VIN', { address: '0x3F' });
    const p = project([part('lcd', 'lcd1602', 'a5', { address: '0x3F' })]);
    send(mcu, 0x27, [1]);
    expect(notes(k, p)).toContain('ESP32 gọi địa chỉ 0x27 trên bus I2C (SDA D21, SCL D22) nhưng không thiết bị nào trả lời');
    send(mcu, 0x3f, [1]);
    send(mcu, 0x3f, [1]);
    expect(notes(k, p)).not.toContain('ESP32 gọi địa chỉ 0x3F');
  });

  it('a bus without pull-ups reads nothing', () => {
    // The module's pull-ups go to its own VCC: unpowered, SDA and SCL sit at 0 V
    const { k, mcu } = kernel(
      project([part('lcd', 'lcd1602', 'a5')], [wire('w1', hole('e5'), pin('GND.R')), wire('w3', pin('D21'), hole('e7')), wire('w4', pin('D22'), hole('e8'))]),
    );
    k.advanceTo(1 * MS);
    expect(send(mcu, 0x27, [1]).acks[0]).toBe(false);
    expect(k.i2cActivity.get(0)?.fault).toBe('no-pull-up');
  });
});

describe('SSD1306 OLED', () => {
  // GND a5, VCC a6 (3V3), SCL a7 (GPIO22), SDA a8 (GPIO21)
  const setup = () => {
    const { k, mcu } = kernel(
      project([part('oled', 'ssd1306', 'a5')], [
        wire('w1', hole('e5'), pin('GND.R')),
        wire('w2', pin('3V3'), hole('e6')),
        wire('w3', pin('D22'), hole('e7')),
        wire('w4', pin('D21'), hole('e8')),
      ]),
    );
    k.advanceTo(1 * MS);
    return { k, mcu };
  };
  // Adafruit_SSD1306::begin, then display(): whole frame in horizontal mode
  const init = [0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40, 0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12, 0x81, 0xcf, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0x2e, 0xaf];
  const pixel = (frameB64: string, x: number, y: number) => (atob(frameB64).charCodeAt(y * 16 + (x >> 3)) >> (7 - (x & 7))) & 1;

  it('draws the frame buffer upright', () => {
    const { k, mcu } = setup();
    send(mcu, 0x3c, [0x00, ...init]);
    send(mcu, 0x3c, [0x00, 0x22, 0, 0xff, 0x21, 0, 127]);
    // A full frame, sent in 32-byte chunks as Wire does; only (5, 10) lit: page 1, bit 2
    const ram = new Array(1024).fill(0);
    ram[128 + 5] = 1 << 2;
    for (let i = 0; i < 1024; i += 32) send(mcu, 0x3c, [0x40, ...ram.slice(i, i + 32)]);
    const o = k.observables('oled');
    expect(o).toMatchObject({ on: true, pixels: 1 });
    expect(pixel(String(o.frame), 5, 10)).toBe(1);
    expect(pixel(String(o.frame), 122, 53)).toBe(0);
  });

  it('stays dark until the charge pump is on', () => {
    const { k, mcu } = setup();
    send(mcu, 0x3c, [0x00, 0xa5, 0xaf]);
    expect(k.observables('oled')).toMatchObject({ on: false, pixels: 0 });
    // Contrast sent as two single-command transfers, as Adafruit's dim() does
    send(mcu, 0x3c, [0x80, 0x8d]);
    send(mcu, 0x3c, [0x80, 0x14]);
    expect(k.observables('oled')).toMatchObject({ on: true, pixels: 128 * 64 });
  });

  it('answers reads with its status byte', () => {
    const { mcu } = setup();
    const ops: I2cOp[] = [{ kind: 'start' }, { kind: 'write', bytes: [(0x3c << 1) | 1], ackCheck: true, ackExp: false }, { kind: 'read', len: 1, nack: true }, { kind: 'stop' }];
    expect(mcu.i2c(ops).data).toEqual([0x40]);
  });
});
