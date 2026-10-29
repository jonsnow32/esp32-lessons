import { MS, US, type PartBehavior, type PartControl, type PartEnv, type PartModule, type PartProps } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

/** Module pull-ups on CLK and DT. */
const R_PULL = 10_000;
const R_CLOSED = 1;
const G_OPEN = 1e-12;
/** Time between the four contact changes of one detent, turned briskly by hand. */
export const PHASE = 800 * US;
/** Held arrow: one more detent this often. */
export const REPEAT = 120 * MS;

/**
 * Contact states (A = CLK, B = DT; true = shorted to GND) through one clockwise detent: A leads.
 * Counter-clockwise runs the same table with A and B swapped.
 */
const STEPS: [boolean, boolean][] = [
  [true, false],
  [true, true],
  [false, true],
  [false, false],
];

/**
 * KY-040: both contacts open at every detent; turning one detent closes and reopens them a
 * quarter cycle apart, so CLK and DT pulse in quadrature. A tap on an arrow turns one detent;
 * holding it keeps turning. A detent once started always finishes, as a real knob clicks home.
 */
function create(_props: PartProps, env: PartEnv): PartBehavior {
  let a = false;
  let b = false;
  let pressed = false;
  let position = 0;
  /** Direction of the detent in progress: +1 clockwise, −1 counter-clockwise, 0 at rest. */
  let turning = 0;
  /** Direction of the arrow being held, 0 when none. */
  let holding = 0;
  let phase = 0;

  const step = () => {
    const [sa, sb] = STEPS[phase]!;
    [a, b] = turning > 0 ? [sa, sb] : [sb, sa];
    env.invalidate();
    if (++phase < STEPS.length) {
      env.schedule(env.now() + PHASE, 'phase');
      return;
    }
    position += turning;
    phase = 0;
    if (holding) env.schedule(env.now() + REPEAT, 'detent');
    else turning = 0;
  };

  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('vcc', 'clk', 1 / R_PULL);
      ctx.conductance('vcc', 'dt', 1 / R_PULL);
      ctx.conductance('clk', 'gnd', a ? 1 / R_CLOSED : G_OPEN);
      ctx.conductance('dt', 'gnd', b ? 1 / R_CLOSED : G_OPEN);
      ctx.conductance('sw', 'gnd', pressed ? 1 / R_CLOSED : G_OPEN);
    },
    onEvent(ev) {
      if (ev.kind === 'press' || ev.kind === 'release') {
        const down = ev.kind === 'press';
        if (ev.key === 'cw' || ev.key === 'ccw') {
          const dir = ev.key === 'cw' ? 1 : -1;
          if (down) {
            holding = dir;
            if (turning === 0) {
              turning = dir;
              step();
            }
          } else if (holding === dir) {
            holding = 0;
          }
        } else if (down !== pressed) {
          pressed = down;
          env.invalidate();
        }
      } else if (ev.kind === 'timer') {
        if (ev.tag === 'phase') step();
        else if (ev.tag === 'detent') {
          // Waiting between detents: go on in whichever direction is held now, or stop
          turning = holding;
          if (turning) step();
        }
      }
    },
    persist: () => position,
    restore(state) {
      position = state as number;
    },
    observables: () => ({ position, clk: !a, dt: !b, pressed, turning }),
  };
}

/** Black module with the knurled knob; the pointer shows the position (20 detents a turn). */
function view(_props: PartProps, obs: Record<string, unknown>): string {
  const angle = (Number(obs.position ?? 0) % 20) * 18;
  const down = obs.pressed === true;
  const arrow = (x: number, cw: boolean, active: boolean) =>
    `<circle cx="${x}" cy="-6" r="0.6" fill="${active ? '#3e63dd' : '#3a3d42'}"/><text x="${x}" y="-5.75" font-size="0.75" text-anchor="middle" fill="#fff" font-family="ui-sans-serif, system-ui">${cw ? '⟳' : '⟲'}</text>`;
  return `
    ${[0, 1, 2, 3, 4].map((x) => `<path d="M${x},0 V-0.6" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.9" y="-7" width="5.8" height="6.4" rx="0.2" fill="#2a2c30" stroke="#000" stroke-width="0.05"/>
    <rect x="0.4" y="-5.2" width="3.2" height="3.2" rx="0.1" fill="#c9ced6" stroke="#6f767e" stroke-width="0.05"/>
    <g transform="translate(2,-3.6) rotate(${angle})">
      <circle r="${down ? 1.2 : 1.3}" fill="#3a3d42" stroke="#15161a" stroke-width="0.08" stroke-dasharray="0.12 0.1"/>
      <circle r="0.95" fill="#55595f"/>
      <rect x="-0.08" y="-1.15" width="0.16" height="0.7" fill="#f2f5f9"/>
    </g>
    ${arrow(0.2, false, Number(obs.turning) < 0)}${arrow(3.8, true, Number(obs.turning) > 0)}
    <text x="2" y="-0.95" font-size="0.32" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">CLK DT SW + GND</text>`;
}

const control: PartControl[] = [
  { kind: 'press', key: 'ccw', cx: 0.2, cy: -6, r: 0.65 },
  { kind: 'press', key: 'cw', cx: 3.8, cy: -6, r: 0.65 },
  { kind: 'press', key: 'sw', cx: 2, cy: -3.6, r: 1.25 },
];

export const rotaryEncoder: PartModule = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-1.2 -7.3 6.4 7.7',
  control,
  doc,
};
export default rotaryEncoder;
