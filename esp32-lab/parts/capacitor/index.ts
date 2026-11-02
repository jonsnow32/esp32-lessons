import { Capacitor, parseCapacitance, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { capCode, doc } from './doc';
import manifest from './part.json';

export interface CapacitorProps {
  /** "100nF", "22pF", "1µF". */
  capacitance: string;
  [key: string]: string;
}

/** Not polarised: an ideal capacitance between a and b, charging and discharging through the circuit. */
function create(props: CapacitorProps, env: PartEnv): PartBehavior {
  const cap = new Capacitor(parseCapacitance(props.capacitance), env);
  let volts = 0;
  return {
    damaged: false,
    stamp(ctx) {
      cap.stamp(ctx, 'a', 'b');
    },
    onSolved(op) {
      const avg = op.avg ?? op.v;
      volts = avg('a') - avg('b');
      cap.solved(volts);
    },
    onEvent(ev) {
      if (ev.kind === 'timer' && ev.tag === 'cap') cap.step();
    },
    observables: () => ({ voltage: volts, current: cap.i, damaged: false }),
    persist: () => cap.v0,
    restore(state) {
      if (typeof state === 'number') cap.restore(state);
    },
  };
}

const defs = `
  <radialGradient id="ccap-body" cx="38%" cy="32%" r="80%">
    <stop offset="0" stop-color="#f4b35e"/><stop offset="0.65" stop-color="#d9832a"/><stop offset="1" stop-color="#a65a14"/>
  </radialGradient>`;

/** Disc ceramic capacitor standing on its two legs, the value code printed on the disc. */
function view(props: CapacitorProps): string {
  const code = capCode(parseCapacitance(props.capacitance));
  return `
    <path d="M0,0 L0.55,-0.75 M2,0 L1.45,-0.75" stroke="#a7adb4" stroke-width="0.12" fill="none" stroke-linecap="round"/>
    ${[0, 2].map((x) => `<circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <ellipse cx="1" cy="-1.55" rx="1.02" ry="0.95" fill="url(#ccap-body)" stroke="#8a4a10" stroke-width="0.05"/>
    <ellipse cx="0.72" cy="-1.95" rx="0.36" ry="0.2" fill="#fff" opacity="0.25"/>
    <text x="1" y="-1.4" font-size="0.48" font-weight="bold" text-anchor="middle" fill="#4a2606" font-family="ui-monospace, monospace">${code}</text>`;
}

export const capacitor: PartModule<CapacitorProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.4 -2.7 2.8 3',
  doc,
};
export default capacitor;
