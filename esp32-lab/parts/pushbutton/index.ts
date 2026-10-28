import { MS, US, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export interface PushbuttonProps {
  bounce: boolean;
  [key: string]: boolean;
}

const R_CLOSED = 0.05;
const G_OPEN = 1e-12;

/**
 * The legs straddling the breadboard gap (a1–a2, b1–b2) are always joined; pressing joins a to b.
 * Real contacts chatter for a few ms when they close or open, which is exactly what lesson 02's
 * debounce code has to cope with, so we reproduce it.
 */
function create(props: PushbuttonProps, env: PartEnv): PartBehavior {
  let pressed = false; // what the user is doing
  let closed = false; // what the contact is doing
  let bouncesLeft = 0;
  // Bumped on every new transition so timers left over from an earlier one are ignored
  let generation = 0;

  const setContact = (value: boolean) => {
    if (closed !== value) {
      closed = value;
      env.invalidate();
    }
  };

  const startTransition = () => {
    if (!props.bounce) {
      setContact(pressed);
      return;
    }
    // 2–6 chatter edges over roughly 1–5 ms
    generation++;
    bouncesLeft = 2 + Math.floor(env.random() * 3) * 2;
    setContact(!closed);
    env.schedule(env.now() + 200 * US + env.random() * MS, `bounce:${generation}`);
  };

  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('a1', 'b1', closed ? 1 / R_CLOSED : G_OPEN);
    },
    onEvent(ev) {
      if (ev.kind === 'press' || ev.kind === 'release') {
        const want = ev.kind === 'press';
        if (want === pressed) return;
        pressed = want;
        startTransition();
      } else if (ev.kind === 'timer' && ev.tag === `bounce:${generation}`) {
        if (bouncesLeft > 0) {
          bouncesLeft--;
          setContact(!closed);
          env.schedule(env.now() + 200 * US + env.random() * MS, ev.tag);
        } else {
          setContact(pressed);
        }
      }
    },
    observables: () => ({ pressed, closed }),
  };
}

const defs = `
  <linearGradient id="btn-frame" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#e9ecef"/><stop offset="0.5" stop-color="#aab1b9"/><stop offset="1" stop-color="#7d848c"/>
  </linearGradient>
  <radialGradient id="btn-cap" cx="40%" cy="35%" r="70%">
    <stop offset="0" stop-color="#5d6168"/><stop offset="0.7" stop-color="#2a2c30"/><stop offset="1" stop-color="#151618"/>
  </radialGradient>
  <radialGradient id="btn-cap-down" cx="50%" cy="55%" r="70%">
    <stop offset="0" stop-color="#303236"/><stop offset="1" stop-color="#0d0e10"/>
  </radialGradient>`;

/**
 * 6 × 6 mm tactile switch straddling the breadboard gap: metal frame, black body and round
 * cap. The legs a1/a2 (left) and b1/b2 (right) bend down into the holes.
 */
function view(_props: PushbuttonProps, obs: Record<string, unknown>): string {
  const pressed = obs.pressed === true;
  const legs = [0, 2]
    .map((x) => [0, 3].map((y) => `<path d="M${x},${y} V${y === 0 ? 0.35 : 2.65}" stroke="#a7adb4" stroke-width="0.2" stroke-linecap="square"/><circle cx="${x}" cy="${y}" r="0.13" fill="#5f646b"/>`).join(''))
    .join('');
  return `
    ${legs}
    <rect x="-0.25" y="0.3" width="2.5" height="2.4" rx="0.12" fill="#1f2023"/>
    <rect x="-0.15" y="0.4" width="2.3" height="2.2" rx="0.1" fill="url(#btn-frame)"/>
    ${[0.1, 1.9].map((x) => [0.65, 2.35].map((y) => `<circle cx="${x}" cy="${y}" r="0.08" fill="#5c6168"/>`).join('')).join('')}
    <circle cx="1" cy="1.5" r="0.82" fill="#1b1c1f"/>
    <circle cx="1" cy="${pressed ? 1.53 : 1.5}" r="${pressed ? 0.68 : 0.74}" fill="url(#${pressed ? 'btn-cap-down' : 'btn-cap'})"/>
    ${pressed ? '' : '<path d="M0.55,1.2 A0.55,0.55 0 0 1 1.05,0.9" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="0.07" stroke-linecap="round"/>'}`;
}

export const pushbutton: PartModule<PushbuttonProps> = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  defs,
  icon: '-0.6 -0.6 3.2 4.2',
  // The cap presses the button; the rest of the body drags it
  control: { kind: 'press', cx: 1, cy: 1.5, r: 0.85 },
};
export default pushbutton;
