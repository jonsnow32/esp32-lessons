import type { Lesson } from '@esp32lab/lesson-engine';
import { MS } from '@esp32lab/part-sdk';
import { keyOf } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import lesson01 from '../lessons/01-blink/lesson.json';
import { hole, kernel, pin, project, wire } from './helpers';

const template = (lesson01 as unknown as Lesson).template;

describe('current flow', () => {
  it('follows D2 → resistor → LED → GND with the LED current on every edge', () => {
    const { k } = kernel(template, (m) => m.set('GPIO2', { output: 'high' }));
    k.advanceTo(1 * MS);
    const { terminals, edges } = k.flows();
    const iLed = k.observables('led1').current as number;
    expect(iLed).toBeGreaterThan(0.005);
    // Into the LED at the anode, out at the cathode; same through the resistor
    expect(terminals.get('led1')!.anode).toBeCloseTo(iLed, 6);
    expect(terminals.get('led1')!.cathode).toBeCloseTo(-iLed, 6);
    expect(terminals.get('r1')!.a).toBeCloseTo(iLed, 6);
    // The D2 wire carries it from the header pin to the breadboard
    const w1 = edges.find((e) => e.kind === 'wire' && e.id === 'w1')!;
    const sign = w1.a === keyOf.boardPin('D2') ? 1 : -1;
    expect(sign * w1.amps).toBeCloseTo(iLed, 6);
    // ...and the GND wire back to the board
    const w2 = edges.find((e) => e.kind === 'wire' && e.id === 'w2')!;
    expect(Math.abs(w2.amps)).toBeCloseTo(iLed, 6);
  });

  it('satisfies KCL at every node', () => {
    const { k } = kernel(template, (m) => m.set('GPIO2', { output: 'high' }));
    k.advanceTo(1 * MS);
    const { terminals, edges } = k.flows();
    const balance = new Map<string, number>();
    const add = (key: string, i: number) => balance.set(key, (balance.get(key) ?? 0) + i);
    for (const e of edges) {
      add(e.a, -e.amps);
      add(e.b, e.amps);
    }
    const keys = k.terminals();
    for (const [id, currents] of terminals) for (const [t, i] of Object.entries(currents)) add(keys.get(id)!.keys[t]!, -i);
    for (const [key, b] of balance) expect(Math.abs(b), key).toBeLessThan(1e-9);
  });

  it('carries nothing when GPIO2 is LOW, and a reversed LED blocks it', () => {
    const low = kernel(template, (m) => m.set('GPIO2', { output: 'low' }));
    low.k.advanceTo(1 * MS);
    expect(Math.max(...low.k.flows().edges.filter((e) => e.kind === 'wire').map((e) => Math.abs(e.amps)))).toBeLessThan(1e-9);

    const reversed = structuredClone(template);
    reversed.parts.find((p) => p.id === 'led1')!.placement = { bb: 'bb1', hole: 'e10', rot: 180 };
    const r = kernel(reversed, (m) => m.set('GPIO2', { output: 'high' }));
    r.k.advanceTo(1 * MS);
    expect(Math.abs(r.k.flows().terminals.get('led1')!.anode!)).toBeLessThan(1e-6);
  });

  it('passes current through a push button only while pressed', () => {
    const p = project(
      [{ id: 'sw1', type: 'pushbutton', props: { bounce: false }, placement: { bb: 'bb1', hole: 'e10', rot: 0 } }],
      [wire('w1', pin('D18'), hole('a10')), wire('w2', hole('a12'), pin('GND.R'))],
    );
    const { k } = kernel(p, (m) => m.set('GPIO18', { pull: 'up' }));
    k.advanceTo(1 * MS);
    const through = () => Math.abs(k.flows().edges.find((e) => e.id === 'w1')!.amps);
    expect(through()).toBeLessThan(1e-9);
    k.press('sw1');
    // 3.3 V across the 45 kΩ pull-up ≈ 73 µA
    expect(through()).toBeGreaterThan(5e-5);
  });
});
