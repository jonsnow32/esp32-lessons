import { MS, US, type PartBehavior, type PartEnv, type PartModule, type SimTime } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface DhtProps {
  model: 'DHT11' | 'DHT22';
  temperature: number;
  humidity: number;
  [key: string]: string | number;
}

const V_MIN = 3.0;
/** Open-drain pull-down strength of the DATA output. */
const R_LOW = 50;
/** How long the host must hold DATA low to wake each model. */
const START_LOW = { DHT11: 18 * MS, DHT22: 0.8 * MS };

/** The 5 bytes the sensor sends: humidity, temperature, checksum. Readings clamp to the model's range. */
export function dhtFrame(model: DhtProps['model'], temperature: number, humidity: number): number[] {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  let bytes: number[];
  if (model === 'DHT11') {
    bytes = [Math.round(clamp(humidity, 20, 90)), 0, Math.round(clamp(temperature, 0, 50)), 0];
  } else {
    const h = Math.round(clamp(humidity, 0, 100) * 10);
    const t = Math.round(clamp(temperature, -40, 80) * 10);
    const tw = (Math.abs(t) & 0x7fff) | (t < 0 ? 0x8000 : 0);
    bytes = [h >> 8, h & 0xff, tw >> 8, tw & 0xff];
  }
  return [...bytes, bytes.reduce((a, b) => a + b, 0) & 0xff];
}

/** The reply as (pull DATA low?, duration) steps: response 80/80 µs, then 50 µs low + 27 or 70 µs high per bit. */
export function dhtWaveform(frame: number[]): [boolean, SimTime][] {
  const out: [boolean, SimTime][] = [[true, 80 * US], [false, 80 * US]];
  for (const byte of frame) {
    for (let bit = 7; bit >= 0; bit--) out.push([true, 50 * US], [false, ((byte >> bit) & 1 ? 70 : 27) * US]);
  }
  out.push([true, 50 * US]);
  return out;
}

/**
 * Waits for the host's start signal (DATA held low long enough, then released), then answers
 * 20–40 µs later by pulling DATA low in the pattern above. DATA is open drain: when the sensor
 * lets go, only a pull-up brings it HIGH.
 */
function create(props: DhtProps, env: PartEnv): PartBehavior {
  let powered = false;
  let lineLow = false;
  let lowSince = 0;
  let pulling = false;
  let wave: [boolean, SimTime][] | null = null;
  let generation = 0;
  let replies = 0;

  const setPull = (value: boolean) => {
    if (pulling !== value) {
      pulling = value;
      env.invalidate();
    }
  };

  return {
    damaged: false,
    stamp(ctx) {
      if (powered && pulling) ctx.conductance('data', 'gnd', 1 / R_LOW);
    },
    onSolved(op) {
      const vs = op.v('vcc') - op.v('gnd');
      const on = vs >= V_MIN;
      if (on !== powered) {
        powered = on;
        if (!on) {
          wave = null;
          pulling = false;
        }
        env.invalidate();
      }
      // Only the host's own pulses count while the sensor is quiet
      if (wave || !powered) return;
      const vd = op.v('data') - op.v('gnd');
      if (!lineLow && vd < 0.3 * vs) {
        lineLow = true;
        lowSince = op.t;
      } else if (lineLow && vd > 0.7 * vs) {
        lineLow = false;
        if (op.t - lowSince >= START_LOW[props.model]) {
          wave = dhtWaveform(dhtFrame(props.model, props.temperature, props.humidity));
          generation++;
          env.schedule(op.t + 30 * US, `step:${generation}:0`);
        }
      }
    },
    onEvent(ev) {
      if (ev.kind !== 'timer' || !wave) return;
      const m = /^step:(\d+):(\d+)$/.exec(ev.tag);
      if (!m || Number(m[1]) !== generation) return;
      const i = Number(m[2]);
      const step = wave[i];
      if (!step) {
        // Done: let go of the line and wait for the next start signal
        wave = null;
        lineLow = false;
        replies++;
        setPull(false);
        return;
      }
      setPull(step[0]);
      env.schedule(env.now() + step[1], `step:${generation}:${i + 1}`);
    },
    observables: () => ({ powered, sending: wave !== null, replies, temperature: props.temperature, humidity: props.humidity }),
  };
}

/** The perforated plastic case (blue DHT11, white DHT22) on four legs; a small mark while it talks. */
function view(props: DhtProps, obs: Record<string, unknown>): string {
  const dht22 = props.model === 'DHT22';
  const body = dht22 ? '#f3f2ee' : '#2f80d1';
  const edge = dht22 ? '#b9b6ac' : '#1b5a99';
  const hole = dht22 ? '#c9c6bc' : '#1c4f86';
  const h = dht22 ? 7.2 : 6;
  const grill = Array.from({ length: dht22 ? 6 : 5 }, (_, r) =>
    Array.from({ length: 4 }, (_, c) => `<rect x="${-0.35 + c * 0.95}" y="${-h - 0.1 + 0.6 + r * 0.85}" width="0.6" height="0.45" rx="0.08" fill="${hole}"/>`).join(''),
  ).join('');
  return `
    ${[0, 1, 2, 3].map((x) => `<path d="M${x},0 V-0.6" stroke="#a7adb4" stroke-width="0.12"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.75" y="${-h - 0.1}" width="4.5" height="${h - 0.5}" rx="0.18" fill="${body}" stroke="${edge}" stroke-width="0.06"/>
    ${grill}
    <text x="1.5" y="-1.05" font-size="0.48" font-weight="700" text-anchor="middle" fill="${dht22 ? '#5b5e66' : '#e6f0ff'}" font-family="ui-monospace, monospace">${props.model}</text>
    ${obs.sending === true ? `<circle cx="3.35" cy="-1.2" r="0.18" fill="#30a46c"/>` : ''}`;
}

export const dht: PartModule<DhtProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-1 -7.6 5 7.9',
  doc,
};
export default dht;
