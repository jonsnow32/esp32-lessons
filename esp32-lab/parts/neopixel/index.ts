import { NS, US, type PartBehavior, type PartEnv, type PartModule, type PartProps, type PulseTrain } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

/** A HIGH longer than this is a 1 (T0H 0.4 µs, T1H 0.8 µs, each ±150 ns). */
export const T_SPLIT = 600 * NS;
/** HIGHs shorter than this are glitches the chip does not see. */
const T_GLITCH = 100 * NS;
/** LOW at least this long latches the data (RES ≥ 50 µs). */
export const T_RESET = 50 * US;
/** Supply below which the chips do not run. */
const V_MIN = 3.0;
/** Current per colour channel at 255, and each chip's own current. */
const I_CHANNEL = 0.02;
const I_IDLE = 0.0006;

type Rgb = [number, number, number];

/** Count prop as a whole number of LEDs, 1–64. */
export function ledCount(props: PartProps): number {
  return Math.min(64, Math.max(1, Math.round(Number(props.count ?? 8))));
}

/**
 * A chain of WS2812B chips. Data is decoded from the pulse train on DIN: each HIGH is one bit,
 * long = 1. The first 24 bits after a reset (G, R, B, MSB first) belong to the first LED, the
 * next 24 to the second, and whatever is left goes out on DOUT for the next strip. The colours
 * show once DIN has been LOW for the reset time.
 */
function create(props: PartProps, env: PartEnv): PartBehavior {
  const n = ledCount(props);
  let shown: Rgb[] = Array.from({ length: n }, () => [0, 0, 0]);
  let latched: Rgb[] = shown.map((c) => [...c] as Rgb);
  let bits = 0;
  let powered = false;
  let vs = 0;
  /** End of the last train on DIN, and the latch that waits for the line to stay LOW. */
  let lastEnd = -Infinity;
  let latchSeq = 0;
  let pendingLatch = false;
  let frames = 0;

  const latch = () => {
    pendingLatch = false;
    bits = 0;
    shown = latched.map((c) => [...c] as Rgb);
    frames++;
    env.invalidate();
  };

  const take = (bit: number) => {
    const led = Math.floor(bits / 24);
    const k = bits % 24;
    // Wire order G, R, B
    const ch = [1, 0, 2][Math.floor(k / 8)]!;
    const c = latched[led]!;
    if (k % 8 === 0) c[ch] = 0;
    c[ch] = c[ch]! | (bit << (7 - (k % 8)));
    bits++;
  };

  return {
    damaged: false,
    stamp(ctx) {
      if (!powered) return;
      const i = shown.reduce((s, [r, g, b]) => s + ((r + g + b) / 255) * I_CHANNEL + I_IDLE, 0);
      ctx.conductance('vcc', 'gnd', i / Math.max(vs, V_MIN));
    },
    onSolved(op) {
      vs = op.v('vcc') - op.v('gnd');
      const on = vs >= V_MIN;
      if (on === powered) return;
      powered = on;
      if (!on) {
        // Power gone: the chips forget everything
        shown = shown.map(() => [0, 0, 0]);
        latched = latched.map(() => [0, 0, 0]);
        bits = 0;
      }
      env.invalidate();
    },
    pulses(terminal, train) {
      if (terminal !== 'din' || !powered) return;
      if (pendingLatch && train.t - lastEnd >= T_RESET) latch();
      let t = train.t;
      /** Where the bits for DOUT start: the HIGH after this part's last bit. */
      let passFrom = -1;
      let passAt = 0;
      train.pulses.forEach(([level, ns], i) => {
        if (level === 1 && ns >= T_GLITCH) {
          if (bits < 24 * n) take(ns > T_SPLIT ? 1 : 0);
          else if (passFrom < 0) [passFrom, passAt] = [i, t];
        } else if (level === 0 && ns >= T_RESET && i < train.pulses.length - 1) {
          latch();
        }
        t += ns;
      });
      lastEnd = t;
      if (passFrom >= 0) env.emit('dout', { t: passAt, pulses: train.pulses.slice(passFrom) });
      pendingLatch = true;
      const seq = ++latchSeq;
      env.schedule(Math.max(env.now(), t + T_RESET), `latch:${seq}`);
    },
    onEvent(ev) {
      if (ev.kind === 'timer' && ev.tag === `latch:${latchSeq}` && pendingLatch) latch();
    },
    persist: () => ({ shown }),
    restore(state) {
      const s = (state as { shown: Rgb[] }).shown;
      for (let i = 0; i < n && i < s.length; i++) shown[i] = [...s[i]!] as Rgb;
      latched = shown.map((c) => [...c] as Rgb);
    },
    observables: () => ({
      powered,
      pixels: shown.map((c) => c.map((v) => v.toString(16).padStart(2, '0')).join('')).join(' '),
      frames,
    }),
  };
}

/** Where LED `i` of `n` sits, relative to the first terminal. */
export function ledPosition(layout: string, n: number, i: number): [number, number] {
  if (layout === 'ring') {
    const r = Math.max(1.4, (n * 1.05) / (2 * Math.PI));
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [1.5 + r * Math.cos(a), -1.6 - r + r * Math.sin(a)];
  }
  return [i * 1.1 - (n - 4) * 0.55 + 0.05, -1.6];
}

/** How bright a channel looks: the eye sees low PWM levels as brighter than linear. */
function glow(v: number): number {
  return Math.round(255 * (v / 255) ** 0.45);
}

function view(props: PartProps, obs: Record<string, unknown>): string {
  const n = ledCount(props);
  const layout = String(props.layout ?? 'strip');
  const pixels = String(obs.pixels ?? '').split(' ');
  const pos = Array.from({ length: n }, (_, i) => ledPosition(layout, n, i));
  const xs = pos.map((p) => p[0]);
  const ys = pos.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs, 0) - 0.7, Math.max(...xs, 3) + 0.7];
  const [y0, y1] = [Math.min(...ys) - 0.7, Math.max(...ys) + 0.7];
  const ringR = Math.max(1.4, (n * 1.05) / (2 * Math.PI));
  const board =
    layout === 'ring'
      ? `<rect x="-0.4" y="-1.9" width="3.8" height="1.5" rx="0.2" fill="#1b1d22"/>
         <circle cx="1.5" cy="${-1.6 - ringR}" r="${ringR}" fill="none" stroke="#1b1d22" stroke-width="1.3"/>`
      : `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0 + 0.5}" rx="0.2" fill="#1b1d22"/>`;
  const leds = pos
    .map(([x, y], i) => {
      const hex = pixels[i] ?? '000000';
      const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) || 0);
      const lit = Math.max(r!, g!, b!) > 0;
      const fill = lit ? `rgb(${glow(r!)},${glow(g!)},${glow(b!)})` : '#3a3d44';
      return `<rect x="${x - 0.45}" y="${y - 0.45}" width="0.9" height="0.9" rx="0.08" fill="#f1f1ee"/>
        ${lit ? `<circle cx="${x}" cy="${y}" r="0.75" fill="${fill}" fill-opacity="${0.25 + (0.35 * Math.max(r!, g!, b!)) / 255}"/>` : ''}
        <circle cx="${x}" cy="${y}" r="0.3" fill="${fill}"/>`;
    })
    .join('');
  const pins = ['GND', 'VCC', 'DIN', 'DOUT']
    .map((l, x) => `<path d="M${x},0 V-0.6" stroke="#c9a13a" stroke-width="0.2"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/><text x="${x}" y="-0.75" font-size="0.28" text-anchor="middle" fill="#cfd3da" font-family="ui-monospace, monospace">${l}</text>`)
    .join('');
  return `${board}${pins}${leds}`;
}

export const neopixel: PartModule = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-2.9 -2.4 9.2 2.9',
  doc,
};
export default neopixel;
