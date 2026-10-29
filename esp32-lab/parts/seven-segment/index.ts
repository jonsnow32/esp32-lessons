import { Junction, Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export type SegmentColor = 'red' | 'green' | 'blue' | 'yellow';

export interface SevenSegmentProps {
  common: 'cathode' | 'anode';
  color: SegmentColor;
  [key: string]: string;
}

export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Which segments each digit lights. */
export const DIGITS: Record<number, Segment[]> = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'],
  1: ['b', 'c'],
  2: ['a', 'b', 'd', 'e', 'g'],
  3: ['a', 'b', 'c', 'd', 'g'],
  4: ['b', 'c', 'f', 'g'],
  5: ['a', 'c', 'd', 'f', 'g'],
  6: ['a', 'c', 'd', 'e', 'f', 'g'],
  7: ['a', 'b', 'c'],
  8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  9: ['a', 'b', 'c', 'd', 'f', 'g'],
};

/** Forward voltage of one segment at 10 mA. */
export const FORWARD_VOLTAGE: Record<SegmentColor, number> = { red: 1.9, yellow: 2.0, green: 2.1, blue: 3.0 };

const I_REF = 0.01;
const EMISSION = 2;

/** The digit the lit segments spell, if they spell one. */
export function readDigit(lit: Iterable<Segment>): number | null {
  const on = new Set<Segment>([...lit].filter((s) => s !== 'dp'));
  for (const [d, segs] of Object.entries(DIGITS)) {
    if (segs.length === on.size && segs.every((s) => on.has(s))) return Number(d);
  }
  return null;
}

/**
 * Eight LEDs sharing one leg: from each segment pin to the common pin (common cathode) or the
 * other way round (common anode). Each segment burns out on its own, like a real display.
 */
function create(props: SevenSegmentProps, _env: PartEnv): PartBehavior {
  const vf = FORWARD_VOLTAGE[props.color] ?? FORWARD_VOLTAGE.red;
  const anode = props.common === 'anode';
  const { currentMax, currentAbsMax, reverseVoltageMax, overstressTime } = manifest.ratings;
  const segs = SEGMENTS.map((name) => ({ name, junction: Junction.fit(vf, I_REF, EMISSION), overstress: new Overstress(overstressTime), current: 0, damaged: false }));
  const ends = (name: string): [string, string] => (anode ? ['com1', name] : [name, 'com1']);

  return {
    get damaged() {
      return segs.some((s) => s.damaged);
    },
    stampNonlinear(ctx) {
      for (const s of segs) if (!s.damaged) s.junction.stamp(ctx, ...ends(s.name));
    },
    onSolved(op) {
      for (const s of segs) {
        if (s.damaged) continue;
        const [a, k] = ends(s.name);
        const vd = op.v(a) - op.v(k);
        s.current = s.junction.current(vd);
        if (s.current > currentAbsMax || -vd > reverseVoltageMax || s.overstress.update(s.current > currentMax, op.dt)) {
          s.damaged = true;
          s.current = 0;
        }
      }
    },
    observables: () => {
      const out: Record<string, number | boolean> = {};
      const lit: Segment[] = [];
      for (const s of segs) {
        const b = s.damaged ? 0 : Math.min(1, Math.max(0, s.current) / I_REF);
        out[s.name] = b;
        if (b > 0.05) lit.push(s.name);
      }
      out.digit = readDigit(lit) ?? -1;
      out.damaged = segs.some((s) => s.damaged);
      return out;
    },
  };
}

const LIGHT: Record<SegmentColor, string> = { red: '#ff3b30', green: '#4dff7a', blue: '#4f8dff', yellow: '#ffd23f' };

/** Segment outlines in pitch units inside the body: a hexagonal bar each, dp a dot. */
const SHAPES: Record<Exclude<Segment, 'dp'>, string> = (() => {
  const x0 = 0.75, x1 = 3.05, y0 = 0.95, ym = 3.0, y1 = 5.05, t = 0.36;
  const h = (y: number) => `M${x0 + t},${y} l${t / 2},-${t / 2} H${x1 - t * 1.5} l${t / 2},${t / 2} l-${t / 2},${t / 2} H${x0 + t * 1.5} Z`;
  const v = (x: number, ya: number, yb: number) => `M${x},${ya + t} l${t / 2},${t / 2} V${yb - t * 1.5} l-${t / 2},${t / 2} l-${t / 2},-${t / 2} V${ya + t * 1.5} Z`;
  return { a: h(y0), g: h(ym), d: h(y1), f: v(x0, y0, ym), b: v(x1, y0, ym), e: v(x0, ym, y1), c: v(x1, ym, y1) };
})();

/** Dark face with the figure-8 of segments; unlit segments stay faintly visible as on the real part. */
function view(props: SevenSegmentProps, obs: Record<string, unknown>): string {
  const light = LIGHT[props.color] ?? LIGHT.red;
  const glow = (s: Segment) => Math.min(1, Number(obs[s] ?? 0));
  const seg = (s: Exclude<Segment, 'dp'>) => {
    const b = glow(s);
    return `<path d="${SHAPES[s]}" fill="${b > 0.02 ? light : '#3a3536'}" opacity="${b > 0.02 ? 0.45 + b * 0.55 : 1}"/>`;
  };
  const dp = glow('dp');
  const pins = [0, 1, 2, 3, 4].map((x) => `<circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/><circle cx="${x}" cy="6" r="0.13" fill="#5f646b"/>`).join('');
  return `
    ${pins}
    <rect x="-0.45" y="0.25" width="4.9" height="5.5" rx="0.12" fill="#e9eaec" stroke="#9aa1a9" stroke-width="0.05"/>
    <rect x="-0.3" y="0.4" width="4.6" height="5.2" rx="0.08" fill="#1c1a1b"/>
    <g transform="skewX(-6) translate(0.35,0)">${(Object.keys(SHAPES) as Exclude<Segment, 'dp'>[]).map(seg).join('')}</g>
    <circle cx="3.75" cy="5.1" r="0.22" fill="${dp > 0.02 ? light : '#3a3536'}" opacity="${dp > 0.02 ? 0.45 + dp * 0.55 : 1}"/>
    ${obs.damaged === true ? '<path d="M0.2,1 L3.8,5" stroke="#00000080" stroke-width="0.15"/>' : ''}`;
}

export const sevenSegment: PartModule<SevenSegmentProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-0.7 -0.4 5.4 6.8',
  doc,
};
export default sevenSegment;
