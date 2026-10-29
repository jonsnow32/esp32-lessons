import { MS, S, US } from '@esp32lab/part-sdk';
import type { PartInstance } from '@esp32lab/project-model';
import { keyOf } from '@esp32lab/sim-core';
import { dhtFrame } from '@esp32lab-parts/dht';
import { ntcResistance } from '@esp32lab-parts/thermistor';
import { echoWidth } from '@esp32lab-parts/ultrasonic';
import { describe, expect, it } from 'vitest';
import { hole, kernel, pin, project, wire } from './helpers';

const part = (id: string, type: string, at: string, props: PartInstance['props'] = {}): PartInstance => ({
  id,
  type,
  props,
  placement: { bb: 'bb1', hole: at, rot: 0 },
});

/** HIGH pulses on a pad as [start, width] pairs, from the logic-level edges the MCU saw. */
function highPulses(edges: { t: number; pad: string; level: 0 | 1 }[], pad: string): [number, number][] {
  const out: [number, number][] = [];
  let rise: number | undefined;
  for (const e of edges.filter((e) => e.pad === pad)) {
    if (e.level === 1) rise = e.t;
    else if (rise !== undefined) {
      out.push([rise, e.t - rise]);
      rise = undefined;
    }
  }
  return out;
}

describe('thermistor', () => {
  it('follows the B3950 curve', () => {
    expect(ntcResistance(25)).toBeCloseTo(10_000, 0);
    expect(ntcResistance(0) / 1000).toBeCloseTo(33.6, 0);
    expect(ntcResistance(100)).toBeLessThan(1_000);
  });

  // 3V3 → NTC (col 5–6) → divider point col 6 → 10 kΩ (col 6–10) → GND
  it('reads higher the hotter it gets', () => {
    const at = (temperature: number) => {
      const { k } = kernel(
        project(
          [part('ntc1', 'thermistor', 'a5', { temperature }), part('r1', 'resistor', 'b6', { resistance: 10_000 })],
          [wire('w1', pin('3V3'), hole('e5')), wire('w2', hole('e10'), pin('GND.R'))],
        ),
      );
      k.solve();
      return k.voltage(keyOf.hole('bb1', 'c6'));
    };
    expect(at(25)).toBeCloseTo(1.65, 1);
    expect(at(60)).toBeGreaterThan(at(25));
    expect(at(0)).toBeLessThan(at(25));
  });
});

describe('tilt switch', () => {
  // GPIO4 with pull-up → switch → GND
  const reading = (tilted: boolean) => {
    const { k, mcu } = kernel(
      project([part('t1', 'tilt-switch', 'a5', { tilted })], [wire('w1', pin('D4'), hole('e5')), wire('w2', hole('e6'), pin('GND.R'))]),
      (m) => m.set('GPIO4', { pull: 'up' }, 0),
    );
    k.advanceTo(1 * MS);
    return mcu.read('GPIO4');
  };
  it('reads LOW upright and HIGH tilted', () => {
    expect(reading(false)).toBe(0);
    expect(reading(true)).toBe(1);
  });
});

describe('PIR sensor', () => {
  const circuit = (supply: string) =>
    project([part('pir1', 'pir-sensor', 'a5', { hold: 3 })], [
      wire('w1', pin(supply), hole('e5')),
      wire('w2', pin('D4'), hole('e6')),
      wire('w3', hole('e7'), pin('GND.R')),
    ]);

  it('goes HIGH on motion and holds for the set time', () => {
    const { k, mcu } = kernel(circuit('VIN'));
    k.advanceTo(10 * MS);
    expect(mcu.read('GPIO4')).toBe(0);
    k.press('pir1');
    k.advanceTo(20 * MS);
    expect(mcu.read('GPIO4')).toBe(1);
    expect(k.voltage(keyOf.pad('GPIO4'))).toBeCloseTo(3.3, 1);
    k.release('pir1');
    k.advanceTo(20 * MS + 2.9 * S);
    expect(mcu.read('GPIO4')).toBe(1);
    k.advanceTo(20 * MS + 3.1 * S);
    expect(mcu.read('GPIO4')).toBe(0);
  });

  it('does nothing on 3.3 V', () => {
    const { k } = kernel(circuit('3V3'));
    k.advanceTo(1 * MS);
    k.press('pir1');
    k.advanceTo(2 * MS);
    expect(k.observables('pir1').powered).toBe(false);
    expect(k.observables('pir1').output).toBe(false);
  });
});

describe('HC-SR04', () => {
  // VCC col 10, Trig col 11 (GPIO5), Echo col 12 (GPIO18), GND col 13
  const circuit = (distance: number) =>
    project([part('us1', 'ultrasonic', 'a10', { distance })], [
      wire('w1', pin('VIN'), hole('e10')),
      wire('w2', pin('D5'), hole('e11')),
      wire('w3', pin('D18'), hole('e12')),
      wire('w4', hole('e13'), pin('GND.R')),
    ]);
  const measure = (distance: number, trigWidth = 10 * US) => {
    const { k, mcu } = kernel(circuit(distance), (m) =>
      m.set('GPIO5', { output: 'low' }, 0).set('GPIO5', { output: 'high' }, 1 * MS).set('GPIO5', { output: 'low' }, 1 * MS + trigWidth),
    );
    k.advanceTo(60 * MS);
    return highPulses(mcu.edges, 'GPIO18');
  };

  it('answers a 10 µs trigger with an echo as long as the round trip', () => {
    const pulses = measure(50);
    expect(pulses).toHaveLength(1);
    const [start, width] = pulses[0]!;
    expect(start).toBeGreaterThan(1 * MS + 10 * US);
    expect(width).toBe(echoWidth(50));
    expect(width / US / 58).toBeCloseTo(50, 0);
  });

  it('times out at 38 ms with nothing in range', () => {
    expect(measure(450)[0]![1]).toBe(38 * MS);
  });

  it('ignores a trigger shorter than 10 µs', () => {
    expect(measure(50, 3 * US)).toHaveLength(0);
  });
});

describe('DHT', () => {
  it('encodes readings and checksum', () => {
    expect(dhtFrame('DHT11', 28, 65)).toEqual([65, 0, 28, 0, 93]);
    // 55.2 % → 552 = 0x0228, −12.3 °C → 123 | sign = 0x807B
    expect(dhtFrame('DHT22', -12.3, 55.2)).toEqual([0x02, 0x28, 0x80, 0x7b, (0x02 + 0x28 + 0x80 + 0x7b) & 0xff]);
    // DHT11 clamps to its range
    expect(dhtFrame('DHT11', 70, 5).slice(0, 4)).toEqual([20, 0, 50, 0]);
  });

  // VCC col 20 (3V3), DATA col 21 (GPIO4 with pull-up), GND col 23
  const read = (model: string, startLow: number) => {
    const { k, mcu } = kernel(
      project([part('dht1', 'dht', 'a20', { model, temperature: 23.4, humidity: 55.2 })], [
        wire('w1', pin('3V3'), hole('e20')),
        wire('w2', pin('D4'), hole('e21')),
        wire('w3', hole('e23'), pin('GND.R')),
      ]),
      (m) => m.set('GPIO4', { pull: 'up' }, 0).set('GPIO4', { output: 'low' }, 1 * MS).set('GPIO4', { output: 'z' }, 1 * MS + startLow),
    );
    k.advanceTo(40 * MS);
    // Skip everything up to the 80 µs response HIGH, then each HIGH is one bit
    const pulses = highPulses(mcu.edges, 'GPIO4').map(([, w]) => w);
    const response = pulses.findIndex((w) => w > 75 * US);
    const bits = pulses.slice(response + 1, response + 41).map((w) => (w > 50 * US ? 1 : 0));
    const bytes = [0, 1, 2, 3, 4].map((b) => bits.slice(b * 8, b * 8 + 8).reduce((a: number, x) => a * 2 + x, 0));
    return { bytes, bits: bits.length, response };
  };

  it('answers a DHT22 start signal with the 40-bit frame', () => {
    const r = read('DHT22', 1.1 * MS);
    expect(r.bits).toBe(40);
    expect(r.bytes).toEqual(dhtFrame('DHT22', 23.4, 55.2));
  });

  it('needs an 18 ms start signal on a DHT11', () => {
    expect(read('DHT11', 1.1 * MS).response).toBe(-1);
    expect(read('DHT11', 20 * MS).bytes).toEqual(dhtFrame('DHT11', 23.4, 55.2));
  });
});
