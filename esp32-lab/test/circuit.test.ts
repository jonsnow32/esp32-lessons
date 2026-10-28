import { MS } from '@esp32lab/part-sdk';
import { expandBreadboard } from '@esp32lab/project-model';
import { keyOf } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { BREADBOARDS, hole, kernel, pin, project, wire } from './helpers';

const ledOnD18 = (opts: { resistor?: boolean; reversed?: boolean } = {}) => {
  // GPIO18 → a5 … resistor a5–a9 … LED anode b9 / cathode b10 … wire e10 → GND
  const parts = [
    {
      id: 'led1',
      type: 'led',
      props: { color: 'red' },
      placement: { bb: 'bb1', hole: opts.reversed ? 'b10' : 'b9', rot: opts.reversed ? (180 as const) : (0 as const) },
    },
  ];
  if (opts.resistor !== false) parts.push({ id: 'r1', type: 'resistor', props: { resistance: 220 } as never, placement: { bb: 'bb1', hole: 'a5', rot: 0 } });
  const wires = [wire('w1', pin('D18'), hole(opts.resistor === false ? 'e9' : 'e5')), wire('w2', hole('e10'), pin('GND.R'))];
  return project(parts, wires);
};

describe('breadboard', () => {
  it('half-400 has 400 holes in 64 strips', () => {
    const bb = expandBreadboard(BREADBOARDS['half-400']!);
    expect(bb.holes.size).toBe(400);
    expect(bb.strips).toHaveLength(30 * 2 + 4);
  });
});

describe('DC circuits', () => {
  it('voltage divider from the 3V3 pin', () => {
    const p = project(
      [
        { id: 'r1', type: 'resistor', props: { resistance: 10_000 }, placement: { bb: 'bb1', hole: 'a5', rot: 0 } },
        { id: 'r2', type: 'resistor', props: { resistance: 10_000 }, placement: { bb: 'bb1', hole: 'b9', rot: 0 } },
      ],
      [wire('w1', pin('3V3'), hole('e5')), wire('w2', hole('e13'), pin('GND.R'))],
    );
    const { k } = kernel(p);
    k.solve();
    expect(k.voltage(keyOf.hole('bb1', 'c9'))).toBeCloseTo(1.65, 2);
  });

  it('LED with 220 Ω on a HIGH GPIO draws about 6 mA', () => {
    const { k } = kernel(ledOnD18(), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    k.advanceTo(1 * MS);
    const led = k.observables('led1');
    expect(led.current).toBeGreaterThan(0.005);
    expect(led.current).toBeLessThan(0.007);
    expect(led.brightness).toBeGreaterThan(0.2);
  });

  it('LED turns off when the GPIO goes LOW', () => {
    const { k } = kernel(ledOnD18(), (mcu) => mcu.set('GPIO18', { output: 'high' }).set('GPIO18', { output: 'low' }, 5 * MS));
    k.advanceTo(10 * MS);
    expect(k.observables('led1').current as number).toBeLessThan(1e-9);
  });

  it('reversed LED blocks current', () => {
    const { k } = kernel(ledOnD18({ reversed: true }), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    k.advanceTo(1 * MS);
    expect(Math.abs(k.observables('led1').current as number)).toBeLessThan(1e-6);
    expect(k.observables('led1').damaged).toBe(false);
  });

  it('LED straight across 3V3 burns out instantly', () => {
    const p = project(
      [{ id: 'led1', type: 'led', props: { color: 'red' }, placement: { bb: 'bb1', hole: 'a5', rot: 0 } }],
      [wire('w1', pin('3V3'), hole('e5')), wire('w2', hole('e6'), pin('GND.R'))],
    );
    const { k } = kernel(p);
    k.solve();
    expect(k.observables('led1').damaged).toBe(true);
    expect(k.diagnostics.some((d) => d.code === 'damaged' && d.part === 'led1')).toBe(true);
  });

  it('LED without resistor on a GPIO is overdriven and dies after a while', () => {
    const { k } = kernel(ledOnD18({ resistor: false }), (mcu) => mcu.set('GPIO18', { output: 'high' }));
    k.advanceTo(1 * MS);
    expect(k.observables('led1').current).toBeGreaterThan(0.03);
    expect(k.observables('led1').damaged).toBe(false);
    k.advanceTo(200 * MS);
    expect(k.observables('led1').damaged).toBe(true);
  });

  it('onboard LED on GPIO2 lights through its 1 kΩ resistor', () => {
    const { k } = kernel(project(), (mcu) => mcu.set('GPIO2', { output: 'high' }));
    k.advanceTo(1 * MS);
    expect(k.observables('board.led').current).toBeGreaterThan(0.0002);
  });
});

describe('digital inputs', () => {
  it('BOOT button reads HIGH released and LOW pressed, with contact bounce', () => {
    const { k, mcu } = kernel(project(), (m) => m.set('GPIO0', { pull: 'up' }));
    k.advanceTo(1 * MS);
    expect(mcu.read('GPIO0')).toBe(1);
    k.press('board.boot');
    k.advanceTo(20 * MS);
    expect(mcu.read('GPIO0')).toBe(0);
    const falling = mcu.edges.filter((e) => e.pad === 'GPIO0');
    // 1 clean edge would be an ideal switch; bounce gives more
    expect(falling.length).toBeGreaterThan(1);
    k.release('board.boot');
    k.advanceTo(40 * MS);
    expect(mcu.read('GPIO0')).toBe(1);
  });

  it('an unconnected input without pull-up is floating', () => {
    const { k } = kernel(project());
    k.solve();
    expect(k.isFloating(keyOf.pad('GPIO18'))).toBe(true);
  });

  it('INPUT_PULLUP on GPIO18 with an external button to GND', () => {
    const p = project(
      [{ id: 'sw1', type: 'pushbutton', props: { bounce: false }, placement: { bb: 'bb1', hole: 'e10', rot: 0 } }],
      [wire('w1', pin('D18'), hole('a10')), wire('w2', hole('a12'), pin('GND.R'))],
    );
    const { k, mcu } = kernel(p, (m) => m.set('GPIO18', { pull: 'up' }));
    k.advanceTo(1 * MS);
    expect(k.isFloating(keyOf.pad('GPIO18'))).toBe(false);
    expect(mcu.read('GPIO18')).toBe(1);
    k.press('sw1');
    expect(mcu.read('GPIO18')).toBe(0);
    expect(mcu.edges.filter((e) => e.pad === 'GPIO18')).toHaveLength(1);
  });
});
