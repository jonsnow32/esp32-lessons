import type { PartBehavior, PartEnv, PartModule } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

export interface JoystickProps {
  /** Stick position, 0–100 % along each axis; 50 is centred. */
  x: number;
  y: number;
  [key: string]: number;
}

const R_TRACK = 10_000;
/** Contact resistance where the wiper meets the end of the track. */
const R_END = 20;
const R_CLOSED = 0.1;
const G_OPEN = 1e-12;

/** Two 10 kΩ potentiometers between +5V and GND with their wipers on VRx / VRy, and SW to GND when the stick is pressed. */
function create(props: JoystickProps, env: PartEnv): PartBehavior {
  const split = (pct: number): [number, number] => {
    const k = Math.min(1, Math.max(0, pct / 100));
    return [R_TRACK * (1 - k) + R_END, R_TRACK * k + R_END];
  };
  const [xTop, xBottom] = split(props.x);
  const [yTop, yBottom] = split(props.y);
  let pressed = false;

  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('vcc', 'vrx', 1 / xTop);
      ctx.conductance('vrx', 'gnd', 1 / xBottom);
      ctx.conductance('vcc', 'vry', 1 / yTop);
      ctx.conductance('vry', 'gnd', 1 / yBottom);
      ctx.conductance('sw', 'gnd', pressed ? 1 / R_CLOSED : G_OPEN);
    },
    onEvent(ev) {
      if (ev.kind !== 'press' && ev.kind !== 'release') return;
      const want = ev.kind === 'press';
      if (want !== pressed) {
        pressed = want;
        env.invalidate();
      }
    },
    observables: () => ({ x: props.x, y: props.y, pressed }),
  };
}

const defs = `
  <radialGradient id="joy-cap" cx="40%" cy="35%" r="70%">
    <stop offset="0" stop-color="#5d6168"/><stop offset="0.7" stop-color="#2a2c30"/><stop offset="1" stop-color="#151618"/>
  </radialGradient>`;

/** Red module with the gimbal and the black thumb cap, moved off centre by x / y. */
function view(props: JoystickProps, obs: Record<string, unknown>): string {
  const cx = 2 + ((props.x - 50) / 50) * 1.1;
  const cy = -3.6 - ((props.y - 50) / 50) * 1.1;
  const down = obs.pressed === true;
  return `
    ${[0, 1, 2, 3, 4].map((x) => `<path d="M${x},0 V-0.6" stroke="#d4a72c" stroke-width="0.14"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.9" y="-7.4" width="5.8" height="6.8" rx="0.2" fill="#2a2c30" stroke="#000" stroke-width="0.05"/>
    <rect x="0.1" y="-5.7" width="3.8" height="4.2" rx="0.15" fill="#c9ced6" stroke="#6f767e" stroke-width="0.05"/>
    <circle cx="2" cy="-3.6" r="1.6" fill="#1b1c1f"/>
    <circle cx="${cx}" cy="${cy}" r="${down ? 1.25 : 1.35}" fill="url(#joy-cap)" stroke="#000" stroke-width="0.05"/>
    ${[0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${cx + Math.cos((a * Math.PI) / 180) * 0.8}" cy="${cy + Math.sin((a * Math.PI) / 180) * 0.8}" r="0.12" fill="#3a3d42"/>`).join('')}
    <text x="2" y="-0.95" font-size="0.32" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">GND +5V VRx VRy SW</text>`;
}

export const joystick: PartModule<JoystickProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-1.2 -7.7 6.4 8',
  // The thumb cap presses the stick's button
  control: { kind: 'press', cx: 2, cy: -3.6, r: 1.4 },
  doc,
};
export default joystick;
