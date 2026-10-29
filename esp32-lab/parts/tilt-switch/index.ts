import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface TiltSwitchProps {
  tilted: boolean;
  [key: string]: boolean;
}

// The balls touch the contacts through a few ohms; tilted, nothing but leakage
const R_CLOSED = 2;
const G_OPEN = 1e-12;

/** Closed when upright, open when tilted. The tilt is a prop so it survives rebuilds. */
function create(props: TiltSwitchProps, _env: PartEnv): PartBehavior {
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let damaged = false;
  const closed = () => !props.tilted && !damaged;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      ctx.conductance('a', 'b', closed() ? 1 / R_CLOSED : G_OPEN);
    },
    onSolved(op) {
      if (!closed()) {
        current = 0;
        return;
      }
      current = (op.v('a') - op.v('b')) / R_CLOSED;
      if (overstress.update(Math.abs(current) > manifest.ratings.currentMax, op.dt)) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({ closed: closed(), current, damaged }),
  };
}

const defs = `
  <linearGradient id="tilt-can" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#7d848c"/><stop offset="0.4" stop-color="#eef0f2"/><stop offset="1" stop-color="#8b9299"/>
  </linearGradient>`;

/** Silver can on two legs; it leans over and the ball inside rolls away from the contacts when tilted. */
function view(props: TiltSwitchProps, obs: Record<string, unknown>): string {
  const tilted = props.tilted;
  const burnt = obs.damaged === true;
  return `
    <path d="M0,0 V-0.6" stroke="#a7adb4" stroke-width="0.1"/><path d="M1,0 V-0.6" stroke="#a7adb4" stroke-width="0.1"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="1" cy="0" r="0.13" fill="#5f646b"/>
    <g transform="rotate(${tilted ? 35 : 0} 0.5 -0.6)">
      <rect x="-0.05" y="-0.75" width="1.1" height="0.2" fill="#1f2023"/>
      <rect x="0" y="-2.75" width="1" height="2.05" rx="0.12" fill="${burnt ? '#3a3a3a' : 'url(#tilt-can)'}" stroke="#5f666e" stroke-width="0.04"/>
      <circle cx="${tilted ? 0.5 : 0.5}" cy="${tilted ? -2.4 : -1.05}" r="0.26" fill="#c9ced6" stroke="#6f767e" stroke-width="0.04" opacity="0.9"/>
    </g>`;
}

export const tiltSwitch: PartModule<TiltSwitchProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.9 -3.1 2.8 3.4',
  control: { kind: 'toggle', prop: 'tilted', cx: 0.5, cy: -1.7, r: 0.9 },
  doc,
};
export default tiltSwitch;
