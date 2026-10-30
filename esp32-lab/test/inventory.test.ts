import { addFromBom, bom, checkProject, stockKey, stockProps, type StockItem } from '@esp32lab/inventory';
import type { Project } from '@esp32lab/project-model';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PARTS } from './helpers';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const projectOf = (id: string) => JSON.parse(readFileSync(root(`projects/${id}/project.json`), 'utf8')).project as Project;
const item = (id: string, kind: StockItem['kind'], qty: number): StockItem => ({ id, kind, qty, updated: 0 });

describe('stock keys', () => {
  it('keep the identifying props and drop the simulated ones', () => {
    expect(stockProps(PARTS.potentiometer.manifest, { resistance: 1000, position: 30 })).toEqual({ resistance: 1000 });
    expect(stockProps(PARTS.thermistor.manifest, { temperature: 40 })).toEqual({});
    expect(stockProps(PARTS.led.manifest)).toEqual({ color: 'red' });
  });

  it('are the same whatever the order of the props', () => {
    expect(stockKey('part', 'seven-segment', { common: 'anode', color: 'red' })).toBe(stockKey('part', 'seven-segment', { color: 'red', common: 'anode' }));
    expect(stockKey('part', 'buzzer')).toBe('buzzer');
    expect(stockKey('board', 'esp32-devkit-v1')).toBe('board:esp32-devkit-v1');
    expect(stockKey('breadboard', 'half-400')).toBe('bb:half-400');
  });

  it('only name props each part really has', () => {
    for (const [type, m] of Object.entries(PARTS)) for (const k of m.manifest.stock ?? []) expect(m.manifest.props, `${type}.${k}`).toHaveProperty(k);
  });
});

describe('bill of materials', () => {
  const traffic = bom(projectOf('traffic-light'), PARTS);

  it('groups the parts of the traffic light by stocked item', () => {
    const qty = Object.fromEntries(traffic.map((l) => [l.key, l.qty]));
    expect(qty).toEqual({
      'board:esp32-devkit-v1': 1,
      'bb:half-400': 1,
      'resistor?resistance=220': 3,
      'led?color=red': 1,
      'led?color=yellow': 1,
      'led?color=green': 1,
    });
  });

  it('says what is missing', () => {
    const c = checkProject(traffic, [item('resistor?resistance=220', 'part', 2), item('led?color=red', 'part', 5), item('bb:half-400', 'breadboard', 1)]);
    expect(c.complete).toBe(false);
    expect(c.haveCount).toBe(2);
    expect(c.needCount).toBe(6);
    expect(c.lines.find((l) => l.key === 'resistor?resistance=220')).toMatchObject({ have: 2, missing: 1 });
  });

  it('is complete once the kit is added to the stock', () => {
    const stock = addFromBom([item('led?color=red', 'part', 2)], traffic, 7);
    expect(stock.find((i) => i.id === 'led?color=red')).toMatchObject({ qty: 3, updated: 7 });
    expect(checkProject(traffic, stock).complete).toBe(true);
  });
});
