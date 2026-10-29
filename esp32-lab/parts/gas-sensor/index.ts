import type { PartBehavior, PartEnv, PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface GasSensorProps {
  /** LPG concentration around the sensor (ppm); 0 is clean air. */
  gas: number;
  /** Concentration the module's trimmer sets the DO alarm to. */
  alarm: number;
  [key: string]: number;
}

/** Sensing resistance in clean air, and the module's load resistor from AO to GND. */
export const R0 = 10_000;
export const RL = 4_700;
const CLEAN_AIR_RATIO = 9.8;

/** Rs / R0 for LPG from the datasheet curve (≈ 1.6 at 200 ppm, 0.26 at 10 000 ppm), capped at clean air. */
export function rsRatio(ppm: number): number {
  return ppm <= 0 ? CLEAN_AIR_RATIO : Math.min(CLEAN_AIR_RATIO, 18.8 * ppm ** -0.465);
}

/** AO as a fraction of VCC: the sensing layer and RL form a divider. */
export const aoRatio = (ppm: number) => RL / (RL + R0 * rsRatio(ppm));

/** Heater: 33 Ω, ~150 mA at 5 V. */
const R_HEATER = 33;
const R_DO_PULLUP = 10_000;
const R_DO_LOW = 50;
/** Comparator hysteresis around the trimmer's threshold, as a fraction of VCC. */
const HYSTERESIS = 0.01;

/**
 * Heater across the supply, the tin-oxide layer from VCC to AO over RL to GND, and an LM393
 * comparing AO with the trimmer's threshold: above it, the open-collector DO pulls low against
 * its 10 kΩ pull-up to VCC.
 */
function create(props: GasSensorProps, env: PartEnv): PartBehavior {
  const rs = R0 * rsRatio(props.gas);
  const threshold = aoRatio(props.alarm);
  let alarm = false;
  let ao = 0;

  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('vcc', 'gnd', 1 / R_HEATER);
      ctx.conductance('vcc', 'ao', 1 / rs);
      ctx.conductance('ao', 'gnd', 1 / RL);
      ctx.conductance('vcc', 'do', 1 / R_DO_PULLUP);
      if (alarm) ctx.conductance('do', 'gnd', 1 / R_DO_LOW);
    },
    onSolved(op) {
      const vs = op.v('vcc') - op.v('gnd');
      ao = op.v('ao') - op.v('gnd');
      const k = vs > 0.5 ? ao / vs : 0;
      const want = alarm ? k > threshold - HYSTERESIS : k >= threshold + HYSTERESIS;
      if (want !== alarm) {
        alarm = want;
        env.invalidate();
      }
    },
    observables: () => ({ gas: props.gas, ao, alarm }),
  };
}

/** Blue module with the steel-mesh sensor can, the trimmer and the DO LED. */
function view(props: GasSensorProps, obs: Record<string, unknown>): string {
  const alarm = obs.alarm === true;
  const haze = Math.min(1, props.gas / 5000);
  return `
    ${[0, 1, 2, 3].map((x) => `<path d="M${x},0 V-0.6" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.9" y="-6.6" width="4.8" height="6" rx="0.2" fill="#1d4f9c" stroke="#0f2f63" stroke-width="0.05"/>
    ${haze > 0.02 ? `<circle cx="1.5" cy="-4.2" r="${2 + haze}" fill="#b0a48a" opacity="${0.15 + haze * 0.35}"/>` : ''}
    <circle cx="1.5" cy="-4.2" r="1.7" fill="#c9ced6" stroke="#6f767e" stroke-width="0.06"/>
    <circle cx="1.5" cy="-4.2" r="1.3" fill="#9aa1a9" stroke="#6f767e" stroke-width="0.04" stroke-dasharray="0.1 0.08"/>
    <circle cx="3.3" cy="-1.7" r="0.4" fill="#3e63dd" stroke="#1d3c99" stroke-width="0.05"/><path d="M3.1,-1.7 H3.5" stroke="#fff" stroke-width="0.08"/>
    <circle cx="-0.4" cy="-1.7" r="0.22" fill="#3dd16b"/>
    <circle cx="0.4" cy="-1.7" r="0.22" fill="${alarm ? '#ff4a3d' : '#5a2a2a'}"/>
    <text x="1.5" y="-1.15" font-size="0.32" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">VCC GND DO AO</text>`;
}

export const gasSensor: PartModule<GasSensorProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-1.2 -6.9 5.4 7.2',
  doc,
};
export default gasSensor;
