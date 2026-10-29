import { Junction, Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface RgbLedProps {
  common: 'cathode' | 'anode';
  [key: string]: string;
}

const CHANNELS = ['red', 'green', 'blue'] as const;
type Channel = (typeof CHANNELS)[number];

/** Forward voltage of each die at 20 mA, typical for 5 mm RGB LEDs. */
export const FORWARD_VOLTAGE: Record<Channel, number> = { red: 2.0, green: 3.0, blue: 3.1 };
const I_REF = 0.02;
const EMISSION = 2;

/**
 * Three LED dies sharing one leg. Common cathode: current flows colour leg → common; common
 * anode: common → colour leg. Each die fails on its own (open circuit), like a real one.
 */
function create(props: RgbLedProps, _env: PartEnv): PartBehavior {
  const cathode = props.common !== 'anode';
  const { currentMax, currentAbsMax, reverseVoltageMax, overstressTime } = manifest.ratings;
  const dies = CHANNELS.map((ch) => ({
    ch,
    junction: Junction.fit(FORWARD_VOLTAGE[ch], I_REF, EMISSION),
    overstress: new Overstress(overstressTime),
    current: 0,
    dead: false,
  }));
  /** Anode and cathode terminal of a die. */
  const ends = (ch: Channel): [string, string] => (cathode ? [ch, 'common'] : ['common', ch]);

  return {
    get damaged() {
      return dies.some((d) => d.dead);
    },
    stampNonlinear(ctx) {
      for (const d of dies) if (!d.dead) d.junction.stamp(ctx, ...ends(d.ch));
    },
    onSolved(op) {
      for (const d of dies) {
        if (d.dead) continue;
        const [a, k] = ends(d.ch);
        const vd = op.v(a) - op.v(k);
        d.current = d.junction.current(vd);
        if (d.current > currentAbsMax || -vd > reverseVoltageMax || d.overstress.update(d.current > currentMax, op.dt)) {
          d.dead = true;
          d.current = 0;
        }
      }
    },
    observables: () => ({
      current: dies.reduce((s, d) => s + Math.max(0, d.current), 0),
      ...Object.fromEntries(dies.map((d) => [d.ch, d.dead ? 0 : Math.min(1, Math.max(0, d.current) / I_REF)])),
      damaged: dies.some((d) => d.dead),
    }),
  };
}

const defs = `
  <radialGradient id="rgb-lens" cx="35%" cy="30%" r="80%">
    <stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.4" stop-color="#eef1f4" stop-opacity="0.85"/>
    <stop offset="1" stop-color="#c9ced6" stop-opacity="0.95"/>
  </radialGradient>`;

/** Diffused 5 mm RGB LED on four legs (the common one is the longest); it glows in the mixed colour. */
function view(_props: RgbLedProps, obs: Record<string, unknown>): string {
  const level = (ch: Channel) => Math.min(1, Number(obs[ch] ?? 0));
  const [r, g, b] = CHANNELS.map(level) as [number, number, number];
  const peak = Math.max(r, g, b);
  const lit = peak > 0.02;
  // Mixed colour, normalised so the brightest channel is at full intensity
  const mix = lit ? `rgb(${[r, g, b].map((c) => Math.round(80 + (175 * c) / peak)).join(',')})` : '';
  const legs = [0, 1, 2, 3]
    .map((x) => `<path d="M${x},0 V-1.05" stroke="#b5bac1" stroke-width="0.11"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`)
    .join('');
  return `
    ${legs}
    ${lit ? `<circle cx="1.5" cy="-2.3" r="${2 + peak * 2}" fill="${mix}" opacity="${0.12 + peak * 0.18}"/><circle cx="1.5" cy="-2.3" r="${1.3 + peak}" fill="${mix}" opacity="${0.25 + peak * 0.25}"/>` : ''}
    <path d="M0.4,-1.05 H2.6 V-1.3 H0.4 Z" fill="#dfe3e8"/>
    <path d="M0.5,-1.3 V-2.45 A1,1 0 0 1 2.5,-2.45 V-1.3 Z" fill="url(#rgb-lens)" stroke="#00000030" stroke-width="0.04"/>
    ${lit ? `<path d="M0.5,-1.3 V-2.45 A1,1 0 0 1 2.5,-2.45 V-1.3 Z" fill="${mix}" opacity="${0.35 + peak * 0.5}"/>` : ''}
    <path d="M0.75,-2.55 A0.75,0.75 0 0 1 1.25,-3.25" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="0.09" stroke-linecap="round"/>`;
}

export const rgbLed: PartModule<RgbLedProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.5 -3.6 4 4',
  doc,
};
export default rgbLed;
