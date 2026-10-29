import type { I2cTarget, PartBehavior, PartEnv, PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import { glyph } from './font';
import { Hd44780 } from './hd44780';
import manifest from './part.json';

export interface Lcd1602Props {
  /** PCF8574 (0x27) or PCF8574A (0x3F) backpack. */
  address: '0x27' | '0x3F';
  color: 'blue' | 'green';
  [key: string]: string;
}

/** The backpack's pull-ups on SDA and SCL. */
const R_PULL = 4_700;
/** The PCF8574 runs from 2.5 V; the liquid crystal needs ~4.5 V for full contrast. */
const V_LOGIC = 2.5;
const V_CONTRAST = 4.2;
/** Backlight LED with its resistor, and the logic, from VCC. */
const I_BACKLIGHT = 0.02;
const I_LOGIC = 0.0015;

/** Printable form of a line, for tests and explanations (custom characters as '#'). */
const text = (codes: number[]) => codes.map((c) => (c < 8 ? '#' : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?')).join('');
const hex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A 16 × 2 character LCD on a PCF8574 I2C backpack. Every byte written to the expander sets its
 * pins; the HD44780 behind it decodes the E pulses. Below ~4.2 V the text is barely visible.
 */
function create(props: Lcd1602Props, env: PartEnv): PartBehavior {
  const lcd = new Hd44780();
  let vs = 0;
  let powered = false;
  let writes = 0;

  const i2c: I2cTarget = {
    address: props.address === '0x3F' ? 0x3f : 0x27,
    begin: () => powered,
    write(byte) {
      const before = lcd.backlight;
      lcd.writePort(byte);
      writes++;
      if (lcd.backlight !== before) env.invalidate();
      return true;
    },
    // Quasi-bidirectional pins read back what was written (HIGH ones as inputs)
    read: () => lcd.port,
  };

  return {
    damaged: false,
    i2c,
    stamp(ctx) {
      ctx.conductance('sda', 'vcc', 1 / R_PULL);
      ctx.conductance('scl', 'vcc', 1 / R_PULL);
      if (powered) ctx.conductance('vcc', 'gnd', (I_LOGIC + (lcd.backlight ? I_BACKLIGHT : 0)) / Math.max(vs, V_LOGIC));
    },
    onSolved(op) {
      vs = op.v('vcc') - op.v('gnd');
      const on = vs >= V_LOGIC;
      if (on !== powered) {
        powered = on;
        if (!on) Object.assign(lcd, new Hd44780());
        env.invalidate();
      }
    },
    // What the controller holds survives a rebuild; it is a copy, so the old instance can't touch it
    persist: () => ({ ...lcd, ddram: lcd.ddram.slice(), cgram: lcd.cgram.slice() }),
    restore(state) {
      const s = state as Hd44780;
      Object.assign(lcd, s);
      lcd.ddram.set(s.ddram);
      lcd.cgram.set(s.cgram);
    },
    observables: () => {
      const rows = [0, 1].map((r) => Array.from({ length: 16 }, (_, c) => lcd.cell(r, c)));
      const cur = lcd.cursorCell();
      return {
        powered,
        line1: text(rows[0]!),
        line2: text(rows[1]!),
        cells: hex(rows.flat()),
        cgram: hex(lcd.cgram),
        display: powered && lcd.displayOn,
        backlight: powered && lcd.backlight,
        cursor: cur && (lcd.cursor || lcd.blink) ? cur[0] * 16 + cur[1] : -1,
        contrast: Math.min(1, Math.max(0, (vs - V_LOGIC) / (V_CONTRAST - V_LOGIC))),
        writes,
      };
    },
  };
}

/** Dot size and pitch of the 5 × 8 character cells, in breadboard pitches. */
const DOT = 0.2;
const DOT_PITCH = 0.235;
const CELL_W = 5 * DOT_PITCH + 0.28;
const CELL_H = 8 * DOT_PITCH + 0.38;
const X0 = 3.2;
const Y0 = -10.4;

const SCREEN = {
  blue: { bg: '#2f5fe0', lit: '#e8f0ff', dim: '#3a6af0', off: '#1b2f6e' },
  green: { bg: '#9bc63b', lit: '#1a2410', dim: '#a6d046', off: '#4f6a1e' },
};

const unhex = (s: unknown) => (typeof s === 'string' ? (s.match(/../g) ?? []).map((h) => parseInt(h, 16)) : []);

/** Rows of a character: 8 values, 5 bits each, bit 4 = leftmost dot. */
function rowsOf(code: number, cgram: number[]): number[] {
  if (code < 16) return Array.from({ length: 8 }, (_, r) => cgram[(code & 7) * 8 + r] ?? 0);
  const cols = glyph(code);
  return Array.from({ length: 8 }, (_, r) => cols.reduce((acc, col, x) => acc | (((col >> r) & 1) << (4 - x)), 0));
}

/** Green PCB, black bezel and the dot-matrix screen; the I2C header sticks out on the left. */
function view(props: Lcd1602Props, obs: Record<string, unknown>): string {
  const s = SCREEN[props.color] ?? SCREEN.blue;
  const lit = obs.backlight === true;
  const show = obs.display === true;
  const cells = unhex(obs.cells);
  const cgram = unhex(obs.cgram);
  const contrast = Number(obs.contrast ?? 0);
  let bg = '';
  let dots = '';
  for (let i = 0; i < 32; i++) {
    const x = X0 + (i % 16) * CELL_W;
    const y = Y0 + Math.floor(i / 16) * CELL_H;
    bg += `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${(5 * DOT_PITCH).toFixed(3)}" height="${(8 * DOT_PITCH).toFixed(3)}" fill="${s.dim}" opacity="${lit ? 0.55 : 0.25}"/>`;
    if (!show) continue;
    const rows = rowsOf(cells[i] ?? 0x20, cgram);
    if (Number(obs.cursor) === i) rows[7] = 0x1f;
    rows.forEach((bits, r) => {
      for (let c = 0; c < 5; c++) if (bits & (0x10 >> c)) dots += `M${(x + c * DOT_PITCH).toFixed(3)},${(y + r * DOT_PITCH).toFixed(3)}h${DOT}v${DOT}h-${DOT}z`;
    });
  }
  return `
    ${[0, 1, 2, 3].map((x) => `<path d="M${x},0 V-1.2" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.6" y="-2.2" width="4.2" height="1.1" rx="0.1" fill="#1f2023"/>
    <text x="1.5" y="-1.45" font-size="0.36" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">GND VCC SDA SCL</text>
    <rect x="-0.8" y="-15.4" width="31.6" height="13.4" rx="0.3" fill="#2a7a3a" stroke="#1d5428" stroke-width="0.06"/>
    ${[[0, -14.6], [29.9, -14.6], [0, -2.8], [29.9, -2.8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.45" fill="#c9ced6" stroke="#6f767e" stroke-width="0.05"/>`).join('')}
    <rect x="1.2" y="-13.6" width="27.6" height="10" rx="0.2" fill="#15161a"/>
    <rect x="2.4" y="-12.2" width="25.2" height="7.2" rx="0.1" fill="${lit ? s.bg : s.off}"/>
    ${bg}
    ${dots ? `<path d="${dots}" fill="${lit ? s.lit : '#0d1730'}" opacity="${(0.15 + 0.85 * contrast).toFixed(2)}"/>` : ''}`;
}

export const lcd1602: PartModule<Lcd1602Props> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-1.1 -15.7 32.2 16',
  bus: { sda: 'sda', scl: 'scl' },
  doc,
};
export default lcd1602;
