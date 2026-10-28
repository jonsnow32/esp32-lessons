import { evaluateStep, type Lesson } from '@esp32lab/lesson-engine';
import { MS } from '@esp32lab/part-sdk';
import { describe, expect, it } from 'vitest';
import lesson01 from '../lessons/01-blink/lesson.json';
import lesson02 from '../lessons/02-button/lesson.json';
import { hole, kernel, pin, project, wire } from './helpers';

const l1 = lesson01 as unknown as Lesson;
const l2 = lesson02 as unknown as Lesson;

const externalLed = (reversed: boolean) =>
  project(
    [
      { id: 'r1', type: 'resistor', props: { resistance: 220 }, placement: { bb: 'bb1', hole: 'a5', rot: 0 } },
      { id: 'led1', type: 'led', placement: { bb: 'bb1', hole: reversed ? 'b10' : 'b9', rot: reversed ? 180 : 0 } },
    ],
    [wire('w1', pin('D18'), hole('e5')), wire('w2', hole('e10'), pin('GND.R'))],
  );

describe('lesson 01', () => {
  it('templates load and the blink step passes when GPIO2 is high and the banner is printed', () => {
    const { k } = kernel(l1.template, (m) => m.set('GPIO2', { output: 'high' }));
    k.advanceTo(1 * MS);
    const r = evaluateStep(l1.steps[1]!, { kernel: k, serial: '=== Hello ESP32! ===\n[0] LED ON\n' });
    expect(r.pass).toBe(true);
  });

  it('external LED exercise accepts a correct circuit', () => {
    const { k } = kernel(externalLed(false), (m) => m.set('GPIO18', { output: 'high' }));
    k.advanceTo(1 * MS);
    const r = evaluateStep(l1.exercises![0]!, { kernel: k, serial: '' });
    expect(r.pass).toBe(true);
    expect(r.results[0]!.detail).toBe('r1 → led1');
  });

  it('external LED exercise rejects a reversed LED', () => {
    const { k } = kernel(externalLed(true));
    k.solve();
    const r = evaluateStep(l1.exercises![0]!, { kernel: k, serial: '' });
    expect(r.results[0]!.pass).toBe(false);
  });
});

describe('lesson 02', () => {
  it('the onboard BOOT button satisfies the wiring step', () => {
    const { k } = kernel(l2.template);
    k.solve();
    expect(evaluateStep(l2.steps[0]!, { kernel: k, serial: '' }).pass).toBe(true);
  });

  it('a button on an input-only pin fails the exercise', () => {
    const p = project(
      [{ id: 'sw1', type: 'pushbutton', placement: { bb: 'bb1', hole: 'e10', rot: 0 } }],
      [wire('w1', pin('D34'), hole('a10')), wire('w2', hole('a12'), pin('GND.R'))],
    );
    const { k } = kernel(p);
    k.solve();
    const r = evaluateStep(l2.exercises![0]!, { kernel: k, serial: '' });
    expect(r.results[0]!.pass).toBe(false);
    expect(r.results[1]!.pass).toBe(false);
  });
});
