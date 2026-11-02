// Live mode on a real board: what comes over its USB serial line, taken apart. The sketch's own
// output goes to the Serial Monitor; lines that start with \x1e are the probe's (see
// lab-server/src/probe.ts) and the server's:
//   \x1eH esp32lab-probe 1        the probe is running
//   \x1eL 2:H-0 4:P128/255@5000-0  pins that changed: state, pull, level read
//   \x1eE <message>               the serial line failed (from the server)
// A probe line may land in the middle of a line of the sketch's: it is cut out and the sketch's
// text closes up around it.

import type { PadDrive } from '@esp32lab/sim-core';

export interface LivePin {
  drive: PadDrive;
  /** The level the pin reads on the real chip. */
  level: 0 | 1;
}

export interface LiveChunk {
  /** The sketch's own output. */
  text: string;
  /** Pins that changed, by pad name (GPIO2). */
  pins: Record<string, LivePin>;
  /** The probe said hello: the board runs a live build. */
  hello: boolean;
  /** The line failed. */
  error?: string;
}

const MARK = 0x1e;
const NL = 0x0a;

/** One pin as the probe writes it, or undefined if it is not one. */
export function parsePin(s: string): [string, LivePin] | undefined {
  const m = /^(\d+):(?:([HLZX])|P(\d+)\/(\d+)@(\d+))([ud-])([01])$/.exec(s);
  if (!m) return undefined;
  const pull = m[6] === 'u' ? 'up' : m[6] === 'd' ? 'down' : 'none';
  const level = m[7] === '1' ? 1 : 0;
  let drive: PadDrive;
  if (m[2]) {
    drive = { output: m[2] === 'H' ? 'high' : m[2] === 'L' ? 'low' : 'z', pull, strength: 2 };
  } else {
    const [duty, max, hz] = [Number(m[3]), Number(m[4]), Number(m[5])];
    // Full on reads max + 1 (2^bits): a steady level, as is 0
    if (duty <= 0 || !hz) drive = { output: 'low', pull, strength: 2 };
    else if (duty > max) drive = { output: 'high', pull, strength: 2 };
    else {
      const periodNs = 1e9 / hz;
      drive = { output: 'high', pull, strength: 2, pwm: { periodNs, highNs: (periodNs * duty) / (max + 1) } };
    }
  }
  return [`GPIO${m[1]}`, { drive, level }];
}

/** Takes the serial line's bytes as they come, in pieces of any size. */
export class LiveDecoder {
  /** Bytes of the probe line begun but not ended yet. */
  private line: number[] | null = null;
  private utf8 = new TextDecoder();

  push(bytes: Uint8Array): LiveChunk {
    const out: LiveChunk = { text: '', pins: {}, hello: false };
    let from = 0;
    const flushText = (to: number) => {
      if (to > from) out.text += this.utf8.decode(bytes.subarray(from, to), { stream: true });
    };
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      if (this.line) {
        if (b === NL) {
          this.take(String.fromCharCode(...this.line), out);
          this.line = null;
          from = i + 1;
        } else if (this.line.length < 4096) this.line.push(b);
        continue;
      }
      if (b === MARK) {
        flushText(i);
        this.line = [];
        from = i + 1;
      }
    }
    if (!this.line) flushText(bytes.length);
    return out;
  }

  private take(line: string, out: LiveChunk) {
    const kind = line[0];
    const rest = line.slice(1).trim();
    if (kind === 'H') out.hello = true;
    else if (kind === 'E') out.error = rest;
    else if (kind === 'L') {
      for (const item of rest.split(' ')) {
        const p = parsePin(item);
        if (p) out.pins[p[0]] = p[1];
      }
    }
  }
}
