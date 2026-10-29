import { MS, US, type PartBehavior, type PartEnv, type PartModule, type PartProps } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

/** Pulse widths for 0° and 180°. */
export const PULSE_MIN = 500 * US;
export const PULSE_MAX = 2500 * US;
/** Pulses outside this are not position commands. */
const PULSE_VALID_MIN = 300 * US;
const PULSE_VALID_MAX = 3000 * US;
/** No-load speed at 4.8 V: 0.1 s per 60°. */
export const DEG_PER_S = 600;
const TICK = 10 * MS;
const V_MIN = 3.5;
/** Signal input: a few tens of kΩ to GND. */
const R_SIG = 20_000;
/** Motor current while turning, and the electronics' idle current, from V+. */
const I_MOVING = 0.25;
const I_IDLE = 0.006;

/** Angle a pulse width commands, 0–180°. */
export function angleFor(widthNs: number): number {
  return Math.min(180, Math.max(0, ((widthNs - PULSE_MIN) / (PULSE_MAX - PULSE_MIN)) * 180));
}

/**
 * The control board compares each pulse with the pot on the output shaft and runs the motor
 * towards the commanded angle. Pulses come either as a PWM waveform (LEDC) or as edges the
 * sketch makes itself; the motor turns at its rated speed and draws current from V+ meanwhile.
 */
function create(_props: PartProps, env: PartEnv): PartBehavior {
  let powered = false;
  let angle = 90;
  let target = 90;
  let pulse = 0;
  let moving = false;
  let vs = 0;
  let sigHigh = false;
  let riseAt = 0;

  const command = (widthNs: number) => {
    if (widthNs < PULSE_VALID_MIN || widthNs > PULSE_VALID_MAX) return;
    pulse = widthNs;
    target = angleFor(widthNs);
    if (powered && !moving && Math.abs(target - angle) > 0.5) {
      moving = true;
      env.invalidate();
      env.schedule(env.now() + TICK, 'tick');
    }
  };

  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('sig', 'gnd', 1 / R_SIG);
      if (powered) {
        // Constant-current-ish load, as a resistance at the present supply voltage
        const i = moving ? I_MOVING : I_IDLE;
        ctx.conductance('vcc', 'gnd', i / Math.max(vs, V_MIN));
      }
    },
    onSolved(op) {
      vs = op.v('vcc') - op.v('gnd');
      const on = vs >= V_MIN;
      if (on !== powered) {
        powered = on;
        env.invalidate();
        if (on) command(pulse);
      }
      const wave = op.pwm?.('sig');
      if (wave) {
        command(wave.highNs);
        return;
      }
      // A sketch toggling the pin itself: time each HIGH pulse
      const v = op.v('sig') - op.v('gnd');
      if (!sigHigh && v > 1.6) {
        sigHigh = true;
        riseAt = op.t;
      } else if (sigHigh && v < 1.0) {
        sigHigh = false;
        command(op.t - riseAt);
      }
    },
    onEvent(ev) {
      if (ev.kind !== 'timer' || ev.tag !== 'tick') return;
      if (!powered) {
        moving = false;
        env.invalidate();
        return;
      }
      const step = (DEG_PER_S * TICK) / 1e9;
      const d = target - angle;
      angle = Math.abs(d) <= step ? target : angle + Math.sign(d) * step;
      if (angle === target) {
        moving = false;
        env.invalidate();
      } else {
        env.schedule(env.now() + TICK, 'tick');
      }
    },
    persist: () => ({ angle, target, pulse }),
    restore(state) {
      ({ angle, target, pulse } = state as { angle: number; target: number; pulse: number });
    },
    observables: () => ({ powered, angle, target, pulseUs: pulse / US, moving }),
  };
}

/** Blue SG90 seen from above: the body, the mounting ears and the white horn at the angle. */
function view(_props: PartProps, obs: Record<string, unknown>): string {
  const angle = Number(obs.angle ?? 90);
  // 0° points right, 180° left; the shaft sits near one end of the body
  const rot = -angle;
  return `
    ${[0, 1, 2].map((x, i) => `<path d="M${x},0 V-1.4" stroke="${['#6b3e26', '#d8343a', '#f08a24'][i]}" stroke-width="0.22"/><circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('')}
    <rect x="-0.3" y="-1.9" width="2.6" height="0.6" rx="0.1" fill="#1f2023"/>
    <rect x="-2.6" y="-6.6" width="7.2" height="4.6" rx="0.25" fill="#2f6fd0" stroke="#1d4f9c" stroke-width="0.06"/>
    <rect x="-3.6" y="-5.1" width="9.2" height="1.6" rx="0.2" fill="#2f6fd0" stroke="#1d4f9c" stroke-width="0.06"/>
    <circle cx="-3.05" cy="-4.3" r="0.25" fill="#16335f"/><circle cx="5.05" cy="-4.3" r="0.25" fill="#16335f"/>
    <text x="1.6" y="-2.4" font-size="0.42" text-anchor="middle" fill="#dbe6ff" font-family="ui-monospace, monospace">SG90</text>
    <circle cx="-0.6" cy="-4.3" r="1.25" fill="#2a5fb5"/>
    <g transform="translate(-0.6,-4.3) rotate(${rot})">
      <path d="M-0.45,0 L-0.25,-0.5 L3.1,-0.25 A0.25,0.25 0 0 1 3.1,0.25 L-0.25,0.5 Z" fill="#f2f3f5" stroke="#9aa1a9" stroke-width="0.05"/>
      ${[1.2, 1.9, 2.6].map((x) => `<circle cx="${x}" cy="0" r="0.08" fill="#9aa1a9"/>`).join('')}
    </g>
    <circle cx="-0.6" cy="-4.3" r="0.45" fill="#f2f3f5" stroke="#9aa1a9" stroke-width="0.05"/>
    <circle cx="-0.6" cy="-4.3" r="0.12" fill="#9aa1a9"/>`;
}

export const servo: PartModule = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-4.2 -8.2 10.4 8.5',
  doc,
};
export default servo;
