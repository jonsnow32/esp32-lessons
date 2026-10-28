import { explain, type Note } from '@esp32lab/explain';
import type { Lesson } from '@esp32lab/lesson-engine';
import { ESP32_PADS } from '@esp32lab/mcu-esp32';
import { MS } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';
import type { ScriptedMcu } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import lesson01 from '../lessons/01-blink/lesson.json';
import { BOARD, PARTS, hole, kernel, pin, project, wire } from './helpers';

const template = (lesson01 as unknown as Lesson).template;
const manifests = Object.fromEntries(Object.entries(PARTS).map(([k, m]) => [k, m.manifest]));

function notesFor(p: Project, setup?: (m: ScriptedMcu) => void, act?: (k: ReturnType<typeof kernel>['k']) => void): Note[] {
  const { k } = kernel(p, setup);
  k.advanceTo(1 * MS);
  act?.(k);
  return explain({ kernel: k, project: p, board: BOARD, pads: ESP32_PADS, manifests });
}
const texts = (n: Note[]) => n.map((x) => `[${x.level}] ${x.text}`).join('\n');

describe('explain', () => {
  it('narrates the current path of a working LED circuit', () => {
    const n = notesFor(template, (m) => m.set('GPIO2', { output: 'high' }));
    const path = n.find((x) => x.text.startsWith('Dòng điện'));
    expect(path?.text, texts(n)).toMatch(/^Dòng điện 6,\d mA chạy: D2 → r1 \(220 Ω, sụt 1,\d\d V\) → led1 \(LED đỏ, 1,\d\d V, sáng \d+%\) → GND\.$/);
    expect(path?.highlight).toEqual(expect.arrayContaining(['r1', 'led1', 'bp:D2']));
    expect(texts(n)).toContain('D2 (GPIO2) đang HIGH');
    expect(texts(n)).toContain('[info] D2 (GPIO2) là chân "strapping"');
  });

  it('explains why the LED is off when D2 is LOW', () => {
    const n = notesFor(template, (m) => m.set('GPIO2', { output: 'low' }));
    expect(texts(n)).toContain('led1 đang tắt: hai chân gần như cùng điện áp');
    expect(texts(n)).not.toContain('Dòng điện');
  });

  it('spots a reversed LED', () => {
    const p = structuredClone(template);
    p.parts.find((x) => x.id === 'led1')!.placement = { bb: 'bb1', hole: 'e10', rot: 180 };
    expect(texts(notesFor(p, (m) => m.set('GPIO2', { output: 'high' })))).toContain('led1 đang cắm ngược');
  });

  it('warns about an LED without a series resistor', () => {
    const p = project(
      [{ id: 'led1', type: 'led', placement: { bb: 'bb1', hole: 'a9', rot: 0 } }],
      [wire('w1', pin('D18'), hole('e9')), wire('w2', hole('e10'), pin('GND.R'))],
    );
    const n = texts(notesFor(p, (m) => m.set('GPIO18', { output: 'high' })));
    expect(n).toMatch(/led1 đang chịu \d+,\d mA, quá mức an toàn/);
    expect(n).toContain('Chân D18 đang phải cấp');
    expect(n).toContain('kéo sụt');
  });

  it('explains a button input: floating, pulled up, pressed', () => {
    const p = project(
      [{ id: 'sw1', type: 'pushbutton', props: { bounce: false }, placement: { bb: 'bb1', hole: 'e10', rot: 0 } }],
      [wire('w1', pin('D18'), hole('a10')), wire('w2', hole('a12'), pin('GND.R'))],
    );
    expect(texts(notesFor(p))).toContain('D18 (GPIO18) đang là chân đọc nhưng thả nổi');
    const up = texts(notesFor(p, (m) => m.set('GPIO18', { pull: 'up' })));
    expect(up).toContain('digitalRead() = HIGH nhờ điện trở kéo lên');
    expect(up).toContain('sw1 đang nhả');
    const pressed = texts(notesFor(p, (m) => m.set('GPIO18', { pull: 'up' }), (k) => k.press('sw1')));
    expect(pressed).toContain('digitalRead() = LOW');
    expect(pressed).toContain('sw1 đang được nhấn');
  });

  it('reports a short from 3V3 to GND and a loose part', () => {
    const n = notesFor(
      project([{ id: 'r9', type: 'resistor', placement: { bb: 'bb1', hole: 'a20', rot: 0 } }], [wire('w1', pin('3V3'), pin('GND.L'))]),
    );
    expect(n[0]!.level).toBe('error');
    expect(n[0]!.text).toContain('Chập mạch: 3V3');
    expect(texts(n)).toContain('r9 chưa nối vào mạch');
  });

  it('spots a part whose legs share one breadboard strip', () => {
    // Buzzer turned to run down column 5: + in a5, − in d5, both on the a–e clip of column 5
    const p = project([{ id: 'bz1', type: 'buzzer', props: {}, placement: { bb: 'bb1', hole: 'a5', rot: 0 } }], [
      wire('w1', pin('D18'), hole('e5')),
    ]);
    const n = notesFor(p, (m) => m.set('GPIO18', { output: 'high' }));
    expect(texts(n)).toContain('bz1 bị nối tắt: chân + (chân dài) và chân −');
    // A push button's own legs a1–a2 are joined inside it: not a mistake
    const ok = notesFor(project([{ id: 'sw1', type: 'pushbutton', props: {}, placement: { bb: 'bb1', hole: 'e5', rot: 0 } }], [wire('w1', pin('D18'), hole('a5'))]));
    expect(texts(ok)).not.toContain('nối tắt');
  });
});
