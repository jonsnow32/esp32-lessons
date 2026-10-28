# Writing a part

A part is a folder in `parts/` with three files:

```
parts/my-part/
  part.json     static description (terminals, footprint, props, ratings)
  index.ts      behavior: exports a PartModule
  package.json  { "name": "@esp32lab-parts/my-part", "main": "index.ts" }
```

Register it in the kernel's `parts` registry (`{ 'my-part': myPart }`) and it can be placed on a
breadboard, used on a board (`onboard`), and referenced by lesson checks (`{ "type": "my-part" }`).
The kernel and solver never need to change.

## 1. part.json

- `terminals`: name plus offset in breadboard pitches from the first terminal. A resistor's legs
  are 4 holes apart (`dx: 4`), an LED's 1, and a pushbutton straddles the centre gap (`dy: 3`).
- `internalShorts`: legs that are always joined inside the part.
- `props`: user-editable values with defaults (`number`, `enum`, `boolean`).
- `ratings`: `currentMax`, `currentAbsMax`, `reverseVoltageMax`, `powerMax`, `overstressTime`.
  Take the values from the datasheet; they decide when the part "burns out".

## 2. Behavior

```ts
import { type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export const myPart: PartModule = {
  manifest: manifest as unknown as PartModule['manifest'],
  create(props, env) {
    let damaged = false;
    return {
      get damaged() { return damaged; },
      stamp(ctx) { /* linear: ctx.conductance('a', 'b', g), ctx.current('a', 'b', i) */ },
      stampNonlinear(ctx) { /* linearise around ctx.v('a') - ctx.v('b'); call ctx.limited() if you clamp */ },
      onSolved(op) { /* read op.v(), update observables, accumulate overstress with op.dt */ },
      onEvent(ev) { /* 'press' | 'release' | 'timer' | 'set' */ },
      observables: () => ({ damaged }),
    };
  },
};
```

Rules:

- **Stamp by terminal name only.** Never assume which net a terminal is on.
- **Sign convention:** `ctx.current(a, b, i)` pushes `i` amperes from `a` to `b` through the part.
- **Nonlinear parts** stamp the companion model `g = dI/dV`, `Ieq = I(v) − g·v`, and limit
  junction steps with `pnjlim`. If the limit changed the value, call `ctx.limited()`, otherwise the
  solver may stop at a wrong answer.
- **Time-dependent behaviour** uses `env.schedule(at, tag)` and `onEvent({ kind: 'timer', tag })`.
  Call `env.invalidate()` when the electrical state changes (a switch moves).
- **Randomness** only via `env.random()`, so simulations stay reproducible.
- **Damage**: use `Overstress` for "too much for too long" and an absolute limit for instant
  failure. Model the failed state electrically (a burnt LED is open circuit).

See `parts/led/index.ts` (nonlinear + damage) and `parts/pushbutton/index.ts` (switch + contact
bounce) for complete examples.

## 3. Test it

Add a case to `test/` that builds a small project around the part and checks the physics against
the datasheet (current, voltage, timing). Run `pnpm test`.
