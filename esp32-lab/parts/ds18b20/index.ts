import { MS, US, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface Ds18b20Props {
  temperature: number;
  [key: string]: number;
}

const V_MIN = 3.0;
/** Open-drain pull-down strength of DQ. */
const R_LOW = 50;
/** A low longer than this is a reset (the master holds ≥ 480 µs). */
const RESET_MIN = 440 * US;
/** A write slot released sooner than this is a 1, later a 0. */
const WRITE_1_MAX = 15 * US;
const PRESENCE_WAIT = 30 * US;
const PRESENCE = 120 * US;
/** How long a 0 is held in a read slot; the master samples ~13 µs after its falling edge. */
const READ_0_HOLD = 30 * US;
const FAMILY = 0x28;

/** Dallas/Maxim CRC-8 (x⁸ + x⁵ + x⁴ + 1, LSB first), as in the ROM code and scratchpad. */
export function crc8(bytes: number[]): number {
  let crc = 0;
  for (let byte of bytes) {
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ byte) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      byte >>= 1;
    }
  }
  return crc;
}

/** Bits per sample from the configuration register (R1 R0 in bits 6–5): 9–12. */
export const resolutionOf = (config: number) => 9 + ((config >> 5) & 3);
/** Conversion time at a resolution: 93.75 ms at 9 bits, doubling per bit. */
export const conversionTime = (bits: number) => 93.75 * MS * 2 ** (bits - 9);

/** Temperature register: 1/16 °C two's complement, unused low bits cleared below 12-bit resolution. */
export function encodeTemperature(celsius: number, bits: number): number {
  const raw = Math.round(Math.min(125, Math.max(-55, celsius)) * 16) & ~((1 << (12 - bits)) - 1);
  return raw & 0xffff;
}

/** The 9 scratchpad bytes: temperature LSB/MSB, TH, TL, config, reserved, CRC. */
export function scratchpad(temp: number, th: number, tl: number, config: number): number[] {
  const bytes = [temp & 0xff, temp >> 8, th, tl, config, 0xff, 0x0c, 0x10];
  return [...bytes, crc8(bytes)];
}

const bitsOf = (bytes: number[]) => bytes.flatMap((b) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (b >> i) & 1));
const byteOf = (bits: number[]) => bits.reduce((a, b, i) => a | (b << i), 0);

type State = 'idle' | 'rom' | 'match' | 'search' | 'function' | 'write-scratchpad' | 'send' | 'convert';

/**
 * A 1-Wire slave decoded from DQ's edges, as the chip does it: a long low is a reset (answered
 * with a presence pulse); in a write slot the release time is the bit; in a read slot the chip
 * holds DQ low for a 0. ROM commands (Read, Match, Skip, Search) select it, then Convert T,
 * Read / Write Scratchpad and Read Power Supply work as in the datasheet. DQ is open drain:
 * without a pull-up nothing ever reads HIGH.
 */
function create(props: Ds18b20Props, env: PartEnv): PartBehavior {
  const serial = Array.from({ length: 6 }, () => Math.floor(env.random() * 256));
  const romBytes = [FAMILY, ...serial];
  const rom = [...romBytes, crc8(romBytes)];
  const romBits = bitsOf(rom);

  let powered = false;
  let pulling = false;
  let lineLow = false;
  let lowSince = 0;
  /** The current low was started by the chip itself (presence pulse), not the master. */
  let lowByUs = false;
  /** The slot the master opened is a read slot. */
  let readSlot = false;
  let generation = 0;

  let state: State = 'idle';
  let rx: number[] = [];
  let tx: number[] = [];
  let searchBit = 0;
  let searchSub = 0;

  // Power-on values: 85 °C until the first conversion
  let temp = 0x0550;
  let th = 0x4b;
  let tl = 0x46;
  let config = 0x7f;
  let converting = false;
  let conversions = 0;

  const setPull = (value: boolean) => {
    if (pulling !== value) {
      pulling = value;
      env.invalidate();
    }
  };

  const send = (bytes: number[]) => {
    state = 'send';
    tx = bitsOf(bytes);
  };

  const romCommand = (cmd: number) => {
    if (cmd === 0xcc) state = 'function';
    else if (cmd === 0x33) send(rom);
    else if (cmd === 0x55) state = 'match';
    else if (cmd === 0xf0) {
      state = 'search';
      searchBit = 0;
      searchSub = 0;
    } else state = 'idle'; // 0xEC alarm search: no alarm, stay silent
  };

  const functionCommand = (cmd: number) => {
    if (cmd === 0x44) {
      state = 'convert';
      converting = true;
      env.schedule(env.now() + conversionTime(resolutionOf(config)), 'converted');
    } else if (cmd === 0xbe) send(scratchpad(temp, th, tl, config));
    else if (cmd === 0x4e) state = 'write-scratchpad';
    else if (cmd === 0xb4) send([0xff]); // externally powered: reads 1
    else state = 'idle';
  };

  const written = (bit: number) => {
    rx.push(bit);
    if (state === 'rom' && rx.length === 8) {
      romCommand(byteOf(rx));
      rx = [];
    } else if (state === 'match' && rx.length === 64) {
      state = rx.every((b, i) => b === romBits[i]) ? 'function' : 'idle';
      rx = [];
    } else if (state === 'search') {
      rx = [];
      if (bit !== romBits[searchBit]) state = 'idle';
      else if (++searchBit === 64) state = 'function';
      else searchSub = 0;
    } else if (state === 'function' && rx.length === 8) {
      const cmd = byteOf(rx);
      rx = [];
      functionCommand(cmd);
    } else if (state === 'write-scratchpad' && rx.length === 24) {
      th = byteOf(rx.slice(0, 8));
      tl = byteOf(rx.slice(8, 16));
      config = (byteOf(rx.slice(16, 24)) & 0x60) | 0x1f;
      rx = [];
      state = 'idle';
    }
  };

  /** The bit the chip puts on the line in this read slot. */
  const readBit = (): number => {
    if (state === 'send') return tx.shift() ?? 1;
    if (state === 'convert') return converting ? 0 : 1;
    if (state === 'search' && searchSub < 2) return searchSub++ === 0 ? romBits[searchBit]! : 1 - romBits[searchBit]!;
    return 1;
  };
  const isReadState = () => state === 'send' || state === 'convert' || (state === 'search' && searchSub < 2);

  return {
    damaged: false,
    stamp(ctx) {
      if (powered && pulling) ctx.conductance('dq', 'gnd', 1 / R_LOW);
    },
    onSolved(op) {
      const vs = op.v('vdd') - op.v('gnd');
      const on = vs >= V_MIN;
      if (on !== powered) {
        powered = on;
        if (!on) {
          state = 'idle';
          pulling = false;
          converting = false;
        }
        env.invalidate();
      }
      if (!powered) return;
      const vd = op.v('dq') - op.v('gnd');
      if (!lineLow && vd < 0.3 * vs) {
        lineLow = true;
        lowSince = op.t;
        lowByUs = pulling;
        readSlot = false;
        if (!lowByUs && isReadState()) {
          readSlot = true;
          if (readBit() === 0) {
            setPull(true);
            env.schedule(op.t + READ_0_HOLD, `release:${generation}`);
          }
        }
      } else if (lineLow && vd > 0.7 * vs) {
        lineLow = false;
        if (lowByUs) return;
        const width = op.t - lowSince;
        if (width >= RESET_MIN) {
          generation++;
          state = 'rom';
          rx = [];
          tx = [];
          env.schedule(op.t + PRESENCE_WAIT, `presence:${generation}`);
        } else if (!readSlot && state !== 'idle') {
          written(width < WRITE_1_MAX ? 1 : 0);
        }
      }
    },
    onEvent(ev) {
      if (ev.kind !== 'timer') return;
      if (ev.tag === 'converted') {
        converting = false;
        conversions++;
        temp = encodeTemperature(props.temperature, resolutionOf(config));
      } else if (ev.tag === `presence:${generation}`) {
        setPull(true);
        env.schedule(env.now() + PRESENCE, `release:${generation}`);
      } else if (ev.tag === `release:${generation}`) {
        setPull(false);
      }
    },
    observables: () => ({
      powered,
      temperature: props.temperature,
      reading: (temp << 16 >> 16) / 16,
      resolution: resolutionOf(config),
      converting,
      conversions,
      rom: rom.map((b) => b.toString(16).padStart(2, '0')).join(''),
    }),
  };
}

/** TO-92: black half-cylinder on three legs, flat face forward. */
function view(_props: Ds18b20Props, obs: Record<string, unknown>): string {
  return `
    ${[0, 1, 2].map((x) => `<path d="M${x},0 V-1.1" stroke="#a7adb4" stroke-width="0.12"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <path d="M-0.55,-1.1 H2.55 V-3.1 A1.55,1.2 0 0 0 -0.55,-3.1 Z" fill="#1f2023" stroke="#000" stroke-width="0.04"/>
    <text x="1" y="-2.35" font-size="0.36" text-anchor="middle" fill="#c9ced6" font-family="ui-monospace, monospace">DS18B20</text>
    <text x="1" y="-1.75" font-size="0.3" text-anchor="middle" fill="#8b8d98" font-family="ui-monospace, monospace">${obs.converting === true ? '···' : `${Number(obs.temperature ?? 25)}°C`}</text>`;
}

export const ds18b20: PartModule<Ds18b20Props> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-0.8 -4.6 3.6 4.9',
  doc,
};
export default ds18b20;
