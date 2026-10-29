import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface ThermistorProps {
  /** Temperature of the bead (°C). */
  temperature: number;
  [key: string]: number;
}

// Common 10 kΩ NTC (MF52-103, B25/50 = 3950)
const R25 = 10_000;
const BETA = 3950;
const T25 = 298.15;

/** Beta model: R = R25 · exp(B · (1/T − 1/T25)). */
export function ntcResistance(celsius: number): number {
  return R25 * Math.exp(BETA * (1 / (celsius + 273.15) - 1 / T25));
}

function create(props: ThermistorProps, _env: PartEnv): PartBehavior {
  const r = ntcResistance(props.temperature);
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

/** Epoxy bead NTC: a small dark drop on two thin legs; it tints red when hot and blue when cold. */
function view(props: ThermistorProps, obs: Record<string, unknown>): string {
  const burnt = obs.damaged === true;
  const t = props.temperature;
  const glow = t > 35 ? `<circle cx="0.5" cy="-1.5" r="${0.9 + Math.min(1, (t - 35) / 65) * 0.6}" fill="#ff6b3d" opacity="${0.15 + Math.min(1, (t - 35) / 65) * 0.35}"/>`
    : t < 10 ? `<circle cx="0.5" cy="-1.5" r="${0.9 + Math.min(1, (10 - t) / 30) * 0.5}" fill="#5aa9ff" opacity="${0.15 + Math.min(1, (10 - t) / 30) * 0.3}"/>`
    : '';
  return `
    <path d="M0,0 V-0.7 L0.35,-1.15" fill="none" stroke="#a7adb4" stroke-width="0.09"/><path d="M1,0 V-0.7 L0.65,-1.15" fill="none" stroke="#a7adb4" stroke-width="0.09"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="1" cy="0" r="0.13" fill="#5f646b"/>
    ${burnt ? '' : glow}
    <ellipse cx="0.5" cy="-1.5" rx="0.55" ry="0.62" fill="${burnt ? '#1c1c1c' : '#2c2f35'}" stroke="#111" stroke-width="0.04"/>
    <ellipse cx="0.33" cy="-1.72" rx="0.16" ry="0.11" fill="#fff" opacity="0.3"/>
    <text x="0.5" y="-1.38" font-size="0.32" text-anchor="middle" fill="#c9ced6" font-family="ui-monospace, monospace">103</text>`;
}

export const thermistor: PartModule<ThermistorProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-0.9 -2.8 2.8 3.1',
  doc,
};
export default thermistor;
