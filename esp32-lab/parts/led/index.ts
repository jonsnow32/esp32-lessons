import { Overstress, pnjlim, VT, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export type LedColor = 'red' | 'yellow' | 'green' | 'blue' | 'white';

export interface LedProps {
  color: LedColor;
  [key: string]: string;
}

/** Typical forward voltage at 20 mA for 5 mm LEDs. */
export const FORWARD_VOLTAGE: Record<LedColor, number> = {
  red: 1.8,
  yellow: 2.0,
  green: 2.1,
  blue: 3.0,
  white: 3.0,
};

const I_REF = 0.02;
const EMISSION = 2; // ideality factor n
const N_VT = EMISSION * VT;
const G_MIN = 1e-12; // keeps the matrix regular when the LED is off

/** Shockley diode current and its derivative. */
function diode(vd: number, is: number): { i: number; g: number } {
  const e = Math.exp(vd / N_VT);
  return { i: is * (e - 1), g: (is * e) / N_VT };
}

function create(props: LedProps, _env: PartEnv): PartBehavior {
  const vf = FORWARD_VOLTAGE[props.color] ?? FORWARD_VOLTAGE.red;
  // Saturation current chosen so I(vf) = 20 mA
  const is = I_REF / Math.exp(vf / N_VT);
  const vCrit = N_VT * Math.log(N_VT / (Math.SQRT2 * is));
  const { currentMax, currentAbsMax, reverseVoltageMax, overstressTime } = manifest.ratings;
  const overstress = new Overstress(overstressTime);

  let vdLast = 0;
  let current = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stampNonlinear(ctx) {
      // A destroyed LED is modelled as open circuit (the usual failure mode)
      if (damaged) return;
      const vRaw = ctx.v('anode') - ctx.v('cathode');
      const vd = pnjlim(vRaw, vdLast, N_VT, vCrit);
      if (vd !== vRaw) ctx.limited();
      vdLast = vd;
      const { i, g } = diode(vd, is);
      // Companion model: I(v) ≈ g·v + (i − g·vd)
      ctx.conductance('anode', 'cathode', g + G_MIN);
      ctx.current('anode', 'cathode', i - g * vd);
    },
    onSolved(op) {
      if (damaged) return;
      const vd = op.v('anode') - op.v('cathode');
      current = diode(vd, is).i;
      if (
        current > currentAbsMax ||
        -vd > reverseVoltageMax ||
        overstress.update(current > currentMax, op.dt)
      ) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({
      current,
      // Perceived brightness: roughly linear in current, saturating at the rated current
      brightness: damaged ? 0 : Math.min(1, Math.max(0, current) / I_REF),
      damaged,
    }),
  };
}

/** Lens tint (unlit) and emitted colour for each LED colour. */
const COLORS: Record<LedColor, { lens: string; light: string }> = {
  red: { lens: '#d8343a', light: '#ff4a3d' },
  yellow: { lens: '#e8c21a', light: '#ffe14d' },
  green: { lens: '#2f9e5e', light: '#5dff8f' },
  blue: { lens: '#3557c7', light: '#5aa0ff' },
  white: { lens: '#e6e9ee', light: '#ffffff' },
};

const defs = Object.entries(COLORS)
  .map(
    ([name, c]) => `
  <radialGradient id="led-lens-${name}" cx="35%" cy="30%" r="80%">
    <stop offset="0" stop-color="#fff" stop-opacity="0.55"/>
    <stop offset="0.25" stop-color="${c.lens}" stop-opacity="0.75"/>
    <stop offset="1" stop-color="${c.lens}" stop-opacity="0.95"/>
  </radialGradient>
  <radialGradient id="led-glow-${name}">
    <stop offset="0" stop-color="${c.light}" stop-opacity="0.9"/>
    <stop offset="0.35" stop-color="${c.light}" stop-opacity="0.35"/>
    <stop offset="1" stop-color="${c.light}" stop-opacity="0"/>
  </radialGradient>`,
  )
  .join('') +
  `<linearGradient id="led-lead" x1="0" x2="1"><stop offset="0" stop-color="#8d939b"/><stop offset="0.5" stop-color="#e3e6ea"/><stop offset="1" stop-color="#80868e"/></linearGradient>`;

/**
 * A 5 mm LED standing on its legs: anode (long, kinked leg) at (0,0), cathode at (1,0) on the
 * side of the flat. Lit LEDs show a bright die and a halo scaled by brightness.
 */
function view(props: LedProps, obs: Record<string, unknown>): string {
  const name = COLORS[props.color] ? props.color : 'red';
  const c = COLORS[name];
  const glow = Math.min(1, Number(obs.brightness ?? 0));
  const dead = obs.damaged === true;
  const lit = glow > 0.02 && !dead;
  return `
    <path d="M0,0 V-0.55 l-0.12,-0.18 l0.12,-0.18 V-1.05" fill="none" stroke="url(#led-lead)" stroke-width="0.11" stroke-linejoin="round"/>
    <path d="M1,0 V-1.05" stroke="url(#led-lead)" stroke-width="0.11"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="1" cy="0" r="0.13" fill="#5f646b"/>
    ${lit ? `<circle cx="0.5" cy="-2.2" r="${1.8 + glow * 2.2}" fill="url(#led-glow-${name})" opacity="${0.55 + glow * 0.45}"/>` : ''}
    <path d="M-0.62,-1.05 H1.48 V-1.3 H-0.62 Z" fill="${dead ? '#2a2a2a' : c.lens}" opacity="0.9"/>
    <path d="M-0.5,-1.3 V-2.45 A1,1 0 0 1 1.5,-2.45 V-1.3 Z" fill="${dead ? '#262626' : `url(#led-lens-${name})`}" stroke="#00000040" stroke-width="0.04"/>
    <path d="M0.18,-1.3 V-1.7 H0.45 L0.6,-1.95 H0.82 V-1.3" fill="none" stroke="#6c7076" stroke-width="0.06" opacity="0.8"/>
    ${lit ? `<ellipse cx="0.52" cy="-1.9" rx="0.32" ry="0.2" fill="${c.light}" opacity="${0.6 + glow * 0.4}"/>` : ''}
    <path d="M-0.25,-2.55 A0.75,0.75 0 0 1 0.25,-3.25" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="0.09" stroke-linecap="round"/>
    ${dead ? `<g opacity="0.55"><circle cx="0.3" cy="-3.6" r="0.4" fill="#8a8a8a"/><circle cx="0.8" cy="-4.2" r="0.55" fill="#a0a0a0"/><circle cx="0.4" cy="-4.9" r="0.45" fill="#b5b5b5"/></g>` : ''}`;
}

export const led: PartModule<LedProps> = { manifest: manifest as PartModule['manifest'], create, view, defs };
export default led;
