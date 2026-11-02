import { Capacitor, Overstress, parseCapacitance, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface ElectrolyticProps {
  /** "100µF", "4.7µF". */
  capacitance: string;
  /** Rated voltage printed on the sleeve: "16V". */
  voltage: string;
  [key: string]: string;
}

/** A failed electrolytic (reversed, over-voltage) leaks like a low resistor. */
const R_FAILED = 100;
/** Above its rated voltage by this much the dielectric breaks down at once. */
const OVERVOLTAGE_ABS = 1.5;

/**
 * Polarised capacitance from plus to minus. Held reversed beyond about 1 V, or above the rated
 * voltage, for longer than the overstress time it fails; more than 1.5 × the rating kills it at once.
 */
function create(props: ElectrolyticProps, env: PartEnv): PartBehavior {
  const cap = new Capacitor(parseCapacitance(props.capacitance), env);
  const rated = parseFloat(props.voltage);
  const reverseMax = manifest.ratings.reverseVoltageMax;
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let volts = 0;
  let damaged = false;
  let reversed = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      if (damaged) ctx.conductance('plus', 'minus', 1 / R_FAILED);
      else cap.stamp(ctx, 'plus', 'minus');
    },
    onSolved(op) {
      const avg = op.avg ?? op.v;
      volts = avg('plus') - avg('minus');
      if (damaged) return;
      cap.solved(volts);
      reversed = volts < -reverseMax;
      const over = volts > rated;
      if (volts > rated * OVERVOLTAGE_ABS || overstress.update(reversed || over, op.dt)) damaged = true;
    },
    onEvent(ev) {
      if (!damaged && ev.kind === 'timer' && ev.tag === 'cap') cap.step();
    },
    observables: () => ({ voltage: volts, current: damaged ? volts / R_FAILED : cap.i, reversed, damaged }),
    persist: () => cap.v0,
    restore(state) {
      if (typeof state === 'number') cap.restore(state);
    },
  };
}

const defs = `
  <linearGradient id="ecap-sleeve" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#16233f"/><stop offset="0.35" stop-color="#2b4a86"/><stop offset="1" stop-color="#101a30"/>
  </linearGradient>
  <linearGradient id="ecap-stripe" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#cfd6e2"/><stop offset="1" stop-color="#8e98a8"/>
  </linearGradient>`;

/**
 * Standing can on two legs, + (long leg) at the first terminal; the white stripe with − marks is
 * on the minus side. A failed capacitor shows a bulged, split top.
 */
function view(props: ElectrolyticProps, obs: Record<string, unknown>): string {
  const burnt = obs.damaged === true;
  const top = burnt
    ? `<path d="M-0.42,-3.05 Q0.5,-3.7 1.42,-3.05" fill="#8a8f96" stroke="#55595f" stroke-width="0.04"/><path d="M0.2,-3.25 L0.5,-3.12 L0.8,-3.28" stroke="#3a2a1e" stroke-width="0.06" fill="none"/>`
    : `<ellipse cx="0.5" cy="-3.05" rx="0.92" ry="0.16" fill="#b9c0ca" stroke="#6f767e" stroke-width="0.03"/><path d="M0.5,-3.17 V-2.93 M0.34,-3.05 H0.66" stroke="#6f767e" stroke-width="0.03"/>`;
  return `
    <path d="M0,0 V-0.6 M1,0 V-0.6" stroke="#a7adb4" stroke-width="0.12" stroke-linecap="round"/>
    ${[0, 1].map((x) => `<circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <path d="M-0.42,-3.05 V-0.75 Q0.5,-0.5 1.42,-0.75 V-3.05 Z" fill="${burnt ? '#3d3530' : 'url(#ecap-sleeve)'}" stroke="#0b1222" stroke-width="0.04"/>
    <path d="M0.98,-3.05 V-0.62 Q1.22,-0.66 1.42,-0.75 V-3.05 Z" fill="${burnt ? '#5a524c' : 'url(#ecap-stripe)'}"/>
    ${[-2.55, -1.95, -1.35].map((y) => `<rect x="1.12" y="${y}" width="0.18" height="0.06" fill="#16233f"/>`).join('')}
    <text x="0.32" y="-2.05" font-size="0.32" text-anchor="middle" fill="#e6efff" font-family="ui-monospace, monospace">${props.capacitance}</text>
    <text x="0.32" y="-1.55" font-size="0.3" text-anchor="middle" fill="#e6efff" font-family="ui-monospace, monospace">${props.voltage}</text>
    ${top}`;
}

export const electrolyticCapacitor: PartModule<ElectrolyticProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.7 -3.6 2.4 3.9',
  doc,
};
export default electrolyticCapacitor;
