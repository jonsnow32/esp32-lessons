import { Junction, Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export type LedColor = 'red' | 'yellow' | 'green' | 'blue' | 'white';

export interface LedProps {
  color: LedColor;
  [key: string]: string;
}

/** Typical forward voltage at 20 mA for 5 mm LEDs. */
export const FORWARD_VOLTAGE: Record<LedColor, number> = {
  red: 1.8,
  yellow: 2.0,
  green: 2.1,
  blue: 3.0,
  white: 3.0,
};

const I_REF = 0.02;
const EMISSION = 2; // ideality factor n

function create(props: LedProps, _env: PartEnv): PartBehavior {
  const vf = FORWARD_VOLTAGE[props.color] ?? FORWARD_VOLTAGE.red;
  // Saturation current chosen so I(vf) = 20 mA
  const junction = Junction.fit(vf, I_REF, EMISSION);
  const { currentMax, currentAbsMax, reverseVoltageMax, overstressTime } = manifest.ratings;
  const overstress = new Overstress(overstressTime);

  let current = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stampNonlinear(ctx) {
      // A destroyed LED is modelled as open circuit (the usual failure mode)
      if (!damaged) junction.stamp(ctx, 'anode', 'cathode');
    },
    onSolved(op) {
      if (damaged) return;
      const vd = op.v('anode') - op.v('cathode');
      current = junction.current(vd);
      if (
        current > currentAbsMax ||
        -vd > reverseVoltageMax ||
        overstress.update(current > currentMax, op.dt)
      ) {
        damaged = true;
        current = 0;
      }
    },
    observables: () => ({
      current,
      // Perceived brightness: roughly linear in current, saturating at the rated current
      brightness: damaged ? 0 : Math.min(1, Math.max(0, current) / I_REF),
      damaged,
    }),
  };
}

/**
 * Lens tint (unlit), emitted colour, and halo colour for each LED colour. The halo is what makes a
 * lit LED readable on the light breadboard: white light alone vanishes there, so white LEDs get the
 * cool blue fringe real phosphor-white LEDs show.
 */
const COLORS: Record<LedColor, { lens: string; light: string; halo: string }> = {
  red: { lens: '#d8343a', light: '#ff4a3d', halo: '#ff2a1f' },
  yellow: { lens: '#e8c21a', light: '#ffe14d', halo: '#ffa51f' },
  green: { lens: '#2f9e5e', light: '#5dff8f', halo: '#16d65a' },
  blue: { lens: '#3557c7', light: '#5aa0ff', halo: '#2f6bff' },
  white: { lens: '#e6e9ee', light: '#ffffff', halo: '#7fb2ff' },
};

const defs = Object.entries(COLORS)
  .map(
    ([name, c]) => `
  <radialGradient id="led-lens-${name}" cx="35%" cy="30%" r="80%">
    <stop offset="0" stop-color="#fff" stop-opacity="0.55"/>
    <stop offset="0.25" stop-color="${c.lens}" stop-opacity="0.75"/>
    <stop offset="1" stop-color="${c.lens}" stop-opacity="0.95"/>
  </radialGradient>
  <radialGradient id="led-bloom-${name}">
    <stop offset="0" stop-color="${c.halo}" stop-opacity="0.55"/>
    <stop offset="0.45" stop-color="${c.halo}" stop-opacity="0.18"/>
    <stop offset="1" stop-color="${c.halo}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="led-glow-${name}">
    <stop offset="0" stop-color="${c.light}" stop-opacity="1"/>
    <stop offset="0.3" stop-color="${c.light}" stop-opacity="0.6"/>
    <stop offset="0.6" stop-color="${c.halo}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${c.halo}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="led-ray-${name}">
    <stop offset="0" stop-color="${c.light}" stop-opacity="1"/>
    <stop offset="0.4" stop-color="${c.halo}" stop-opacity="0.6"/>
    <stop offset="1" stop-color="${c.halo}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="led-lit-${name}" cx="50%" cy="72%" r="75%">
    <stop offset="0" stop-color="#fff" stop-opacity="1"/>
    <stop offset="0.35" stop-color="${c.light}" stop-opacity="0.9"/>
    <stop offset="1" stop-color="${c.halo}" stop-opacity="0.45"/>
  </radialGradient>`,
  )
  .join('') +
  `<linearGradient id="led-lead" x1="0" x2="1"><stop offset="0" stop-color="#8d939b"/><stop offset="0.5" stop-color="#e3e6ea"/><stop offset="1" stop-color="#80868e"/></linearGradient>
  <filter id="led-soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="0.1"/></filter>`;

const f = (x: number) => +x.toFixed(3);

/** A tapered four-pointed star of length `len` around the origin, `w` wide at the waist. */
const star = (len: number, w: number) =>
  `M0,${f(-len)} L${w},${-w} L${f(len)},0 L${w},${w} L0,${f(len)} L${-w},${w} L${f(-len)},0 L${-w},${-w} Z`;

/**
 * Light that spills outside the lens, drawn behind it: a wide breathing bloom in the halo colour, a
 * brighter halo hugging the lens, and slowly turning rays. Animations are SMIL with the default
 * begin (document time 0), so a redraw at a new brightness picks up in phase instead of restarting.
 */
function spill(name: string, glow: number): string {
  const r1 = 2.4 + glow * 2.6;
  const r2 = 1.4 + glow * 1.2;
  const ray = 1.6 + glow * 1.8;
  const o1 = 0.35 + glow * 0.55;
  return `
    <g pointer-events="none">
      <circle cx="0.5" cy="-2.3" r="${f(r1)}" fill="url(#led-bloom-${name})" opacity="${f(o1)}">
        <animate attributeName="opacity" values="${f(o1)};${f(o1 * 0.7)};${f(o1)}" dur="2.6s" repeatCount="indefinite"/>
        <animate attributeName="r" values="${f(r1)};${f(r1 * 1.08)};${f(r1)}" dur="2.6s" repeatCount="indefinite"/>
      </circle>
      <circle cx="0.5" cy="-2.3" r="${f(r2)}" fill="url(#led-glow-${name})" opacity="${f(0.6 + glow * 0.4)}">
        <animate attributeName="r" values="${f(r2)};${f(r2 * 1.06)};${f(r2)}" dur="1.3s" repeatCount="indefinite"/>
      </circle>
      <g transform="translate(0.5,-2.25)" opacity="${f(0.25 + glow * 0.55)}">
        <g>
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite"/>
          <path d="${star(ray, 0.07)}" fill="url(#led-ray-${name})"/>
          <path d="${star(ray * 0.6, 0.05)}" transform="rotate(45)" fill="url(#led-ray-${name})"/>
        </g>
      </g>
    </g>`;
}

/** Light inside the lens, drawn over it: the whole epoxy lit from the die, and a flickering hot core. */
function core(name: string, light: string, glow: number): string {
  const o = 0.55 + glow * 0.45;
  return `
    <g pointer-events="none">
      <path d="M-0.5,-1.3 V-2.45 A1,1 0 0 1 1.5,-2.45 V-1.3 Z" fill="url(#led-lit-${name})" opacity="${f(0.35 + glow * 0.6)}"/>
      <ellipse cx="0.52" cy="-1.95" rx="0.55" ry="0.4" fill="${light}" filter="url(#led-soft)" opacity="${f(o)}">
        <animate attributeName="opacity" values="${f(o)};${f(o * 0.82)};${f(o)}" dur="0.9s" repeatCount="indefinite"/>
      </ellipse>
      <ellipse cx="0.52" cy="-1.9" rx="0.26" ry="0.16" fill="#fff" opacity="${f(0.7 + glow * 0.3)}"/>
    </g>`;
}

/**
 * A 5 mm LED standing on its legs: anode (long, kinked leg) at (0,0), cathode at (1,0) on the
 * side of the flat. Lit LEDs glow in layers (bloom, halo, rays, lit lens, hot core) scaled by brightness.
 */
function view(props: LedProps, obs: Record<string, unknown>): string {
  const name = COLORS[props.color] ? props.color : 'red';
  const c = COLORS[name];
  const glow = Math.min(1, Number(obs.brightness ?? 0));
  const dead = obs.damaged === true;
  const lit = glow > 0.02 && !dead;
  return `
    <path d="M0,0 V-0.55 l-0.12,-0.18 l0.12,-0.18 V-1.05" fill="none" stroke="url(#led-lead)" stroke-width="0.11" stroke-linejoin="round"/>
    <path d="M1,0 V-1.05" stroke="url(#led-lead)" stroke-width="0.11"/>
    <circle cx="0" cy="0" r="0.13" fill="#5f646b"/><circle cx="1" cy="0" r="0.13" fill="#5f646b"/>
    ${lit ? spill(name, glow) : ''}
    <path d="M-0.62,-1.05 H1.48 V-1.3 H-0.62 Z" fill="${dead ? '#2a2a2a' : c.lens}" opacity="0.9"/>
    <path d="M-0.5,-1.3 V-2.45 A1,1 0 0 1 1.5,-2.45 V-1.3 Z" fill="${dead ? '#262626' : `url(#led-lens-${name})`}" stroke="${lit ? c.halo : '#00000040'}" stroke-opacity="${lit ? 0.7 : 1}" stroke-width="0.04"/>
    <path d="M0.18,-1.3 V-1.7 H0.45 L0.6,-1.95 H0.82 V-1.3" fill="none" stroke="#6c7076" stroke-width="0.06" opacity="0.8"/>
    ${lit ? core(name, c.light, glow) : ''}
    <path d="M-0.25,-2.55 A0.75,0.75 0 0 1 0.25,-3.25" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="0.09" stroke-linecap="round"/>
    ${dead ? `<g opacity="0.55"><circle cx="0.3" cy="-3.6" r="0.4" fill="#8a8a8a"/><circle cx="0.8" cy="-4.2" r="0.55" fill="#a0a0a0"/><circle cx="0.4" cy="-4.9" r="0.45" fill="#b5b5b5"/></g>` : ''}`;
}

export const led: PartModule<LedProps> = { manifest: manifest as PartModule['manifest'], create, view, defs, icon: '-1 -2.6 3 3.4', doc };
export default led;
