import { MS, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface RelayProps {
  /** Which IN level energises the coil. */
  trigger: 'high' | 'low';
  [key: string]: string;
}

/** IN input stage: base resistor + indicator LED (high trigger) or optocoupler LED from VCC (low trigger). */
const R_IN = 2_200;
/** IN voltage (to GND, or below VCC for low trigger) that turns the driver on / off again. */
const V_ON = 1.8;
const V_OFF = 1.2;
/** Optocoupler LED + indicator LED in series: VCC − IN must exceed this to conduct. */
const V_OPTO_ON = 2.6;
const V_OPTO_OFF = 2.0;
/** SRD-05VDC coil: 70 Ω, picks up at 75 % of 5 V. */
const R_COIL = 70;
const V_PICKUP = 3.75;
const V_DROPOUT = 1.0;
const OPERATE = 10 * MS;
const RELEASE = 5 * MS;
const R_CONTACT = 0.05;
const G_OPEN = 1e-12;

/**
 * The driver energises the coil from VCC when IN asks for it; the armature follows after the
 * operate / release time, moving COM from NC over to NO. A coil without enough supply voltage
 * never pulls in.
 */
function create(props: RelayProps, env: PartEnv): PartBehavior {
  const low = props.trigger === 'low';
  let driven = false;
  let coil = false;
  let toNo = false;
  let clicks = 0;
  let generation = 0;
  let current = 0;

  const setCoil = (on: boolean) => {
    if (on === coil) return;
    coil = on;
    generation++;
    env.schedule(env.now() + (on ? OPERATE : RELEASE), `move:${generation}`);
    env.invalidate();
  };

  return {
    damaged: false,
    stamp(ctx) {
      if (low) ctx.conductance('vcc', 'in', 1 / R_IN);
      else ctx.conductance('in', 'gnd', 1 / R_IN);
      if (coil) ctx.conductance('vcc', 'gnd', 1 / R_COIL);
      ctx.conductance('com', 'no', toNo ? 1 / R_CONTACT : G_OPEN);
      ctx.conductance('com', 'nc', toNo ? G_OPEN : 1 / R_CONTACT);
    },
    onSolved(op) {
      const vin = low ? op.v('vcc') - op.v('in') : op.v('in') - op.v('gnd');
      const [on, off] = low ? [V_OPTO_ON, V_OPTO_OFF] : [V_ON, V_OFF];
      if (!driven && vin >= on) driven = true;
      else if (driven && vin <= off) driven = false;
      const vs = op.v('vcc') - op.v('gnd');
      if (driven && vs >= V_PICKUP) setCoil(true);
      else if (!driven || vs < V_DROPOUT) setCoil(false);
      current = (op.v('com') - op.v(toNo ? 'no' : 'nc')) / R_CONTACT;
    },
    onEvent(ev) {
      if (ev.kind !== 'timer' || ev.tag !== `move:${generation}` || toNo === coil) return;
      toNo = coil;
      clicks++;
      env.invalidate();
    },
    // The armature stays where it was; the coil is re-derived from IN on the first solve
    persist: () => ({ toNo, coil, driven, clicks }),
    restore(state) {
      ({ toNo, coil, driven, clicks } = state as { toNo: boolean; coil: boolean; driven: boolean; clicks: number });
    },
    observables: () => ({ driven, energized: coil, closed: toNo, clicks, current }),
  };
}

/** Blue module: the cube relay, the screw terminal block on the right and the red/green LEDs. */
function view(_props: RelayProps, obs: Record<string, unknown>): string {
  const on = obs.closed === true;
  const pins = [0, 1, 2].map((x) => `<path d="M${x},0 V-0.6" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('');
  const screws = [5, 7, 9]
    .map((x) => `<path d="M${x},0 V-0.6" stroke="#a7adb4" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/><circle cx="${x}" cy="-1.6" r="0.55" fill="#c9ced6" stroke="#6f767e" stroke-width="0.05"/><path d="M${x - 0.35},-1.6 H${x + 0.35}" stroke="#6f767e" stroke-width="0.1"/>`)
    .join('');
  // One label over each pin, the screw terminals labelled just above the block
  const labels = (
    [[0, -0.95, 'IN'], [1, -0.95, 'VCC'], [2, -0.95, 'GND'], [5, -2.7, 'NO'], [7, -2.7, 'COM'], [9, -2.7, 'NC']] as const
  )
    .map(([x, y, t]) => `<text x="${x}" y="${y}" font-size="0.34" font-weight="bold" text-anchor="middle" fill="#e6efff" font-family="ui-monospace, monospace">${t}</text>`)
    .join('');
  return `
    <rect x="-0.6" y="-6.4" width="10.8" height="5.9" rx="0.15" fill="#1d4f9c" stroke="#0f2f63" stroke-width="0.05"/>
    <rect x="4.2" y="-2.5" width="5.8" height="1.9" rx="0.08" fill="#2f74d0" stroke="#174d93" stroke-width="0.05"/>
    ${pins}${screws}
    <rect x="3.6" y="-6.2" width="6.2" height="3.1" rx="0.1" fill="#2a64c4" stroke="#123e7a" stroke-width="0.05"/>
    <text x="6.7" y="-4.9" font-size="0.45" text-anchor="middle" fill="#e6efff" font-family="ui-monospace, monospace">SRD-05VDC</text>
    <text x="6.7" y="-4.25" font-size="0.32" text-anchor="middle" fill="#c9d8f5" font-family="ui-monospace, monospace">10A 250VAC</text>
    <path d="M${on ? 5.3 : 8.1},-3.6 L6.7,-3.6" stroke="#e6efff" stroke-width="0.08" stroke-linecap="round"/>
    <circle cx="0.1" cy="-5.6" r="0.28" fill="${obs.driven === true ? '#ff4a3d' : '#5a2a2a'}"/>
    <circle cx="1.1" cy="-5.6" r="0.28" fill="#3dd16b"/>
    ${labels}`;
}

export const relay: PartModule<RelayProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-0.9 -6.7 11.4 7',
  doc,
};
export default relay;
