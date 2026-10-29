import { MS, US } from '@esp32lab/part-sdk';
import type { PartInstance } from '@esp32lab/project-model';
import { keyOf } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { hole, kernel, pin, project, wire } from './helpers';

const part = (id: string, type: string, at: string, props: PartInstance['props'] = {}): PartInstance => ({
  id,
  type,
  props,
  placement: { bb: 'bb1', hole: at, rot: 0 },
});
const pwm = (highNs: number, periodNs = 1 * MS) => ({ output: 'high' as const, pwm: { periodNs, highNs } });

describe('PWM pads', () => {
  // GPIO4 → 220 Ω (a5–a9) → LED (c9 anode, c10 cathode) → GND
  const ledAt = (drive: Parameters<ReturnType<typeof kernel>['mcu']['set']>[1]) => {
    const { k } = kernel(
      project([part('r1', 'resistor', 'a5', { resistance: 220 }), part('led1', 'led', 'c9')], [wire('w1', pin('D4'), hole('e5')), wire('w2', hole('e10'), pin('GND.R'))]),
      (m) => m.set('GPIO4', drive, 0),
    );
    k.advanceTo(10 * MS);
    return { obs: k.observables('led1'), volts: k.voltage(keyOf.pad('GPIO4')) };
  };

  it('an LED glows in proportion to the duty, though it is not linear in voltage', () => {
    const full = ledAt({ output: 'high' }).obs.current as number;
    const quarter = ledAt(pwm(250 * US));
    // On 25 % of the time at full current, not lit at all by the 0.8 V average
    expect(quarter.obs.current as number).toBeCloseTo(full * 0.25, 4);
    expect(quarter.volts).toBeGreaterThan(0.6);
    expect(quarter.volts).toBeLessThan(1.2);
    expect(ledAt(pwm(750 * US)).obs.current as number).toBeCloseTo(full * 0.75, 4);
  });

  it('two pads with different duties each get their own share', () => {
    const { k } = kernel(
      project(
        [part('r1', 'resistor', 'a5', { resistance: 220 }), part('led1', 'led', 'c9'), part('r2', 'resistor', 'a15', { resistance: 220 }), part('led2', 'led', 'c19')],
        [wire('w1', pin('D4'), hole('e5')), wire('w2', hole('e10'), pin('GND.R')), wire('w3', pin('D5'), hole('e15')), wire('w4', hole('e20'), pin('GND.R'))],
      ),
      (m) => m.set('GPIO4', pwm(200 * US), 0).set('GPIO5', pwm(600 * US), 0),
    );
    k.advanceTo(10 * MS);
    const a = k.observables('led1').current as number;
    const b = k.observables('led2').current as number;
    expect(b / a).toBeCloseTo(3, 2);
  });
});

describe('servo', () => {
  // GND a5, V+ a6 (VIN), signal a7 (GPIO18)
  const setup = () =>
    kernel(project([part('s1', 'servo', 'a5')], [wire('w1', hole('e5'), pin('GND.R')), wire('w2', pin('VIN'), hole('e6')), wire('w3', pin('D18'), hole('e7'))]));

  it('turns to the angle the LEDC pulse width commands, at its rated speed', () => {
    const { k, mcu } = setup();
    mcu.set('GPIO18', pwm(2500 * US, 20 * MS), 1 * MS);
    k.advanceTo(50 * MS);
    // 90° → 180° at 600 °/s takes 150 ms
    expect(k.observables('s1').moving).toBe(true);
    expect(k.observables('s1').angle as number).toBeGreaterThan(90);
    k.advanceTo(200 * MS);
    expect(k.observables('s1')).toMatchObject({ angle: 180, moving: false, pulseUs: 2500 });
    mcu.set('GPIO18', pwm(1000 * US, 20 * MS), 210 * MS);
    // 135° back at 600 °/s: 225 ms
    k.advanceTo(400 * MS);
    expect(k.observables('s1').angle as number).toBeGreaterThan(45);
    k.advanceTo(450 * MS);
    expect(k.observables('s1').angle).toBeCloseTo(45, 5);
  });

  it('also reads pulses a sketch makes by toggling the pin', () => {
    const { k, mcu } = setup();
    for (let i = 0; i < 10; i++) mcu.set('GPIO18', { output: 'high' }, i * 20 * MS).set('GPIO18', { output: 'low' }, i * 20 * MS + 500 * US);
    k.advanceTo(200 * MS);
    expect(k.observables('s1').angle).toBe(0);
  });

  it('stays put without 5 V', () => {
    const { k, mcu } = kernel(project([part('s1', 'servo', 'a5')], [wire('w1', hole('e5'), pin('GND.R')), wire('w2', pin('3V3'), hole('e6')), wire('w3', pin('D18'), hole('e7'))]));
    mcu.set('GPIO18', pwm(2500 * US, 20 * MS), 0);
    k.advanceTo(300 * MS);
    expect(k.observables('s1')).toMatchObject({ powered: false, angle: 90 });
  });
});
