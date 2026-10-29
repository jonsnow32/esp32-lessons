import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface PotentiometerProps {
  resistance: number;
  /** Knob position, 0–100 % from end a to end b. */
  position: number;
  [key: string]: number;
}

/** Contact resistance where the wiper meets the end of the track. */
const R_END = 20;

/**
 * Two resistors in series sharing the wiper: a–wiper is position × R, wiper–b the rest. Each half
 * keeps R_END so the knob turned fully to one end is a low resistance, not a short.
 */
function create(props: PotentiometerProps, _env: PartEnv): PartBehavior {
  const r = props.resistance;
  const k = Math.min(1, Math.max(0, props.position / 100));
  const ra = r * k + R_END;
  const rb = r * (1 - k) + R_END;
  const powerMax = manifest.ratings.powerMax;
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let wiperVolts = 0;
  let power = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      // A burnt track goes open circuit
      if (damaged) return;
      ctx.conductance('a', 'wiper', 1 / ra);
      ctx.conductance('wiper', 'b', 1 / rb);
    },
    onSolved(op) {
      const va = op.v('a');
      const vw = op.v('wiper');
      const vb = op.v('b');
      wiperVolts = vw;
      if (damaged) return;
      const ia = (va - vw) / ra;
      const ib = (vw - vb) / rb;
      current = Math.max(Math.abs(ia), Math.abs(ib));
      power = ia * ia * ra + ib * ib * rb;
      if (overstress.update(power > powerMax, op.dt)) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({ current, power, wiper: wiperVolts, damaged }),
  };
}

const defs = `
  <radialGradient id="pot-knob" cx="40%" cy="35%" r="75%">
    <stop offset="0" stop-color="#5b9cf0"/><stop offset="0.7" stop-color="#2459b8"/><stop offset="1" stop-color="#173c80"/>
  </radialGradient>
  <linearGradient id="pot-body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e9ecef"/><stop offset="1" stop-color="#9aa1a9"/>
  </linearGradient>`;

/**
 * Breadboard trimmer potentiometer: three legs in a row, a square body and a round knob with a
 * pointer that sweeps 270° (−135° at end a, +135° at end b).
 */
function view(props: PotentiometerProps, obs: Record<string, unknown>): string {
  const burnt = obs.damaged === true;
  const angle = -135 + Math.min(100, Math.max(0, props.position)) * 2.7;
  return `
    ${[0, 1, 2].map((x) => `<path d="M${x},0 V-0.5" stroke="#a7adb4" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.35" y="-2.9" width="2.7" height="2.45" rx="0.15" fill="${burnt ? '#3a3a3a' : 'url(#pot-body)'}" stroke="#6f767e" stroke-width="0.04"/>
    <circle cx="1" cy="-1.68" r="1.02" fill="#1f2023" opacity="0.35"/>
    <g transform="translate(1,-1.72) rotate(${angle})">
      <circle r="0.95" fill="${burnt ? '#262626' : 'url(#pot-knob)'}" stroke="#0f2a5c" stroke-width="0.05"/>
      ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="-0.05" y="-0.95" width="0.1" height="0.16" fill="#173c80" transform="rotate(${a})"/>`).join('')}
      <rect x="-0.07" y="-0.85" width="0.14" height="0.62" rx="0.05" fill="#f2f5f9"/>
    </g>
    <path d="M0.42,-2.25 A0.8,0.8 0 0 1 1.1,-2.55" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="0.08" stroke-linecap="round"/>`;
}

export const potentiometer: PartModule<PotentiometerProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.6 -3.1 3.2 3.4',
  doc,
};
export default potentiometer;
