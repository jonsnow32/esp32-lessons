import type { I2cTarget, PartBehavior, PartEnv, PartModule } from '@esp32lab/part-sdk';
import { HEIGHT, Ssd1306, WIDTH } from './controller';
import { doc } from './doc';
import manifest from './part.json';

export interface Ssd1306Props {
  address: '0x3C' | '0x3D';
  color: 'white' | 'blue';
  [key: string]: string;
}

/** The module's pull-ups on SDA / SCL, and its 3.3 V regulator's dropout. */
const R_PULL = 10_000;
const V_MIN = 2.8;
/** Panel current: a few mA dark, up to ~20 mA with every pixel lit. */
const I_BASE = 0.003;
const I_FULL = 0.02;

/** Count lit pixels in a frame. */
function lit(frame: Uint8Array): number {
  let n = 0;
  for (const b of frame) for (let v = b; v; v &= v - 1) n++;
  return n;
}

/** 1-bit frame → base64, the form the view turns into an image. */
function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * 128 × 64 OLED on I2C: the controller decodes the transfer, the view shows what the panel
 * would. Current from VCC follows how many pixels are lit.
 */
function create(props: Ssd1306Props, env: PartEnv): PartBehavior {
  let oled = new Ssd1306();
  let powered = false;
  let vs = 0;
  let frame = oled.frame();
  let pixels = 0;
  let stale = false;

  const refresh = () => {
    if (!stale) return;
    stale = false;
    frame = oled.frame();
    const n = lit(frame);
    // Only a big change in lit area matters to the supply
    if (Math.abs(n - pixels) > 512) env.invalidate();
    pixels = n;
  };

  const i2c: I2cTarget = {
    address: props.address === '0x3D' ? 0x3d : 0x3c,
    begin: (read) => {
      if (!powered) return false;
      if (!read) oled.begin();
      return true;
    },
    write(byte) {
      oled.write(byte);
      stale = true;
      return true;
    },
    // Status byte: bit 6 = display off
    read: () => (oled.displayOn ? 0x00 : 0x40),
    end: refresh,
  };

  return {
    damaged: false,
    i2c,
    stamp(ctx) {
      ctx.conductance('sda', 'vcc', 1 / R_PULL);
      ctx.conductance('scl', 'vcc', 1 / R_PULL);
      if (powered) ctx.conductance('vcc', 'gnd', (I_BASE + (I_FULL * pixels) / (WIDTH * HEIGHT)) / Math.max(vs, V_MIN));
    },
    onSolved(op) {
      vs = op.v('vcc') - op.v('gnd');
      const on = vs >= V_MIN;
      if (on !== powered) {
        powered = on;
        if (!on) {
          oled = new Ssd1306();
          stale = true;
          refresh();
        }
        env.invalidate();
      }
    },
    persist: () => Object.assign(Object.create(Ssd1306.prototype), oled, { ram: oled.ram.slice() }) as Ssd1306,
    restore(state) {
      oled = Object.assign(Object.create(Ssd1306.prototype), state as Ssd1306, { ram: (state as Ssd1306).ram.slice() }) as Ssd1306;
      stale = true;
    },
    observables: () => {
      refresh();
      return { powered, on: powered && oled.displayOn && oled.chargePump, pixels, contrast: oled.contrast, frame: base64(frame) };
    },
  };
}

/** A 128 × 64 1-bit BMP (top-down) with the given colours for 0 and 1. */
function bmp(frameB64: string, off: string, on: string): string {
  const header = new Uint8Array(62);
  const v = new DataView(header.buffer);
  const size = 62 + (WIDTH / 8) * HEIGHT;
  header.set([0x42, 0x4d]);
  v.setUint32(2, size, true);
  v.setUint32(10, 62, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, WIDTH, true);
  v.setInt32(22, -HEIGHT, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 1, true);
  v.setUint32(34, (WIDTH / 8) * HEIGHT, true);
  // Palette entries are B, G, R, 0: index 0 for dark pixels, 1 for lit ones
  const bgr = (hex: string) => [5, 3, 1].map((i) => parseInt(hex.slice(i, i + 2), 16));
  header.set([...bgr(off), 0, ...bgr(on), 0], 54);
  return `data:image/bmp;base64,${btoa(String.fromCharCode(...header) + atob(frameB64))}`;
}

const INK = { white: '#e9f1ff', blue: '#5ab4ff' };

/** Black PCB with the glass panel; the frame is drawn pixel-exact into the active area. */
function view(props: Ssd1306Props, obs: Record<string, unknown>): string {
  const ink = INK[props.color] ?? INK.white;
  const frame = typeof obs.frame === 'string' && obs.frame ? obs.frame : '';
  const image = obs.on === true && frame ? `<image href="${bmp(frame, '#05070a', ink)}" x="-1.2" y="-8.7" width="8.4" height="4.2" preserveAspectRatio="none" style="image-rendering:pixelated"/>` : '';
  return `
    ${[0, 1, 2, 3].map((x) => `<path d="M${x},0 V-0.8" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-2.1" y="-11.1" width="10.2" height="10.6" rx="0.3" fill="#1d2a52" stroke="#121b36" stroke-width="0.06"/>
    ${[[-1.5, -10.5], [7.5, -10.5], [-1.5, -1.1], [7.5, -1.1]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.32" fill="#c9ced6"/>`).join('')}
    <rect x="-1.7" y="-9.6" width="9.4" height="6.6" rx="0.1" fill="#0b0d12" stroke="#2a2d31" stroke-width="0.05"/>
    <rect x="-1.2" y="-8.7" width="8.4" height="4.2" fill="#05070a"/>
    ${image}
    <text x="1.5" y="-1.6" font-size="0.36" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">GND VCC SCL SDA</text>`;
}

export const ssd1306: PartModule<Ssd1306Props> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-2.4 -11.4 10.8 11.7',
  bus: { sda: 'sda', scl: 'scl' },
  doc,
};
export default ssd1306;
