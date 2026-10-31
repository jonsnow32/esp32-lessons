import { Junction, Overstress, type NonlinearContext, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export type MosfetModel = 'IRLZ44N' | 'IRF520';

export interface MosfetProps {
  model: MosfetModel;
  [key: string]: string;
}

/**
 * Square-law (SPICE level 1) channel fitted to the datasheet: threshold `vth`, and `k` (A/V²)
 * from Rds(on) at the rated gate voltage, Rds(on) = 1 / (k·(Vgs − vth)). Ratings from the
 * datasheet; `powerMax` is the TO-220 without a heatsink (≈ 62 °C/W up to Tj 175 °C).
 */
export const MODELS: Record<MosfetModel, { vth: number; k: number; rdsOn: [number, number]; currentMax: number; vdsMax: number; vgsMax: number; powerMax: number }> = {
  IRLZ44N: { vth: 1.5, k: 1 / (0.025 * (5 - 1.5)), rdsOn: [0.025, 5], currentMax: 47, vdsMax: 55, vgsMax: 16, powerMax: 2.4 },
  IRF520: { vth: 3.0, k: 1 / (0.27 * (10 - 3.0)), rdsOn: [0.27, 10], currentMax: 9.2, vdsMax: 100, vgsMax: 20, powerMax: 2.4 },
};

/** Width of the soft knee around the threshold (V): keeps the channel smooth for Newton. */
const KNEE = 0.08;
/** Gets hot for a few seconds above powerMax before it fails. */
const OVERSTRESS_TIME = 5_000_000_000;
/** A failed MOSFET is shorted drain to source. */
const R_SHORT = 0.05;
/** Body diode, source → drain: about 0,8 V at 1 A. */
const BODY = { v: 0.8, i: 1, n: 1.3 };

/** Gate overdrive above threshold, soft around it, and its slope. */
function overdrive(vgs: number, vth: number): { vov: number; dvov: number } {
  const x = (vgs - vth) / KNEE;
  if (x > 30) return { vov: vgs - vth, dvov: 1 };
  const e = Math.exp(x);
  return { vov: KNEE * Math.log1p(e), dvov: e / (1 + e) };
}

/**
 * Drain current and its slopes for vds ≥ 0: linear region below vds = vov (a resistor of
 * 1 / (k·vov) near 0 V), flat at k·vov² / 2 above. Below 0 the channel conducts as a resistor
 * the other way.
 */
export function channel(vgs: number, vds: number, m: { vth: number; k: number }): { id: number; gm: number; gds: number } {
  const { vov, dvov } = overdrive(vgs, m.vth);
  if (vds < 0) return { id: m.k * vov * vds, gm: m.k * dvov * vds, gds: m.k * vov };
  if (vds < vov) return { id: m.k * (vov - vds / 2) * vds, gm: m.k * dvov * vds, gds: m.k * (vov - vds) };
  return { id: (m.k * vov * vov) / 2, gm: m.k * vov * dvov, gds: 0 };
}

const G_MIN = 1e-12;

/**
 * Low-side switch for loads the GPIO can't carry. The gate is insulated: it takes no current,
 * only its voltage to the source counts. Too much gate voltage punches through the oxide, too
 * much power (half open, or far beyond its current) cooks it; both leave it shorted D–S.
 */
function create(props: MosfetProps, env: PartEnv): PartBehavior {
  const m = MODELS[props.model] ?? MODELS.IRLZ44N;
  const body = Junction.fit(BODY.v, BODY.i, BODY.n);
  const overstress = new Overstress(OVERSTRESS_TIME);
  let current = 0;
  let vgs = 0;
  let vds = 0;
  let power = 0;
  let damaged = false;

  const stampChannel = (ctx: NonlinearContext) => {
    const g = ctx.v('gate') - ctx.v('source');
    const d = ctx.v('drain') - ctx.v('source');
    const { id, gm, gds } = channel(g, d, m);
    // Companion model: Id ≈ gds·vds + gm·vgs + (id − gds·d − gm·g)
    ctx.conductance('drain', 'source', gds + G_MIN);
    ctx.transconductance('drain', 'source', 'gate', 'source', gm);
    ctx.current('drain', 'source', id - gds * d - gm * g);
  };

  return {
    get damaged() {
      return damaged;
    },
    stampNonlinear(ctx) {
      if (damaged) {
        ctx.conductance('drain', 'source', 1 / R_SHORT);
        return;
      }
      stampChannel(ctx);
      body.stamp(ctx, 'source', 'drain');
    },
    onSolved(op) {
      vgs = op.v('gate') - op.v('source');
      vds = op.v('drain') - op.v('source');
      if (damaged) {
        current = vds / R_SHORT;
        power = 0;
        return;
      }
      current = channel(vgs, vds, m).id - body.current(-vds);
      power = Math.abs(current * vds);
      if (Math.abs(vgs) > m.vgsMax || vds > m.vdsMax || Math.abs(current) > m.currentMax || overstress.update(power > m.powerMax, op.dt)) {
        damaged = true;
        env.invalidate();
      }
    },
    observables: () => ({ current, vgs, vds, power, on: current > 0.001, damaged }),
  };
}

/** TO-220: metal tab with its hole on top, black body with the marking, three legs G D S. */
function view(props: MosfetProps, obs: Record<string, unknown>): string {
  // The tab glows from grey to dull red as it heats up towards its rating
  const heat = Math.min(1, Number(obs.power ?? 0) / (MODELS[props.model]?.powerMax ?? 2.4));
  const burnt = obs.damaged === true;
  const tab = burnt ? '#4a3b33' : `rgb(${Math.round(176 + 60 * heat)},${Math.round(182 - 90 * heat)},${Math.round(190 - 110 * heat)})`;
  const legs = [0, 1, 2]
    .map((x) => `<path d="M${x},0 V-1.7" stroke="#b9bec5" stroke-width="0.16"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`)
    .join('');
  const labels = ['G', 'D', 'S'].map((t, x) => `<text x="${x}" y="-1.85" font-size="0.42" font-weight="bold" text-anchor="middle" fill="#f2f4f7" font-family="ui-monospace, monospace">${t}</text>`).join('');
  return `
    <rect x="-0.4" y="-6.3" width="2.8" height="2.2" rx="0.12" fill="${tab}" stroke="#6f767e" stroke-width="0.05"/>
    <circle cx="1" cy="-5.35" r="0.48" fill="#1b1d20"/>
    ${legs}
    <rect x="-0.4" y="-4.2" width="2.8" height="2.6" rx="0.08" fill="${burnt ? '#2b2522' : 'url(#mosfet-body)'}" stroke="#0e0f11" stroke-width="0.05"/>
    <text x="1" y="-3.45" font-size="0.36" text-anchor="middle" fill="#d7dbe0" font-family="ui-monospace, monospace">${props.model}</text>
    ${burnt ? '' : `<text x="1" y="-2.95" font-size="0.26" text-anchor="middle" fill="#8f959c" font-family="ui-monospace, monospace">N-MOSFET</text>`}
    ${labels}`;
}

const defs = `
  <linearGradient id="mosfet-body" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3a3d42"/><stop offset="0.5" stop-color="#202226"/><stop offset="1" stop-color="#131416"/>
  </linearGradient>`;

export const mosfet: PartModule<MosfetProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.7 -6.6 3.4 7',
  doc,
};
export default mosfet;
