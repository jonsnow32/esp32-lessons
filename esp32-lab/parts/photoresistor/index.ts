import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface PhotoresistorProps {
  /** Illuminance on the cell (lux). */
  light: number;
  [key: string]: number;
}

// GL5528 datasheet: 10–20 kΩ at 10 lux, γ (log R10/R100) ≈ 0.6–0.7, ≥1 MΩ in the dark
const R_10LUX = 15_000;
const GAMMA = 0.7;
const R_DARK = 1_000_000;

/** Resistance of the cell at a given illuminance: a power law, capped by the dark resistance. */
export function ldrResistance(lux: number): number {
  return lux <= 0 ? R_DARK : Math.min(R_DARK, R_10LUX * (lux / 10) ** -GAMMA);
}

function create(props: PhotoresistorProps, _env: PartEnv): PartBehavior {
  const r = ldrResistance(props.light);
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let power = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      if (!damaged) ctx.conductance('a', 'b', 1 / r);
    },
    onSolved(op) {
      const v = op.v('a') - op.v('b');
      current = damaged ? 0 : v / r;
      power = v * current;
      if (overstress.update(power > manifest.ratings.powerMax, op.dt)) damaged = true;
    },
    observables: () => ({ resistance: r, current, damaged }),
  };
}

const defs = `
  <radialGradient id="ldr-face" cx="40%" cy="35%" r="75%">
    <stop offset="0" stop-color="#fff3d6"/><stop offset="1" stop-color="#e3c48c"/>
  </radialGradient>
  <clipPath id="ldr-clip"><circle cx="0.5" cy="-1.4" r="0.82"/></clipPath>`;

/** 5 mm LDR seen from above: ceramic disc with the orange zig-zag CdS track; it glows with the light level. */
function view(props: PhotoresistorProps, obs: Record<string, unknown>): string {
  const burnt = obs.damaged === true;
  // 0 at 1 lux, 1 at 10 000 lux
  const lit = Math.min(1, Math.max(0, Math.log10(Math.max(1, props.light)) / 4));
  const zig = 'M0.05,-1.9 H0.95 V-1.7 H0.05 V-1.5 H0.95 V-1.3 H0.05 V-1.1 H0.95 V-0.9 H0.05';
  return `
    <path d="M0,0 V-0.6" stroke="#a7adb4" stroke-width="0.11"/><path d="M1,0 V-0.6" stroke="#a7adb4" stroke-width="0.11"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="1" cy="0" r="0.13" fill="#5f646b"/>
    ${lit > 0.05 && !burnt ? `<circle cx="0.5" cy="-1.4" r="${1.1 + lit * 0.9}" fill="#ffe9a0" opacity="${lit * 0.45}"/>` : ''}
    <circle cx="0.5" cy="-1.4" r="0.95" fill="${burnt ? '#3a332a' : 'url(#ldr-face)'}" stroke="#b08a52" stroke-width="0.05"/>
    <path d="${zig}" fill="none" stroke="${burnt ? '#1c1c1c' : '#c4501f'}" stroke-width="0.11" clip-path="url(#ldr-clip)"/>
    <rect x="-0.32" y="-1.45" width="0.3" height="0.1" fill="#d9dde2"/><rect x="1.02" y="-1.45" width="0.3" height="0.1" fill="#d9dde2"/>`;
}

export const photoresistor: PartModule<PhotoresistorProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.9 -2.8 2.8 3.1',
  doc,
};
export default photoresistor;
