import type { PartBehavior, PartEnv, PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface SoilMoistureProps {
  /** Water content of the soil, 0 % (in air) to 100 % (in water). */
  moisture: number;
  [key: string]: number;
}

/** AOUT as a fraction of VCC: dry soil reads high, wet soil low (capacitive sensor v1.2). */
export const DRY = 0.82;
export const WET = 0.36;
export const outputRatio = (moisture: number) => DRY - (DRY - WET) * Math.min(1, Math.max(0, moisture / 100));

/** Output resistance of the module's filter stage. */
const R_OUT = 10_000;
const R_END = 20;

/** The 555 oscillator and its RC filter, seen from AOUT: a divider of VCC set by the moisture. */
function create(props: SoilMoistureProps, _env: PartEnv): PartBehavior {
  const k = outputRatio(props.moisture);
  const top = R_OUT * (1 - k) + R_END;
  const bottom = R_OUT * k + R_END;
  let volts = 0;

  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('vcc', 'aout', 1 / top);
      ctx.conductance('aout', 'gnd', 1 / bottom);
    },
    onSolved(op) {
      volts = op.v('aout') - op.v('gnd');
    },
    observables: () => ({ moisture: props.moisture, volts }),
  };
}

/** Black probe with the white depth line; dark soil up to the line, wetter soil darker. */
function view(props: SoilMoistureProps, _obs: Record<string, unknown>): string {
  const m = Math.min(1, Math.max(0, props.moisture / 100));
  const soil = `rgb(${Math.round(150 - m * 90)},${Math.round(110 - m * 70)},${Math.round(70 - m * 45)})`;
  return `
    ${[0, 1, 2].map((x) => `<path d="M${x},0 V-0.6" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.6" y="-3.4" width="3.2" height="2.8" rx="0.15" fill="#1f2023" stroke="#000" stroke-width="0.05"/>
    <rect x="0.15" y="-2.9" width="0.9" height="0.9" fill="#2a2d31" stroke="#55595f" stroke-width="0.04"/>
    <path d="M-0.6,-3.4 H2.6 V-10.2 L1,-11.2 L-0.6,-10.2 Z" fill="#1f2023" stroke="#000" stroke-width="0.05"/>
    <path d="M-1.2,-4.6 H3.2 V-11.6 H-1.2 Z" fill="${soil}" opacity="0.55"/>
    <path d="M-0.6,-4.6 H2.6" stroke="#f2f5f9" stroke-width="0.07" stroke-dasharray="0.25 0.15"/>
    <text x="1" y="-1.15" font-size="0.32" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">GND VCC AO</text>
    <text x="1" y="-7.5" font-size="0.5" text-anchor="middle" fill="#f2f5f9" font-family="ui-monospace, monospace">${Math.round(props.moisture)}%</text>`;
}

export const soilMoisture: PartModule<SoilMoistureProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-1.4 -11.8 4.8 12.1',
  doc,
};
export default soilMoisture;
