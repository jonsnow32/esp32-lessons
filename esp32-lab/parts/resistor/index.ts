import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export interface ResistorProps {
  resistance: number;
  [key: string]: number;
}

function create(props: ResistorProps, _env: PartEnv): PartBehavior {
  const r = props.resistance;
  const powerMax = manifest.ratings.powerMax;
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let power = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      // A burnt resistor goes open circuit
      if (!damaged) ctx.conductance('a', 'b', 1 / r);
    },
    onSolved(op) {
      const v = op.v('a') - op.v('b');
      current = damaged ? 0 : v / r;
      power = v * current;
      if (overstress.update(power > powerMax, op.dt)) damaged = true;
    },
    observables: () => ({ current, power, damaged }),
  };
}

const BAND = ['#000', '#7a4a1e', '#d00', '#f60', '#ee0', '#0a0', '#00c', '#80c', '#888', '#fff'];

/** Colour bands for the value: two digits and a multiplier, then gold for ±5 %. */
export function bands(ohms: number): string[] {
  const exp = Math.max(0, Math.floor(Math.log10(ohms)) - 1);
  const digits = Math.round(ohms / 10 ** exp);
  return [BAND[Math.floor(digits / 10) % 10]!, BAND[digits % 10]!, BAND[exp % 10]!, '#c9a227'];
}

function view(props: ResistorProps, obs: Record<string, unknown>): string {
  const hot = obs.damaged === true;
  const b = bands(props.resistance);
  return `
    <line x1="0" y1="0" x2="4" y2="0" stroke="#9aa0a6" stroke-width="0.09"/>
    <rect x="1" y="-0.32" width="2" height="0.64" rx="0.25" fill="${hot ? '#4a3b2a' : '#e8d3a9'}" stroke="#00000040" stroke-width="0.04"/>
    ${b.map((c, k) => `<rect x="${1.3 + k * 0.38}" y="-0.32" width="0.16" height="0.64" fill="${c}"/>`).join('')}`;
}

export const resistor: PartModule<ResistorProps> = { manifest: manifest as PartModule['manifest'], create, view };
export default resistor;
