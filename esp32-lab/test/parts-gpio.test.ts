import { MS, US, type SimTime } from '@esp32lab/part-sdk';
import type { PartInstance } from '@esp32lab/project-model';
import { keyOf, type ScriptedMcu } from '@esp32lab/sim-core';
import { crc8, encodeTemperature } from '@esp32lab-parts/ds18b20';
import { describe, expect, it } from 'vitest';
import { hole, kernel, pin, project, wire } from './helpers';

const part = (id: string, type: string, at: string, props: PartInstance['props'] = {}): PartInstance => ({
  id,
  type,
  props,
  placement: { bb: 'bb1', hole: at, rot: 0 },
});
const resistor = (id: string, at: string, resistance = 220) => part(id, 'resistor', at, { resistance });
const volts = (k: ReturnType<typeof kernel>['k'], h: string) => k.voltage(keyOf.hole('bb1', h));

/** Logic level of a pad at time t, from the edges the MCU saw (HIGH before the first edge). */
function levelAt(mcu: ScriptedMcu, pad: string, t: SimTime): 0 | 1 {
  let level: 0 | 1 = 1;
  for (const e of mcu.edges) if (e.pad === pad && e.t <= t) level = e.level;
  return level;
}

describe('seven-segment display', () => {
  // Top row c10–c14 (g f com a b), bottom row g10–g14 (e d com c dp)
  const digitOne = (common: 'cathode' | 'anode', level: 'high' | 'low') => {
    const { k } = kernel(
      project(
        [part('d1', 'seven-segment', 'c10', { common }), resistor('rb', 'a14'), resistor('rc', 'j13')],
        [
          wire('wc', hole('a12'), common === 'cathode' ? pin('GND.R') : pin('3V3')),
          wire('wb', pin('D4'), hole('e18')),
          wire('wcc', pin('D2'), hole('f17')),
        ],
      ),
      (m) => m.set('GPIO4', { output: level }, 0).set('GPIO2', { output: level }, 0),
    );
    k.advanceTo(1 * US);
    return k.observables('d1');
  };

  it('lights b and c to show 1 on a common cathode with HIGH pins', () => {
    const o = digitOne('cathode', 'high');
    expect(o.b).toBeGreaterThan(0.3);
    expect(o.c).toBeGreaterThan(0.3);
    expect(o.a).toBeLessThan(0.01);
    expect(o.digit).toBe(1);
  });

  it('needs LOW pins on a common anode', () => {
    expect(digitOne('anode', 'low').digit).toBe(1);
    expect(digitOne('anode', 'high').b).toBeLessThan(0.01);
  });
});

describe('LED bar', () => {
  // Anodes e5–e14, cathodes f5–f14; bar 1 via 220 Ω from GPIO4, all cathodes' columns grounded
  it('lights only the driven bar', () => {
    const { k } = kernel(
      project([part('bar', 'led-bar', 'e5'), resistor('r1', 'a5')], [wire('w1', pin('D4'), hole('a9')), wire('w2', hole('j5'), pin('GND.R')), wire('w3', hole('j6'), pin('GND.R'))]),
      (m) => m.set('GPIO4', { output: 'high' }, 0),
    );
    k.advanceTo(1 * US);
    const o = k.observables('bar');
    expect(o.bar0).toBeGreaterThan(0.3);
    expect(o.bar1).toBeLessThan(0.01);
    expect(o.lit).toBe(1);
  });
});

describe('relay module', () => {
  // IN a5, VCC a6, GND a7, NO a10, COM a12, NC a14
  const run = (trigger: 'high' | 'low', level: 'high' | 'low', supply = 'VIN') => {
    const { k } = kernel(
      project([part('rl', 'relay', 'a5', { trigger })], [wire('w1', pin('D4'), hole('e5')), wire('w2', pin(supply), hole('e6')), wire('w3', hole('e7'), pin('GND.R'))]),
      (m) => m.set('GPIO4', { output: level }, 1 * MS),
    );
    k.advanceTo(30 * MS);
    return k.observables('rl');
  };

  it('pulls in a few ms after IN goes HIGH', () => {
    const o = run('high', 'high');
    expect(o.energized).toBe(true);
    expect(o.closed).toBe(true);
    expect(o.clicks).toBe(1);
    expect(run('high', 'low').closed).toBe(false);
  });

  it('a low-trigger module closes on LOW and lets go at 3.3 V', () => {
    expect(run('low', 'low').closed).toBe(true);
    expect(run('low', 'high').closed).toBe(false);
  });

  it('cannot pull in from 3V3', () => {
    const o = run('high', 'high', '3V3');
    expect(o.driven).toBe(true);
    expect(o.closed).toBe(false);
  });

  it('switches COM between NC and NO', () => {
    // COM on 3V3; NO (col 10) loaded with 1 kΩ to GND through the lower half (f10–f14)
    const { k, mcu } = kernel(
      project([part('rl', 'relay', 'a5'), resistor('load', 'f10', 1000)], [
        wire('w1', pin('D4'), hole('e5')),
        wire('w2', pin('VIN'), hole('e6')),
        wire('w3', hole('e7'), pin('GND.R')),
        wire('w4', pin('3V3'), hole('e12')),
        wire('w5', hole('e10'), hole('j10')),
        wire('w6', hole('j14'), pin('GND.R')),
      ]),
    );
    mcu.set('GPIO4', { output: 'low' }, 0);
    k.advanceTo(5 * MS);
    expect(volts(k, 'c10')).toBeLessThan(0.1);
    expect(volts(k, 'c14')).toBeGreaterThan(3.2);
    mcu.set('GPIO4', { output: 'high' }, 6 * MS);
    k.advanceTo(30 * MS);
    expect(volts(k, 'c10')).toBeGreaterThan(3.2);
  });
});

describe('water pump and soil moisture', () => {
  // Relay IN a5, VCC a6, GND a7, NO a10, COM a12 (on VIN); pump + h10 (from NO via e10–f10), − h11;
  // soil probe GND a20, VCC a21, AOUT a22
  const bench = (soil: PartInstance['props'], level: 'high' | 'low' = 'high') =>
    kernel(
      project([part('rl', 'relay', 'a5'), part('pump', 'water-pump', 'h10'), part('s', 'soil-moisture', 'a20', soil)], [
        wire('w1', pin('D4'), hole('e5')),
        wire('w2', pin('VIN'), hole('e6')),
        wire('w3', hole('e7'), pin('GND.R')),
        wire('w4', pin('VIN'), hole('e12')),
        wire('w5', hole('e10'), hole('f10')),
        wire('w6', hole('j11'), pin('GND.R')),
        wire('w7', hole('e20'), pin('GND.L')),
        wire('w8', pin('3V3'), hole('e21')),
      ]),
      (m) => m.set('GPIO4', { output: level }, 1 * MS),
    ).k;

  it('runs from 5 V through the relay at about 180 mA', () => {
    const k = bench({ moisture: 20 });
    k.advanceTo(50 * MS);
    const o = k.observables('pump');
    expect(o.running).toBe(true);
    expect(Number(o.current)).toBeGreaterThan(0.15);
    expect(Number(o.current)).toBeLessThan(0.21);
    expect(bench({ moisture: 20 }, 'low').observables('pump').running).toBe(false);
  });

  it('wets the soil while it pumps and the probe reads it', () => {
    const k = bench({ moisture: 20 });
    k.solve();
    const before = volts(k, 'c22');
    k.advanceTo(2000 * MS);
    const m = Number(k.observables('s').moisture);
    expect(m).toBeGreaterThan(30);
    expect(m).toBeLessThan(40);
    expect(volts(k, 'c22')).toBeLessThan(before - 0.1);
  });

  it('dries out by dryRate, and stays put without it', () => {
    const dry = bench({ moisture: 50, dryRate: 2 }, 'low');
    dry.advanceTo(2000 * MS);
    expect(Number(dry.observables('s').moisture)).toBeCloseTo(46, 0);
    const still = bench({ moisture: 50 }, 'low');
    still.advanceTo(2000 * MS);
    expect(still.observables('s').moisture).toBe(50);
  });
});

describe('4×4 keypad', () => {
  // R1–R4 a5–a8, C1–C4 a9–a12; R2 driven LOW, C2 read with a pull-up
  it('joins row 2 and column 2 while 5 is held', () => {
    const { k } = kernel(
      project([part('kp', 'keypad', 'a5')], [wire('w1', pin('D4'), hole('e6')), wire('w2', pin('D5'), hole('e10'))]),
      (m) => m.set('GPIO4', { output: 'low' }, 0).set('GPIO5', { pull: 'up' }, 0),
    );
    k.advanceTo(1 * US);
    expect(volts(k, 'c10')).toBeGreaterThan(3);
    k.press('kp', '6');
    expect(volts(k, 'c10')).toBeGreaterThan(3);
    k.press('kp', '5');
    expect(volts(k, 'c10')).toBeLessThan(0.2);
    expect(k.observables('kp').pressed).toBe('65');
    k.release('kp', '5');
    expect(volts(k, 'c10')).toBeGreaterThan(3);
  });
});

describe('joystick', () => {
  // GND a5, +5V a6, VRx a7, VRy a8, SW a9
  it('gives a voltage per axis and grounds SW when pressed', () => {
    const { k } = kernel(
      project([part('js', 'joystick', 'a5', { x: 100, y: 25 })], [wire('w1', hole('e5'), pin('GND.R')), wire('w2', pin('3V3'), hole('e6')), wire('w3', pin('D25'), hole('e9'))]),
      (m) => m.set('GPIO25', { pull: 'up' }, 0),
    );
    k.advanceTo(1 * US);
    expect(volts(k, 'c7')).toBeGreaterThan(3.2);
    expect(volts(k, 'c8')).toBeCloseTo(3.3 * 0.25, 1);
    expect(volts(k, 'c9')).toBeGreaterThan(3);
    k.press('js');
    expect(volts(k, 'c9')).toBeLessThan(0.1);
  });
});

describe('rotary encoder', () => {
  // CLK a5 (GPIO18), DT a6 (GPIO19), SW a7, + a8, GND a9
  const turn = (key: 'cw' | 'ccw', holdFor: SimTime) => {
    const { k, mcu } = kernel(
      project([part('enc', 'rotary-encoder', 'a5')], [wire('w1', pin('D18'), hole('e5')), wire('w2', pin('D19'), hole('e6')), wire('w3', pin('3V3'), hole('e8')), wire('w4', hole('e9'), pin('GND.R'))]),
    );
    k.advanceTo(1 * MS);
    k.press('enc', key);
    k.advanceTo(1 * MS + holdFor);
    k.release('enc', key);
    k.advanceTo(1 * MS + holdFor + 200 * MS);
    return { position: k.observables('enc').position, edges: mcu.edges.filter((e) => e.pad === 'GPIO18' || e.pad === 'GPIO19') };
  };

  it('a tap turns one detent, CLK leading clockwise', () => {
    const { position, edges } = turn('cw', 1 * MS);
    expect(position).toBe(1);
    expect(edges.map((e) => `${e.pad === 'GPIO18' ? 'A' : 'B'}${e.level}`)).toEqual(['A0', 'B0', 'A1', 'B1']);
  });

  it('DT leads counter-clockwise, and holding keeps turning', () => {
    const { position, edges } = turn('ccw', 300 * MS);
    expect(position).toBe(-3);
    expect(edges[0]!.pad).toBe('GPIO19');
  });
});

describe('DS18B20', () => {
  // GND a20, DQ a21 (GPIO4, 4.7 kΩ to 3V3 from b21–b25), VDD a22
  /** A 1-Wire master as a pad script: returns the times at which to sample read slots. */
  function master(mcu: ScriptedMcu) {
    let t = 1 * MS;
    const reads: SimTime[] = [];
    const low = (at: SimTime, len: SimTime) => mcu.set('GPIO4', { output: 'low' }, at).set('GPIO4', { output: 'z' }, at + len);
    const api = {
      reset() {
        low(t, 500 * US);
        reads.push(t + 570 * US);
        t += 1 * MS;
        return api;
      },
      write(...bytes: number[]) {
        for (const b of bytes) for (let i = 0; i < 8; i++) {
          low(t, (b >> i) & 1 ? 6 * US : 60 * US);
          t += 70 * US;
        }
        return api;
      },
      writeBit(bit: number) {
        low(t, bit ? 6 * US : 60 * US);
        t += 70 * US;
        return api;
      },
      read(bits: number) {
        for (let i = 0; i < bits; i++) {
          low(t, 3 * US);
          reads.push(t + 13 * US);
          t += 70 * US;
        }
        return api;
      },
      wait(ns: SimTime) {
        t += ns;
        return api;
      },
      get end() {
        return t;
      },
      reads,
    };
    return api;
  }

  const setup = (temperature = 23.5) =>
    kernel(
      project([part('ds', 'ds18b20', 'a20', { temperature }), resistor('rpu', 'b21', 4700)], [
        wire('w1', hole('e20'), pin('GND.R')),
        wire('w2', pin('D4'), hole('e21')),
        wire('w3', pin('3V3'), hole('e22')),
        wire('w4', pin('3V3'), hole('e25')),
      ]),
    );
  const bytesOf = (bits: number[]) => Array.from({ length: bits.length / 8 }, (_, b) => bits.slice(b * 8, b * 8 + 8).reduce((a, x, i) => a | (x << i), 0));

  it('answers a reset with a presence pulse, and gives 85 °C before any conversion', () => {
    const { k, mcu } = setup();
    const m = master(mcu).reset().write(0xcc, 0xbe).read(72);
    k.advanceTo(m.end + 1 * MS);
    const [presence, ...bits] = m.reads.map((t) => levelAt(mcu, 'GPIO4', t));
    expect(presence).toBe(0);
    const pad = bytesOf(bits);
    expect(crc8(pad.slice(0, 8))).toBe(pad[8]);
    expect(pad[0]! | (pad[1]! << 8)).toBe(0x0550);
  });

  it('converts and reads back the temperature', () => {
    const { k, mcu } = setup(-10.125);
    const m = master(mcu).reset().write(0xcc, 0x44).read(1).wait(760 * MS).read(1).reset().write(0xcc, 0xbe).read(72);
    k.advanceTo(m.end + 1 * MS);
    const levels = m.reads.map((t) => levelAt(mcu, 'GPIO4', t));
    // Busy right after Convert T, done after 750 ms
    expect(levels.slice(1, 3)).toEqual([0, 1]);
    const pad = bytesOf(levels.slice(4));
    expect(crc8(pad.slice(0, 8))).toBe(pad[8]);
    expect(pad[0]! | (pad[1]! << 8)).toBe(encodeTemperature(-10.125, 12));
    expect(k.observables('ds').reading).toBe(-10.125);
  });

  it('can be found with Search ROM and selected with Match ROM', () => {
    const { k, mcu } = setup();
    const rom = String(k.observables('ds').rom).match(/../g)!.map((h) => parseInt(h, 16));
    const romBits = rom.flatMap((b) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (b >> i) & 1));
    expect(rom[0]).toBe(0x28);
    expect(crc8(rom.slice(0, 7))).toBe(rom[7]);
    const m = master(mcu).reset().write(0xf0);
    for (const bit of romBits) m.read(2).writeBit(bit);
    m.reset().write(0x55, ...rom, 0xb4).read(1);
    k.advanceTo(m.end + 1 * MS);
    const levels = m.reads.map((t) => levelAt(mcu, 'GPIO4', t));
    // Each search step: the bit, then its complement
    for (let i = 0; i < 64; i++) expect([levels[1 + i * 2], levels[2 + i * 2]]).toEqual([romBits[i], 1 - romBits[i]!]);
    // Matched, then Read Power Supply: externally powered reads 1
    expect(levels.at(-2)).toBe(0);
    expect(levels.at(-1)).toBe(1);
  });

  it('stays silent without its pull-up', () => {
    const { k, mcu } = kernel(
      project([part('ds', 'ds18b20', 'a20')], [wire('w1', hole('e20'), pin('GND.R')), wire('w2', pin('D4'), hole('e21')), wire('w3', pin('3V3'), hole('e22'))]),
    );
    const m = master(mcu).reset().write(0xcc, 0x44);
    k.advanceTo(m.end + 800 * MS);
    // Nothing ever brings DQ HIGH, so the chip never sees a slot end: no reset, no conversion
    expect(mcu.edges.filter((e) => e.pad === 'GPIO4' && e.level === 1)).toHaveLength(0);
    expect(k.observables('ds').conversions).toBe(0);
  });
});

describe('analog sensor modules', () => {
  it('soil moisture reads lower when wetter', () => {
    const at = (moisture: number) => {
      const { k } = kernel(project([part('s', 'soil-moisture', 'a5', { moisture })], [wire('w1', hole('e5'), pin('GND.R')), wire('w2', pin('3V3'), hole('e6'))]));
      k.solve();
      return volts(k, 'c7');
    };
    expect(at(0)).toBeCloseTo(3.3 * 0.82, 1);
    expect(at(100)).toBeCloseTo(3.3 * 0.36, 1);
  });

  it('MQ-2 raises AO with gas and pulls DO low past the alarm', () => {
    const at = (gas: number) => {
      const { k } = kernel(project([part('g', 'gas-sensor', 'a5', { gas, alarm: 1000 })], [wire('w1', pin('VIN'), hole('e5')), wire('w2', hole('e6'), pin('GND.R'))]));
      k.solve();
      return { ao: volts(k, 'c8'), do: volts(k, 'c7') };
    };
    const clean = at(0);
    const smoky = at(3000);
    expect(clean.ao).toBeLessThan(0.4);
    expect(smoky.ao).toBeGreaterThan(2);
    expect(clean.do).toBeGreaterThan(4);
    expect(smoky.do).toBeLessThan(0.1);
  });
});
