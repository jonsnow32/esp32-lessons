import { MS, US, type PulseTrain } from '@esp32lab/part-sdk';
import type { PartInstance } from '@esp32lab/project-model';
import { describe, expect, it } from 'vitest';
import { hole, kernel, pin, project, wire } from './helpers';

const part = (id: string, type: string, at: string, props: PartInstance['props'] = {}): PartInstance => ({
  id,
  type,
  props,
  placement: { bb: 'bb1', hole: at, rot: 0 },
});

/** What the RMT puts out for these colours at 800 kHz: G, R, B per LED, MSB first. */
function ws2812(colors: number[], t1h = 800, t0h = 400): PulseTrain['pulses'] {
  const out: [0 | 1, number][] = [];
  for (const rgb of colors) {
    const grb = (((rgb >> 8) & 0xff) << 16) | (((rgb >> 16) & 0xff) << 8) | (rgb & 0xff);
    for (let b = 23; b >= 0; b--) {
      const one = (grb >> b) & 1;
      out.push([1, one ? t1h : t0h], [0, 1250 - (one ? t1h : t0h)]);
    }
  }
  return out;
}

describe('WS2812B (NeoPixel)', () => {
  // Strip 1: GND a5, VCC a6, DIN a7 (GPIO5), DOUT a8. Strip 2 at a20, its DIN (a22) on DOUT.
  const setup = (opts: { power?: boolean; chain?: boolean; count?: number } = {}) => {
    const parts = [part('s1', 'neopixel', 'a5', { count: opts.count ?? 2 })];
    const wires = [wire('w1', hole('e5'), pin('GND.R')), wire('w3', pin('D5'), hole('e7'))];
    if (opts.power !== false) wires.push(wire('w2', pin('VIN'), hole('e6')));
    if (opts.chain) {
      parts.push(part('s2', 'neopixel', 'a20', { count: 1 }));
      wires.push(wire('w4', hole('e20'), pin('GND.R')), wire('w5', pin('VIN'), hole('e21')), wire('w6', hole('e8'), hole('e22')));
    }
    const { k, mcu } = kernel(project(parts, wires));
    k.advanceTo(1 * MS);
    return { k, mcu };
  };

  it('shows the colours once DIN has stayed LOW for the reset time', () => {
    const { k, mcu } = setup();
    mcu.pulse('GPIO5', ws2812([0xff0000, 0x00ff80]));
    k.advanceTo(k.now + 20 * US);
    expect(k.observables('s1').pixels).toBe('000000 000000');
    k.advanceTo(k.now + 100 * US);
    expect(k.observables('s1')).toMatchObject({ pixels: 'ff0000 00ff80', frames: 1 });
  });

  it('passes what is left on to the next strip through DOUT', () => {
    const { k, mcu } = setup({ chain: true });
    mcu.pulse('GPIO5', ws2812([0x0000ff, 0x00ff00, 0x123456]));
    k.advanceTo(k.now + 200 * US);
    expect(k.observables('s1').pixels).toBe('0000ff 00ff00');
    expect(k.observables('s2').pixels).toBe('123456');
  });

  it('keeps counting bits across transmissions closer together than the reset time', () => {
    const { k, mcu } = setup();
    const t0 = k.now;
    const a = ws2812([0xabcdef]);
    mcu.pulse('GPIO5', a, t0);
    mcu.pulse('GPIO5', ws2812([0x010203]), t0 + 30 * US + 10 * US);
    k.advanceTo(k.now + 200 * US);
    expect(k.observables('s1').pixels).toBe('abcdef 010203');
    // A new frame after a pause starts again at the first LED
    mcu.pulse('GPIO5', ws2812([0x440000]));
    k.advanceTo(k.now + 200 * US);
    expect(k.observables('s1').pixels).toBe('440000 010203');
  });

  it('reads short and long HIGHs within the WS2812 tolerances', () => {
    const { k, mcu } = setup({ count: 1 });
    mcu.pulse('GPIO5', ws2812([0x00ff00], 700, 300));
    k.advanceTo(k.now + 200 * US);
    expect(k.observables('s1').pixels).toBe('00ff00');
  });

  it('stays dark without power', () => {
    const { k, mcu } = setup({ power: false });
    mcu.pulse('GPIO5', ws2812([0xffffff, 0xffffff]));
    k.advanceTo(k.now + 200 * US);
    expect(k.observables('s1')).toMatchObject({ powered: false, pixels: '000000 000000' });
  });

  it('draws current from VCC in proportion to the colours', () => {
    const { k, mcu } = setup({ count: 8 });
    const vin = () => k.observables('board.supply.5V')?.current as number;
    const idle = vin();
    mcu.pulse('GPIO5', ws2812(Array(8).fill(0xffffff)));
    // 8 × 30 µs of data, then the reset time
    k.advanceTo(k.now + 400 * US);
    // 8 × 3 × 20 mA
    expect(vin() - idle).toBeGreaterThan(0.4);
    expect(vin() - idle).toBeLessThan(0.52);
  });
});
