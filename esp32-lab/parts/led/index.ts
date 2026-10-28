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

const FILL: Record<LedColor, string> = {
  red: '#e5484d',
  yellow: '#f5d90a',
  green: '#30a46c',
  blue: '#3e63dd',
  white: '#f1f3f5',
};

function view(props: LedProps, obs: Record<string, unknown>): string {
  const color = FILL[props.color] ?? FILL.red;
  const glow = Math.min(1, Number(obs.brightness ?? 0));
  const dead = obs.damaged === true;
  const body = dead ? '#3a3a3a' : color;
  return `
    <line x1="0" y1="0" x2="0" y2="-0.9" stroke="#9aa0a6" stroke-width="0.09"/>
    <line x1="1" y1="0" x2="1" y2="-0.75" stroke="#9aa0a6" stroke-width="0.09"/>
    ${glow > 0.01 && !dead ? `<circle cx="0.5" cy="-1.35" r="${0.9 + glow * 0.6}" fill="${color}" opacity="${0.15 + glow * 0.45}" filter="url(#glow)"/>` : ''}
    <path d="M0.05,-0.85 L0.05,-1.45 A0.45,0.45 0 0 1 0.95,-1.45 L0.95,-0.85 Z" fill="${body}" fill-opacity="${dead ? 1 : 0.55 + glow * 0.45}" stroke="${dead ? '#111' : '#00000055'}" stroke-width="0.05"/>
    <rect x="-0.05" y="-0.9" width="1.1" height="0.12" rx="0.04" fill="${body}" opacity="0.9"/>
    ${dead ? `<g class="smoke"><circle cx="0.4" cy="-2" r="0.35" fill="#888" opacity="0.5"/><circle cx="0.7" cy="-2.6" r="0.45" fill="#999" opacity="0.35"/></g>` : ''}
    <text x="-0.25" y="0.55" font-size="0.45" fill="#666">+</text>`;
}

export const led: PartModule<LedProps> = { manifest: manifest as PartModule['manifest'], create, view };
export default led;
