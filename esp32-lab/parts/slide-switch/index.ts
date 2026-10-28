import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export interface SlideSwitchProps {
  /** Which outer leg the common leg is connected to. */
  position: 'a' | 'b';
  [key: string]: string;
}

const R_CLOSED = 0.05;
const G_OPEN = 1e-12;

/** Single pole, double throw: common joins a or b. The position is a prop, so it survives rebuilds. */
function create(props: SlideSwitchProps, _env: PartEnv): PartBehavior {
  const toB = props.position === 'b';
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      // A burnt contact stays open in both positions
      ctx.conductance('common', 'a', !toB && !damaged ? 1 / R_CLOSED : G_OPEN);
      ctx.conductance('common', 'b', toB && !damaged ? 1 / R_CLOSED : G_OPEN);
    },
    onSolved(op) {
      if (damaged) return;
      current = (op.v('common') - op.v(toB ? 'b' : 'a')) / R_CLOSED;
      if (overstress.update(Math.abs(current) > manifest.ratings.currentMax, op.dt)) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({ position: props.position, current, damaged }),
  };
}

const defs = `
  <linearGradient id="switch-shell" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e9ecef"/><stop offset="0.5" stop-color="#b3b9c0"/><stop offset="1" stop-color="#7d848c"/>
  </linearGradient>`;

/** Mini slide switch: metal shell over the three legs with a black lever on top. */
function view(props: SlideSwitchProps, _obs: Record<string, unknown>): string {
  const x = props.position === 'b' ? 1.25 : 0.15;
  return `
    ${[0, 1, 2].map((l) => `<path d="M${l},0 V-0.45" stroke="#a7adb4" stroke-width="0.14"/><circle cx="${l}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.55" y="-1.35" width="3.1" height="0.95" rx="0.08" fill="url(#switch-shell)" stroke="#6f767e" stroke-width="0.04"/>
    <rect x="0.05" y="-1.2" width="1.9" height="0.65" rx="0.06" fill="#2a2c30"/>
    <rect x="${x}" y="-1.95" width="0.6" height="1.25" rx="0.1" fill="#1b1c1f" stroke="#000" stroke-width="0.04"/>
    <rect x="${x + 0.1}" y="-1.85" width="0.4" height="0.3" rx="0.05" fill="#44474d"/>
    <text x="0.05" y="-2.15" font-size="0.42" fill="#6f767e" font-family="ui-monospace, monospace">a</text>
    <text x="1.65" y="-2.15" font-size="0.42" fill="#6f767e" font-family="ui-monospace, monospace">b</text>`;
}

export const slideSwitch: PartModule<SlideSwitchProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.8 -2.6 3.6 2.9',
  // Tapping anywhere on the shell slides the lever across
  control: { kind: 'toggle', prop: 'position', cx: 1, cy: -1.2, r: 0.95 },
};
export default slideSwitch;
