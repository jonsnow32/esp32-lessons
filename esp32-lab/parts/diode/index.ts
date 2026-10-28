import { Junction, Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export type DiodeModel = '1N4148' | '1N4007';

export interface DiodeProps {
  model: DiodeModel;
  [key: string]: string;
}

/** SPICE junction parameters and datasheet ratings per model (series resistance ignored). */
const MODELS: Record<DiodeModel, { is: number; n: number; currentMax: number; currentAbsMax: number; reverseVoltageMax: number }> = {
  '1N4148': { is: 2.52e-9, n: 1.752, currentMax: 0.2, currentAbsMax: 1, reverseVoltageMax: 100 },
  '1N4007': { is: 7.03e-9, n: 1.808, currentMax: 1, currentAbsMax: 30, reverseVoltageMax: 1000 },
};

/** Survives about a second above its continuous rating. */
const OVERSTRESS_TIME = 1_000_000_000;

function create(props: DiodeProps, _env: PartEnv): PartBehavior {
  const m = MODELS[props.model] ?? MODELS['1N4148'];
  const junction = new Junction(m.is, m.n);
  const overstress = new Overstress(OVERSTRESS_TIME);
  let current = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stampNonlinear(ctx) {
      if (!damaged) junction.stamp(ctx, 'anode', 'cathode');
    },
    onSolved(op) {
      if (damaged) return;
      const vd = op.v('anode') - op.v('cathode');
      current = junction.current(vd);
      if (current > m.currentAbsMax || -vd > m.reverseVoltageMax || overstress.update(current > m.currentMax, op.dt)) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({ current, damaged }),
  };
}

const defs = `
  <linearGradient id="diode-glass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd9a8" stop-opacity="0.9"/><stop offset="0.5" stop-color="#e48a3c" stop-opacity="0.85"/><stop offset="1" stop-color="#9c4f18" stop-opacity="0.9"/>
  </linearGradient>
  <linearGradient id="diode-epoxy" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#55585e"/><stop offset="0.45" stop-color="#26282c"/><stop offset="1" stop-color="#0f1012"/>
  </linearGradient>
  <linearGradient id="diode-lead" gradientUnits="userSpaceOnUse" x1="0" y1="-0.06" x2="0" y2="0.06"><stop offset="0" stop-color="#eef0f3"/><stop offset="1" stop-color="#868c94"/></linearGradient>`;

/** Axial diode: orange glass (1N4148) or black epoxy (1N4007) body, stripe at the cathode end. */
function view(props: DiodeProps, obs: Record<string, unknown>): string {
  const glass = props.model !== '1N4007';
  const burnt = obs.damaged === true;
  const [x0, x1, h] = glass ? [1.4, 2.6, 0.26] : [1.1, 2.9, 0.38];
  return `
    <path d="M0,0 H4" stroke="url(#diode-lead)" stroke-width="${glass ? 0.09 : 0.12}" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="4" cy="0" r="0.13" fill="#5f646b"/>
    <rect x="${x0}" y="${-h}" width="${x1 - x0}" height="${2 * h}" rx="${h * 0.6}" fill="${burnt ? '#2a2420' : glass ? 'url(#diode-glass)' : 'url(#diode-epoxy)'}"/>
    ${glass && !burnt ? `<rect x="${x0 + 0.35}" y="-0.06" width="${x1 - x0 - 0.7}" height="0.12" fill="#5a3010" opacity="0.6"/>` : ''}
    <rect x="${x1 - 0.28}" y="${-h}" width="0.16" height="${2 * h}" fill="${glass ? '#1b1b1b' : '#c9ccd1'}"/>`;
}

export const diode: PartModule<DiodeProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.4 -1.6 4.8 3.2',
};
export default diode;
