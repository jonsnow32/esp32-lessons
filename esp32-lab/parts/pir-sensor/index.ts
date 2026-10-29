import { S, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface PirSensorProps {
  /** Seconds OUT stays HIGH after motion stops (the Tx trimmer). */
  hold: number;
  [key: string]: number;
}

/** The BISS0001 board runs from its own 3.3 V regulator, which needs about 4.5 V in. */
const V_MIN = 4.5;
const V_OUT = 3.3;
/** OUT is driven through about 1 kΩ on the module. */
const R_OUT = 1_000;

/**
 * Holding the dome is someone moving in front of it: OUT goes HIGH at once and stays HIGH for
 * `hold` seconds after the last movement. OUT floats while the module has no power.
 */
function create(props: PirSensorProps, env: PartEnv): PartBehavior {
  let moving = false;
  let high = false;
  let powered = false;
  // Bumped on every movement so an older hold timer cannot end a newer detection
  let generation = 0;

  const setHigh = (value: boolean) => {
    if (high !== value) {
      high = value;
      env.invalidate();
    }
  };

  return {
    damaged: false,
    stamp(ctx) {
      if (!powered) return;
      // Norton equivalent of V_OUT behind R_OUT when HIGH, R_OUT to ground when LOW
      ctx.conductance('out', 'gnd', 1 / R_OUT);
      if (high) ctx.current('gnd', 'out', V_OUT / R_OUT);
    },
    onSolved(op) {
      const on = op.v('vcc') - op.v('gnd') >= V_MIN;
      if (on !== powered) {
        powered = on;
        env.invalidate();
      }
    },
    onEvent(ev) {
      if (ev.kind === 'press') {
        moving = true;
        generation++;
        setHigh(true);
      } else if (ev.kind === 'release') {
        moving = false;
        env.schedule(env.now() + props.hold * S, `hold:${generation}`);
      } else if (ev.kind === 'timer' && ev.tag === `hold:${generation}` && !moving) {
        setHigh(false);
      }
    },
    observables: () => ({ powered, motion: moving, output: powered && high }),
  };
}

const defs = `
  <radialGradient id="pir-dome" cx="40%" cy="35%" r="70%">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.75" stop-color="#e7e5df"/><stop offset="1" stop-color="#c8c5bc"/>
  </radialGradient>
  <clipPath id="pir-clip"><circle cx="1" cy="-3.15" r="1.75"/></clipPath>`;

/** Green module seen from above with the white Fresnel dome; the dome glows while OUT is HIGH. */
function view(_props: PirSensorProps, obs: Record<string, unknown>): string {
  const on = obs.output === true;
  const facets = [-1.2, -0.6, 0, 0.6, 1.2].map((d) => `<path d="M${1 + d},-4.9 V-1.4" stroke="#bdb9ae" stroke-width="0.04"/><path d="M-0.75,${-3.15 + d} H2.75" stroke="#bdb9ae" stroke-width="0.04"/>`).join('');
  return `
    ${[0, 1, 2].map((x) => `<path d="M${x},0 V-0.5" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-1.6" y="-5.6" width="5.2" height="5.1" rx="0.15" fill="#1f6f3f" stroke="#0f4426" stroke-width="0.05"/>
    ${on ? '<circle cx="1" cy="-3.15" r="2.3" fill="#ffd43b" opacity="0.4"/>' : ''}
    <rect x="-0.85" y="-5" width="3.7" height="3.7" fill="#f2f0ea" stroke="#9b978c" stroke-width="0.04"/>
    <circle cx="1" cy="-3.15" r="1.75" fill="url(#pir-dome)" stroke="#a9a59a" stroke-width="0.05"/>
    <g clip-path="url(#pir-clip)">${facets}</g>
    <circle cx="-1.2" cy="-5.2" r="0.25" fill="#e6b84a"/><circle cx="3.2" cy="-5.2" r="0.25" fill="#e6b84a"/>
    <text x="1" y="-0.75" font-size="0.4" text-anchor="middle" fill="#cfe8d8" font-family="ui-monospace, monospace">+  O  −</text>`;
}

export const pirSensor: PartModule<PirSensorProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-1.8 -5.8 5.6 6.1',
  // Holding the dome is someone walking past
  control: { kind: 'press', cx: 1, cy: -3.15, r: 1.75 },
  doc,
};
export default pirSensor;
