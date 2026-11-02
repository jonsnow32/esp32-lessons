import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc, TURNS, valueCode } from './doc';
import manifest from './part.json';

export interface Trimpot3296Props {
  resistance: number;
  /** Wiper position, 0–100 % of the track from pin 1 to pin 3 (about 25 screw turns end to end). */
  position: number;
  [key: string]: number;
}

/** Datasheet end resistance: 1 % of the total or 2 Ω, whichever is greater. */
const endResistance = (r: number) => Math.max(2, r * 0.01);

/**
 * Same as a rotary potentiometer: two resistors in series sharing the wiper, pin 1–wiper is
 * position × R and wiper–pin 3 the rest, each keeping the end resistance so the screw wound fully
 * to one end is a low resistance, not a short.
 */
function create(props: Trimpot3296Props, _env: PartEnv): PartBehavior {
  const r = props.resistance;
  const k = Math.min(1, Math.max(0, props.position / 100));
  const rEnd = endResistance(r);
  const ra = r * k + rEnd;
  const rb = r * (1 - k) + rEnd;
  const powerMax = manifest.ratings.powerMax;
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let wiperVolts = 0;
  let power = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      // A burnt track goes open circuit
      if (damaged) return;
      ctx.conductance('a', 'wiper', 1 / ra);
      ctx.conductance('wiper', 'b', 1 / rb);
    },
    onSolved(op) {
      const va = op.v('a');
      const vw = op.v('wiper');
      const vb = op.v('b');
      wiperVolts = vw;
      if (damaged) return;
      const ia = (va - vw) / ra;
      const ib = (vw - vb) / rb;
      current = Math.max(Math.abs(ia), Math.abs(ib));
      power = ia * ia * ra + ib * ib * rb;
      if (overstress.update(power > powerMax, op.dt)) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({ current, power, wiper: wiperVolts, damaged }),
  };
}

const defs = `
  <linearGradient id="t3296-body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3f7fe0"/><stop offset="1" stop-color="#1d4fa8"/>
  </linearGradient>
  <radialGradient id="t3296-screw" cx="40%" cy="35%" r="75%">
    <stop offset="0" stop-color="#f6dc8a"/><stop offset="0.7" stop-color="#c9a13e"/><stop offset="1" stop-color="#8a6a1f"/>
  </radialGradient>`;

/**
 * Seen from above: the blue box sits over its three legs (pins 1 and 3 in one row, pin 2 a row
 * below between them) with the brass adjusting screw at the end by pin 1. The screw slot turns
 * with the wiper, 25 turns end to end.
 */
function view(props: Trimpot3296Props, obs: Record<string, unknown>): string {
  const burnt = obs.damaged === true;
  const k = Math.min(100, Math.max(0, props.position)) / 100;
  const slot = (k * TURNS * 360) % 360;
  return `
    <rect x="-1.05" y="-0.5" width="3.75" height="1.9" rx="0.12" fill="${burnt ? '#3a3a3a' : 'url(#t3296-body)'}" stroke="#123a80" stroke-width="0.05"/>
    <rect x="-0.98" y="-0.43" width="3.61" height="0.18" rx="0.06" fill="#fff" opacity="0.18"/>
    ${[[0, 0, 1], [1, 1, 2], [2, 0, 3]].map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="0.11" fill="#0f2a5c" opacity="0.6"/><text x="${x! + 0.22}" y="${y! + 0.1}" font-size="0.26" fill="#cfe0ff" font-family="ui-monospace, monospace">${n}</text>`).join('')}
    <text x="1.55" y="0.58" font-size="0.42" font-weight="bold" text-anchor="middle" fill="#e6efff" font-family="ui-monospace, monospace">${valueCode(props.resistance)}</text>
    <g transform="translate(-0.5,0.45) rotate(${slot.toFixed(1)})">
      <circle r="0.4" fill="${burnt ? '#262626' : 'url(#t3296-screw)'}" stroke="#6b5216" stroke-width="0.04"/>
      <rect x="-0.32" y="-0.055" width="0.64" height="0.11" rx="0.03" fill="#5a4512"/>
    </g>`;
}

export const trimpot3296: PartModule<Trimpot3296Props> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-1.25 -0.7 4.15 2.3',
  doc,
};
export default trimpot3296;
