// Live mode on a real board: the probe's lines are taken out of the serial stream, whatever
// pieces it comes in, and read as pin drives.

import { describe, expect, it } from 'vitest';
import { LiveDecoder, parsePin } from '../packages/app/src/lib/live';
import { LiveMcu } from '../packages/app/src/sim/live-mcu';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('reading the probe on a real board', () => {
  it('reads levels, pulls and PWM', () => {
    expect(parsePin('2:H-1')).toEqual(['GPIO2', { drive: { output: 'high', pull: 'none', strength: 2 }, level: 1 }]);
    expect(parsePin('4:Zu0')![1].drive).toEqual({ output: 'z', pull: 'up', strength: 2 });
    expect(parsePin('21:Xd1')![1].drive.output).toBe('z');
    expect(parsePin('5:P64/255@1000-1')![1].drive).toEqual({ output: 'high', pull: 'none', strength: 2, pwm: { periodNs: 1e6, highNs: 250000 } });
    expect(parsePin('5:P0/255@1000-0')![1].drive.output).toBe('low');
    expect(parsePin('5:P256/255@1000-1')![1].drive).toEqual({ output: 'high', pull: 'none', strength: 2 });
    expect(parsePin('garbage')).toBeUndefined();
  });

  it("cuts the probe's lines out of the sketch's text, in pieces of any size", () => {
    const stream = 'boot\r\nTemp: \x1eH esp32lab-probe 1\n25\r\n\x1eL 2:H-1 4:Zu0\nok\x1eL 2:L-0\n\r\n';
    for (const size of [1, 3, 7, stream.length]) {
      const d = new LiveDecoder();
      let text = '';
      let hello = false;
      // Pins reported in one piece are merged: the latest state of each wins
      const state: Record<string, string> = {};
      const all = bytes(stream);
      for (let i = 0; i < all.length; i += size) {
        const c = d.push(all.subarray(i, i + size));
        text += c.text;
        hello ||= c.hello;
        for (const [pad, p] of Object.entries(c.pins)) state[pad] = p.drive.output;
      }
      expect(text, `pieces of ${size}`).toBe('boot\r\nTemp: 25\r\nok\r\n');
      expect(hello).toBe(true);
      expect(state).toEqual({ GPIO2: 'low', GPIO4: 'z' });
    }
  });

  it('keeps text in UTF-8 across pieces, and reports a broken line', () => {
    const d = new LiveDecoder();
    const all = bytes('Nhiệt độ\n\x1eE port gone\n');
    let text = '';
    let error: string | undefined;
    for (let i = 0; i < all.length; i++) {
      const c = d.push(all.subarray(i, i + 1));
      text += c.text;
      error ??= c.error;
    }
    expect(text).toBe('Nhiệt độ\n');
    expect(error).toBe('port gone');
  });

  it('drives the circuit with what the board reports, telling the kernel when it changed', () => {
    const mcu = new LiveMcu(['GPIO2']);
    expect(mcu.drive('GPIO2').output).toBe('z');
    mcu.update({ GPIO2: parsePin('2:H-1')![1] });
    expect(mcu.drive('GPIO2').output).toBe('high');
    expect(mcu.runUntil(1000).padsChanged).toBe(true);
    expect(mcu.runUntil(2000).padsChanged).toBe(false);
    mcu.update({ GPIO2: parsePin('2:H-1')![1] });
    expect(mcu.runUntil(3000).padsChanged).toBe(false);
  });
});
