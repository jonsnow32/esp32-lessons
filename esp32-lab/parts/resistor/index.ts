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

const defs = `
  <linearGradient id="res-body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f3dfb8"/><stop offset="0.45" stop-color="#d9b47f"/><stop offset="1" stop-color="#a98656"/>
  </linearGradient>
  <linearGradient id="res-burnt" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5a4632"/><stop offset="1" stop-color="#241a12"/>
  </linearGradient>
  <linearGradient id="res-shade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.3"/>
  </linearGradient>
  <linearGradient id="res-lead" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f3"/><stop offset="1" stop-color="#868c94"/></linearGradient>`;

/** Axial 1/4 W resistor: leads into holes 4 pitches apart, dog-bone body, colour bands. */
function view(props: ResistorProps, obs: Record<string, unknown>): string {
  const burnt = obs.damaged === true;
  const b = bands(props.resistance);
  // Dog-bone outline: bulges at both ends, waist in the middle
  const body = 'M0.95,-0.34 Q0.95,-0.42 1.15,-0.42 H1.45 Q1.6,-0.34 1.75,-0.34 H2.25 Q2.4,-0.34 2.55,-0.42 H2.85 Q3.05,-0.42 3.05,-0.34 V0.34 Q3.05,0.42 2.85,0.42 H2.55 Q2.4,0.34 2.25,0.34 H1.75 Q1.6,0.34 1.45,0.42 H1.15 Q0.95,0.42 0.95,0.34 Z';
  const xs = [1.25, 1.62, 1.95, 2.72];
  return `
    <path d="M0,0 H4" stroke="url(#res-lead)" stroke-width="0.12" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="4" cy="0" r="0.13" fill="#5f646b"/>
    <path d="${body}" fill="url(#${burnt ? 'res-burnt' : 'res-body'})" stroke="#7a5f3c" stroke-width="0.03"/>
    ${burnt ? '' : b.map((c, k) => `<rect x="${xs[k]}" y="-0.42" width="${k === 3 ? 0.12 : 0.15}" height="0.84" fill="${c}"/>`).join('')}
    <path d="${body}" fill="url(#res-shade)"/>`;
}

export const resistor: PartModule<ResistorProps> = { manifest: manifest as PartModule['manifest'], create, view, defs };
export default resistor;
