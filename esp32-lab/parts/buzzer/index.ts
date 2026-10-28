import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export type BuzzerProps = Record<string, never>;

// A 5 V active buzzer (12 × 9.5 mm): ≤30 mA at 5 V, starts sounding from roughly 2 V
const V_KNEE = 1.0;
const R_ON = 133; // (5 V − V_KNEE) / 30 mA
const SMOOTH = 0.05;
const V_SOUND = 2.0;
const V_FULL = 5.0;
const G_MIN = 1e-12;

/**
 * The oscillator and transducer as one averaged load: no current below the knee or when
 * reversed, then a resistor. softplus keeps the curve smooth so Newton converges without
 * limiting: I = s·ln(1 + e^((v − V_KNEE)/s)) / R_ON.
 */
function load(v: number): { i: number; g: number } {
  const x = (v - V_KNEE) / SMOOTH;
  const soft = x > 30 ? x : Math.log1p(Math.exp(x));
  const sigmoid = x > 30 ? 1 : Math.exp(x) / (1 + Math.exp(x));
  return { i: (SMOOTH * soft) / R_ON, g: sigmoid / R_ON };
}

function create(_props: BuzzerProps, _env: PartEnv): PartBehavior {
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let loudness = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stampNonlinear(ctx) {
      if (damaged) return;
      const v = ctx.v('plus') - ctx.v('minus');
      const { i, g } = load(v);
      ctx.conductance('plus', 'minus', g + G_MIN);
      ctx.current('plus', 'minus', i - g * v);
    },
    onSolved(op) {
      if (damaged) return;
      const v = op.v('plus') - op.v('minus');
      current = load(v).i;
      loudness = Math.min(1, Math.max(0, (v - V_SOUND) / (V_FULL - V_SOUND)));
      if (overstress.update(current > manifest.ratings.currentMax, op.dt)) {
        damaged = true;
        current = 0;
        loudness = 0;
      }
    },
    observables: () => ({ current, sounding: loudness > 0, loudness, damaged }),
  };
}

const defs = `
  <radialGradient id="buzzer-body" cx="40%" cy="35%" r="75%">
    <stop offset="0" stop-color="#4a4d52"/><stop offset="0.8" stop-color="#1d1e21"/><stop offset="1" stop-color="#101113"/>
  </radialGradient>`;

/**
 * Ø12 mm buzzer seen from above, centred on its legs (+ at (0,0), − at (0,3)) so it sits over the
 * breadboard's centre gap; sound waves while it beeps.
 */
function view(_props: BuzzerProps, obs: Record<string, unknown>): string {
  const loud = Number(obs.loudness ?? 0);
  const waves =
    loud > 0
      ? [0, 1, 2]
          .map((k) => `<path d="M${2.6 + k * 0.45},${0.6 - k * 0.25} A${1.2 + k * 0.4},${1.2 + k * 0.4} 0 0 1 ${2.6 + k * 0.45},${2.4 + k * 0.25}" fill="none" stroke="#f76b15" stroke-width="0.12" stroke-linecap="round" opacity="${(0.4 + loud * 0.6) * (1 - k * 0.25)}"/>`)
          .join('')
      : '';
  return `
    <circle cx="0.05" cy="1.6" r="2.35" fill="#000" opacity="0.25"/>
    <circle cx="0" cy="1.5" r="2.3" fill="${obs.damaged === true ? '#2b2522' : 'url(#buzzer-body)'}" stroke="#0a0a0a" stroke-width="0.05"/>
    <circle cx="0" cy="1.5" r="1.6" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="0.06"/>
    <circle cx="0" cy="1.5" r="0.32" fill="#0b0b0c"/>
    <circle cx="0" cy="0" r="0.16" fill="#8a9098"/><circle cx="0" cy="3" r="0.16" fill="#8a9098"/>
    <text x="0.3" y="0.25" font-size="0.7" font-weight="700" fill="#ff8a8a" font-family="system-ui, sans-serif">+</text>
    <text x="0.3" y="3.25" font-size="0.7" font-weight="700" fill="#9ec5ff" font-family="system-ui, sans-serif">−</text>
    ${waves}`;
}

export const buzzer: PartModule<BuzzerProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-2.5 -1 6.2 5',
};
export default buzzer;
