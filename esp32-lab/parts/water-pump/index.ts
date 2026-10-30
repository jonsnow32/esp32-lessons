import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export type WaterPumpProps = Record<string, never>;

/** `PartEnv.world` key: water this bench's pump is pouring into the pot, in mL/s. */
export const WATER_FLOW = 'water.flow';

// A 3–5 V submersible mini pump (JT-DC3W type): ~180 mA and ~25 mL/s (90 L/h) at 5 V
const V_KNEE = 0.5;
const R_ON = 25; // (5 V − V_KNEE) / 180 mA
const SMOOTH = 0.05;
const G_MIN = 1e-12;
/** The impeller starts turning here and reaches full flow at 5 V. */
const V_START = 2.0;
const V_FULL = 5.0;
const FLOW_FULL = 25;

/**
 * The motor as an averaged load: nothing below the brushes' knee or when reversed, then its
 * winding resistance (softplus, as the buzzer, so Newton converges without limiting).
 */
export function load(v: number): { i: number; g: number } {
  const x = (v - V_KNEE) / SMOOTH;
  const soft = x > 30 ? x : Math.log1p(Math.exp(x));
  const sigmoid = x > 30 ? 1 : Math.exp(x) / (1 + Math.exp(x));
  return { i: (SMOOTH * soft) / R_ON, g: sigmoid / R_ON };
}

/** Water out at `v` volts across the motor (mL/s). */
export const flowAt = (v: number) => FLOW_FULL * Math.min(1, Math.max(0, (v - V_START) / (V_FULL - V_START)));

/** Spins when powered and tells the world how much water it moves. One pump per bench. */
function create(_props: WaterPumpProps, env: PartEnv): PartBehavior {
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let flow = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stampNonlinear(ctx) {
      if (damaged) return;
      const v = ctx.v('pos') - ctx.v('neg');
      const { i, g } = load(v);
      ctx.conductance('pos', 'neg', g + G_MIN);
      ctx.current('pos', 'neg', i - g * v);
    },
    onSolved(op) {
      if (damaged) return;
      const v = op.v('pos') - op.v('neg');
      current = load(v).i;
      flow = flowAt(v);
      if (overstress.update(current > manifest.ratings.currentMax, op.dt)) {
        damaged = true;
        current = 0;
        flow = 0;
      }
      env.world.set(WATER_FLOW, flow);
    },
    observables: () => ({ current, flow, running: flow > 0, damaged }),
  };
}

/** Blue pump body over its two leads, the outlet tube to the right; drops while water flows. */
function view(_props: WaterPumpProps, obs: Record<string, unknown>): string {
  const flow = Number(obs.flow ?? 0) / FLOW_FULL;
  const drops =
    flow > 0
      ? [0, 1, 2].map((k) => `<ellipse cx="${3.35 + k * 0.08}" cy="${-3.3 + k * 0.55}" rx="0.13" ry="0.2" fill="#4cc3ff" opacity="${0.4 + flow * 0.6 - k * 0.15}"/>`).join('')
      : '';
  return `
    <path d="M0,0 V-0.9" stroke="#e5484d" stroke-width="0.14"/><circle cx="0" cy="0" r="0.13" fill="#5f646b"/>
    <path d="M1,0 V-0.9" stroke="#1c2024" stroke-width="0.14"/><circle cx="1" cy="0" r="0.13" fill="#5f646b"/>
    <rect x="-0.7" y="-4.6" width="2.4" height="3.7" rx="0.6" fill="${obs.damaged === true ? '#2b2522' : '#2f74d0'}" stroke="#123e7a" stroke-width="0.06"/>
    <rect x="-0.5" y="-1.6" width="2" height="0.5" rx="0.1" fill="#1d4f9c"/>
    ${[0, 1, 2].map((k) => `<path d="M${-0.3 + k * 0.6},-1.5 V-1.2" stroke="#0f2f63" stroke-width="0.1"/>`).join('')}
    <path d="M1.7,-3.9 H3.0 Q3.4,-3.9 3.4,-3.5" fill="none" stroke="#c9ced6" stroke-width="0.32" stroke-linecap="round"/>
    ${drops}
    <circle cx="0.5" cy="-3.2" r="0.55" fill="none" stroke="#e6efff" stroke-width="0.07" opacity="0.7"/>
    <path d="M0.5,-3.75 V-2.65 M-0.05,-3.2 H1.05" stroke="#e6efff" stroke-width="0.06" opacity="${flow > 0 ? 1 : 0.4}" transform="rotate(${flow > 0 ? 45 : 0} 0.5 -3.2)"/>
    <text x="0.5" y="-2" font-size="0.32" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">+ −</text>`;
}

export const waterPump: PartModule<WaterPumpProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-1 -4.9 4.8 5.2',
  doc,
};
export default waterPump;
