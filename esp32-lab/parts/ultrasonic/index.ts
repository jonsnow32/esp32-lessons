import { US, MS, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface UltrasonicProps {
  /** Distance to the object in front of the transducers (cm). */
  distance: number;
  [key: string]: number;
}

const V_MIN = 4.5;
/** TTL input thresholds of the module's trigger input. */
const V_IH = 2.0;
const V_IL = 0.8;
const R_OUT = 100;
/** Shortest trigger pulse the module answers. */
const TRIG_MIN = 10 * US;
/** Eight 40 kHz cycles go out before Echo rises. */
const BURST = 8 * 25 * US + 50 * US;
/** Round trip of sound per cm at 343 m/s. */
const US_PER_CM = 58.3;
const RANGE_MIN = 2;
const RANGE_MAX = 400;
/** Nothing heard back: Echo gives up after this long. */
const TIMEOUT = 38 * MS;

/** How long Echo stays HIGH for an object at `cm`. */
export function echoWidth(cm: number): number {
  if (cm > RANGE_MAX) return TIMEOUT;
  return Math.round(Math.max(RANGE_MIN, cm) * US_PER_CM * US);
}

/**
 * A falling edge on Trig after at least 10 µs HIGH starts one measurement: the burst, then Echo
 * HIGH for the round-trip time. Triggers during a measurement are ignored, as on the real module.
 */
function create(props: UltrasonicProps, env: PartEnv): PartBehavior {
  let powered = false;
  let trigHigh = false;
  let trigSince = 0;
  let measuring = false;
  let echo = false;
  let generation = 0;

  const setEcho = (value: boolean) => {
    if (echo !== value) {
      echo = value;
      env.invalidate();
    }
  };

  return {
    damaged: false,
    stamp(ctx) {
      if (!powered) return;
      ctx.conductance('echo', echo ? 'vcc' : 'gnd', 1 / R_OUT);
    },
    onSolved(op) {
      const on = op.v('vcc') - op.v('gnd') >= V_MIN;
      if (on !== powered) {
        powered = on;
        if (!on) {
          measuring = false;
          echo = false;
        }
        env.invalidate();
      }
      const vt = op.v('trig') - op.v('gnd');
      if (!trigHigh && vt >= V_IH) {
        trigHigh = true;
        trigSince = op.t;
      } else if (trigHigh && vt <= V_IL) {
        trigHigh = false;
        if (powered && !measuring && op.t - trigSince >= TRIG_MIN) {
          measuring = true;
          generation++;
          env.schedule(op.t + BURST, `echo:${generation}`);
        }
      }
    },
    onEvent(ev) {
      if (ev.kind !== 'timer' || !measuring) return;
      if (ev.tag === `echo:${generation}`) {
        setEcho(true);
        env.schedule(env.now() + echoWidth(props.distance), `done:${generation}`);
      } else if (ev.tag === `done:${generation}`) {
        measuring = false;
        setEcho(false);
      }
    },
    observables: () => ({ powered, distance: props.distance, measuring, echo }),
  };
}

const defs = `
  <radialGradient id="sr04-mesh" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#3a3d42"/><stop offset="0.85" stop-color="#2a2c30"/><stop offset="1" stop-color="#15161a"/>
  </radialGradient>
  <linearGradient id="sr04-can" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f1f3f5"/><stop offset="1" stop-color="#9aa1a9"/>
  </linearGradient>`;

/** Blue board with the two silver transducers ("eyes"); sound arcs go out while measuring. */
function view(props: UltrasonicProps, obs: Record<string, unknown>): string {
  const eye = (cx: number) => `
    <circle cx="${cx}" cy="-3.2" r="1.95" fill="url(#sr04-can)" stroke="#6f767e" stroke-width="0.05"/>
    <circle cx="${cx}" cy="-3.2" r="1.55" fill="url(#sr04-mesh)"/>
    <circle cx="${cx}" cy="-3.2" r="1.55" fill="none" stroke="#55595f" stroke-width="0.05" stroke-dasharray="0.08 0.12"/>`;
  const arcs = obs.measuring === true
    ? [0, 1, 2].map((k) => `<path d="M${-1.2 - k * 0.3},${-5.6 - k * 0.45} Q1.5,${-7 - k * 0.55} ${4.2 + k * 0.3},${-5.6 - k * 0.45}" fill="none" stroke="#3e63dd" stroke-width="0.1" stroke-linecap="round" opacity="${0.8 - k * 0.22}"/>`).join('')
    : '';
  return `
    ${[0, 1, 2, 3].map((x) => `<path d="M${x},0 V-0.5" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-3.5" y="-5.6" width="10" height="5.1" rx="0.15" fill="#1d4f9c" stroke="#0f2f63" stroke-width="0.05"/>
    ${eye(-1.2)}${eye(4.2)}
    <rect x="0.65" y="-4.4" width="1.7" height="0.9" rx="0.08" fill="#c9ced6" stroke="#6f767e" stroke-width="0.04"/>
    <text x="1.5" y="-1.6" font-size="0.42" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">HC-SR04</text>
    <text x="1.5" y="-0.75" font-size="0.32" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">Vcc Trig Echo Gnd</text>
    <text x="1.5" y="-3.75" font-size="0.4" text-anchor="middle" fill="#1c2024" font-family="ui-monospace, monospace">${Math.round(props.distance)}cm</text>
    ${arcs}`;
}

export const ultrasonic: PartModule<UltrasonicProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-3.7 -7.4 10.4 7.7',
  doc,
};
export default ultrasonic;
