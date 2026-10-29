import { Junction, Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export type BarColor = 'red' | 'green' | 'yellow' | 'blue';

export interface LedBarProps {
  color: BarColor | 'mixed';
  [key: string]: string;
}

export const SEGMENT_COUNT = 10;

/** Forward voltage of one bar at 10 mA. */
export const FORWARD_VOLTAGE: Record<BarColor, number> = { red: 1.9, yellow: 2.0, green: 2.1, blue: 3.0 };

/** Colour of each bar, from the + side: 'mixed' is the usual 5 green, 3 yellow, 2 red level meter. */
export function barColors(color: LedBarProps['color']): BarColor[] {
  if (color !== 'mixed') return Array(SEGMENT_COUNT).fill(FORWARD_VOLTAGE[color] ? color : 'red');
  return Array.from({ length: SEGMENT_COUNT }, (_, i) => (i < 5 ? 'green' : i < 8 ? 'yellow' : 'red'));
}

const I_REF = 0.01;
const EMISSION = 2;

/** Ten independent LEDs, anode a<i> to cathode k<i>. */
function create(props: LedBarProps, _env: PartEnv): PartBehavior {
  const { currentMax, currentAbsMax, reverseVoltageMax, overstressTime } = manifest.ratings;
  const bars = barColors(props.color).map((c, i) => ({
    a: `a${i}`,
    k: `k${i}`,
    junction: Junction.fit(FORWARD_VOLTAGE[c], I_REF, EMISSION),
    overstress: new Overstress(overstressTime),
    current: 0,
    damaged: false,
  }));

  return {
    get damaged() {
      return bars.some((b) => b.damaged);
    },
    stampNonlinear(ctx) {
      for (const b of bars) if (!b.damaged) b.junction.stamp(ctx, b.a, b.k);
    },
    onSolved(op) {
      for (const b of bars) {
        if (b.damaged) continue;
        const vd = op.v(b.a) - op.v(b.k);
        b.current = b.junction.current(vd);
        if (b.current > currentAbsMax || -vd > reverseVoltageMax || b.overstress.update(b.current > currentMax, op.dt)) {
          b.damaged = true;
          b.current = 0;
        }
      }
    },
    observables: () => {
      const out: Record<string, number | boolean> = {};
      let lit = 0;
      bars.forEach((b, i) => {
        const v = b.damaged ? 0 : Math.min(1, Math.max(0, b.current) / I_REF);
        out[`bar${i}`] = v;
        if (v > 0.05) lit++;
      });
      out.lit = lit;
      out.damaged = bars.some((b) => b.damaged);
      return out;
    },
  };
}

const LIGHT: Record<BarColor, string> = { red: '#ff3b30', green: '#4dff7a', yellow: '#ffd23f', blue: '#4f8dff' };

/** DIP-20 body straddling the gap with ten bars across it; the bevelled corner marks the + side. */
function view(props: LedBarProps, obs: Record<string, unknown>): string {
  const colors = barColors(props.color);
  const pins = Array.from({ length: SEGMENT_COUNT }, (_, x) => `<circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/><circle cx="${x}" cy="3" r="0.13" fill="#5f646b"/>`).join('');
  const bars = colors
    .map((c, i) => {
      const b = Math.min(1, Number(obs[`bar${i}`] ?? 0));
      const on = b > 0.02;
      return `<rect x="${i - 0.3}" y="0.75" width="0.6" height="1.5" rx="0.05" fill="${on ? LIGHT[c] : '#3a3536'}" opacity="${on ? 0.45 + b * 0.55 : 1}"/>`;
    })
    .join('');
  return `
    ${pins}
    <path d="M-0.15,0.3 H9.45 V2.7 H-0.45 V0.6 Z" fill="#1c1a1b" stroke="#000" stroke-width="0.04"/>
    ${bars}`;
}

export const ledBar: PartModule<LedBarProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-0.7 -0.4 10.4 3.8',
  doc,
};
export default ledBar;
