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
- `isolated`: terminal groups with no path between them inside the part (a relay's coil side
  and its contacts), so the workbench doesn't call a shared supply across them a short.
- `props`: user-editable values with defaults (`number`, `enum`, `boolean`).
- `stock`: the props that make a different item to buy and keep (`["resistance"]`, `["color"]`),
  not the ones the simulation varies (temperature, knob position). The user's parts box and the
  projects' bills of materials count items by them; omit it when the type alone is the item.
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
- **Fast serial data** (WS2812, anything an MCU sends with the RMT) arrives whole in
  `pulses(terminal, train)`: `train.t` is when it started, `train.pulses` the levels and their
  durations in ns. Decode it yourself; pass data on with `env.emit(terminal, train)`. See
  `parts/neopixel/index.ts`.
- **Coupling without a wire** (a pump wetting the soil a probe sits in) goes through
  `env.world.get(key)` / `env.world.set(key, value)`. The writer re-derives its value on every
  solve, since the world starts empty after a rebuild. See `parts/water-pump/index.ts`.
- **I2C devices** expose `i2c: I2cTarget` and name their SDA/SCL terminals in the module's `bus`.
  State that must survive a rebuild of the circuit (what a display shows) goes through
  `persist()` / `restore()`. See `parts/lcd1602/index.ts`.
- **Damage**: use `Overstress` for "too much for too long" and an absolute limit for instant
  failure. Model the failed state electrically (a burnt LED is open circuit).

- **Diodes and LEDs** use `Junction` from the SDK (`Junction.fit(vf, i, n)` from a datasheet
  point, then `junction.stamp(ctx, anode, cathode)`): it does the companion model and `pnjlim`.

See `parts/led/index.ts` (nonlinear + damage), `parts/pushbutton/index.ts` (switch + contact
bounce), `parts/rgb-led/index.ts` (several junctions in one part) and `parts/buzzer/index.ts`
(a smooth nonlinear load that needs no step limiting) for complete examples.

## 3. In the workbench

Optional fields on the `PartModule`:

- `view` + `defs`: the SVG drawing. Leads drawn as straight lines must not use bounding-box
  gradients (a horizontal line has zero height and paints nothing); use `gradientUnits="userSpaceOnUse"`.
- `icon`: viewBox (pitch units) framing the view in the parts library.
- `control`: a clickable spot, or an array of them. `{ kind: 'press' }` sends press/release while
  held (push button); with `key` (`{ kind: 'press', key: '5' }`) the events carry it, so one part
  can have many buttons (keypad keys, an encoder's turn arrows). `{ kind: 'toggle', prop }` flips
  a boolean prop or steps an enum prop (slide switch). Anything the user sets that must survive a
  circuit rebuild belongs in a prop, not in behavior state.
- Number props without `options` get a slider in the inspector (the potentiometer's knob).

## 4. Test it

Add a case to `test/` that builds a small project around the part and checks the physics against
the datasheet (current, voltage, timing). Run `pnpm test`.
