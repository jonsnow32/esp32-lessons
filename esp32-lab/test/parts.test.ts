import { MS } from '@esp32lab/part-sdk';
import type { PartInstance, Rotation } from '@esp32lab/project-model';
import { keyOf } from '@esp32lab/sim-core';
import { ldrResistance } from '@esp32lab-parts/photoresistor';
import { describe, expect, it } from 'vitest';
import { hole, kernel, pin, project, wire } from './helpers';

const part = (id: string, type: string, at: string, props: PartInstance['props'] = {}, rot: Rotation = 0): PartInstance => ({
  id,
  type,
  props,
  placement: { bb: 'bb1', hole: at, rot },
});
const volts = (k: ReturnType<typeof kernel>['k'], h: string) => k.voltage(keyOf.hole('bb1', h));

describe('potentiometer', () => {
  // GND → a (col 5), wiper col 6, b (col 7) → 3V3
  const divider = (position: number) =>
    project([part('pot1', 'potentiometer', 'a5', { position })], [wire('w1', pin('GND.R'), hole('e5')), wire('w2', hole('e7'), pin('3V3'))]);

  it.each([0, 25, 50, 100])('wiper follows the knob at %i %%', (position) => {
    const { k } = kernel(divider(position));
    k.solve();
    const v3 = volts(k, 'c7');
    expect(volts(k, 'c6')).toBeCloseTo((v3 * position) / 100, 1);
  });

  it('draws V/R through the track whatever the knob', () => {
    const { k } = kernel(divider(80));
    k.solve();
    expect(k.observables('pot1').current as number).toBeCloseTo(3.3 / 10_000, 4);
  });
});

describe('photoresistor', () => {
  it('follows the GL5528 curve', () => {
    expect(ldrResistance(10)).toBe(15_000);
    expect(ldrResistance(100)).toBeCloseTo(15_000 / 10 ** 0.7, 0);
    expect(ldrResistance(0)).toBe(1_000_000);
  });

  // 3V3 → LDR (col 5–6) → divider point col 6 → 10 kΩ (col 6–10) → GND
  const divider = (light: number) =>
    project(
      [part('ldr1', 'photoresistor', 'a5', { light }), part('r1', 'resistor', 'b6', { resistance: 10_000 })],
      [wire('w1', pin('3V3'), hole('e5')), wire('w2', hole('e10'), pin('GND.R'))],
    );

  it('reads higher the brighter it gets', () => {
    const at = (lux: number) => {
      const { k } = kernel(divider(lux));
      k.solve();
      return volts(k, 'c6');
    };
    expect(at(10)).toBeCloseTo(3.3 * (10 / 25), 1);
    expect(at(0)).toBeLessThan(0.05);
    expect(at(1000)).toBeGreaterThan(3);
  });
});

describe('rgb-led', () => {
  // D18 → 220 Ω (col 5–9) → red leg col 9, common col 10 → GND (or 3V3)
  const circuit = (common: 'cathode' | 'anode') =>
    project(
      [part('r1', 'resistor', 'a5', { resistance: 220 }), part('rgb1', 'rgb-led', 'b9', { common })],
      [wire('w1', pin('D18'), hole('e5')), wire('w2', hole('e10'), pin(common === 'cathode' ? 'GND.R' : '3V3'))],
    );

  it('common cathode: a HIGH colour leg lights only that colour', () => {
    const { k } = kernel(circuit('cathode'), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    k.advanceTo(1 * MS);
    const o = k.observables('rgb1');
    expect(o.red).toBeGreaterThan(0.2);
    expect(o.green).toBe(0);
    expect(o.blue).toBe(0);
    expect(o.current as number).toBeGreaterThan(0.004);
  });

  it('common anode: the colour lights when its leg goes LOW', () => {
    const high = kernel(circuit('anode'), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    high.k.advanceTo(1 * MS);
    expect(high.k.observables('rgb1').red as number).toBeLessThan(0.01);
    const low = kernel(circuit('anode'), (mcu) => mcu.set('GPIO18', { output: 'low' }));
    low.k.advanceTo(1 * MS);
    expect(low.k.observables('rgb1').red).toBeGreaterThan(0.2);
  });
});

describe('diode', () => {
  // 3V3 → diode (col 5–9) → 1 kΩ (col 9–13) → GND
  const circuit = (model: string, reversed = false) =>
    project(
      [
        reversed ? part('d1', 'diode', 'a9', { model }, 180) : part('d1', 'diode', 'a5', { model }),
        part('r1', 'resistor', 'b9', { resistance: 1000 }),
      ],
      [wire('w1', pin('3V3'), hole('e5')), wire('w2', hole('e13'), pin('GND.R'))],
    );

  it.each([
    ['1N4148', 0.6, 0.7],
    ['1N4007', 0.55, 0.7],
  ])('%s drops about 0.6 V at a few mA', (model, lo, hi) => {
    const { k } = kernel(circuit(model as string));
    k.solve();
    const drop = volts(k, 'c5') - volts(k, 'c9');
    expect(drop).toBeGreaterThan(lo as number);
    expect(drop).toBeLessThan(hi as number);
    expect(k.observables('d1').current as number).toBeCloseTo(volts(k, 'c9') / 1000, 5);
  });

  it('blocks current when reversed', () => {
    const { k } = kernel(circuit('1N4148', true));
    k.solve();
    expect(Math.abs(k.observables('d1').current as number)).toBeLessThan(1e-6);
    expect(volts(k, 'c9')).toBeLessThan(0.01);
  });
});

describe('buzzer', () => {
  // Straddling the centre gap: + in e5, − in f5. D18 → a5, j5 → GND
  const circuit = (reversed = false) =>
    project([reversed ? part('bz1', 'buzzer', 'f5', {}, 180) : part('bz1', 'buzzer', 'e5')], [
      wire('w1', pin('D18'), hole('a5')),
      wire('w2', hole('j5'), pin('GND.R')),
    ]);

  it('beeps on a HIGH GPIO and draws 10–20 mA', () => {
    const { k } = kernel(circuit(), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    k.advanceTo(1 * MS);
    const o = k.observables('bz1');
    expect(o.sounding).toBe(true);
    expect(o.current as number).toBeGreaterThan(0.01);
    expect(o.current as number).toBeLessThan(0.02);
  });

  it('is silent on LOW and when plugged in backwards', () => {
    const low = kernel(circuit(), (mcu) => mcu.set('GPIO18', { output: 'low' }));
    low.k.advanceTo(1 * MS);
    expect(low.k.observables('bz1').sounding).toBe(false);
    const back = kernel(circuit(true), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    back.k.advanceTo(1 * MS);
    expect(back.k.observables('bz1').sounding).toBe(false);
    expect(Math.abs(back.k.observables('bz1').current as number)).toBeLessThan(1e-6);
  });
});

describe('slide-switch', () => {
  // a (col 5) → 3V3, common col 6, b (col 7) → GND
  const circuit = (position: 'a' | 'b') =>
    project([part('sw1', 'slide-switch', 'a5', { position })], [wire('w1', pin('3V3'), hole('e5')), wire('w2', hole('e7'), pin('GND.R'))]);

  it('joins common to the side the lever is on', () => {
    const a = kernel(circuit('a')).k;
    a.solve();
    expect(volts(a, 'c6')).toBeGreaterThan(3.2);
    const b = kernel(circuit('b')).k;
    b.solve();
    expect(volts(b, 'c6')).toBeLessThan(0.01);
  });
});
