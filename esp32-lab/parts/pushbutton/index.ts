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

export const pushbutton: PartModule<PushbuttonProps> = { manifest: manifest as unknown as PartModule['manifest'], create };
export default pushbutton;
