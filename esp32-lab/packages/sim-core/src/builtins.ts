// Parts the kernel creates itself rather than loading from parts/: MCU pads and board supplies.

import { Overstress, S, type Observable, type OperatingPoint, type PartBehavior, type StampContext } from '@esp32lab/part-sdk';
import type { BoardSupply } from '@esp32lab/project-model';
import type { McuModel, PadDrive } from './mcu';

/**
 * One MCU pad as a Thevenin output stage: on-resistance to VDD or GND when driving, plus the
 * optional ~45 kΩ pull resistor. Terminals: pad, vdd, gnd. A PWM pad drives the level `pwmLevel`
 * gives for the stretch of the period being solved.
 */
export function padBehavior(mcu: McuModel, pad: string, pwmLevel: () => boolean | undefined = () => undefined): PartBehavior {
  const { rOn, rPull, currentMax } = mcu.electrical;
  const overstress = new Overstress(1 * S);
  /** Drive as of the last stamp: onSolved reports time already spent at that operating point. */
  let stamped: PadDrive = mcu.drive(pad);
  let drive = stamped;
  let current = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx: StampContext) {
      stamped = mcu.drive(pad);
      drive = withLevel(stamped, pwmLevel());
      const gOn = 1 / (rOn[drive.strength] ?? rOn[2]!);
      if (drive.output === 'high') ctx.conductance('pad', 'vdd', gOn);
      if (drive.output === 'low') ctx.conductance('pad', 'gnd', gOn);
      if (drive.pull === 'up') ctx.conductance('pad', 'vdd', 1 / rPull);
      if (drive.pull === 'down') ctx.conductance('pad', 'gnd', 1 / rPull);
    },
    onSolved(op: OperatingPoint) {
      drive = withLevel(stamped, pwmLevel());
      const gOn = 1 / (rOn[drive.strength] ?? rOn[2]!);
      // Current sourced (+) or sunk (−) by the output stage
      current =
        drive.output === 'high' ? (op.v('vdd') - op.v('pad')) * gOn
        : drive.output === 'low' ? -op.v('pad') * gOn
        : 0;
      if (!damaged && overstress.update(Math.abs(current) > currentMax, op.dt)) {
        damaged = true;
        mcu.padDamaged?.(pad);
      }
    },
    observables: (): Record<string, Observable> => {
      const pwm = stamped.output !== 'z' ? stamped.pwm : undefined;
      return pwm
        ? { current, output: 'pwm', freq: 1e9 / pwm.periodNs, duty: pwm.highNs / pwm.periodNs, pull: drive.pull, damaged }
        : { current, output: drive.output, pull: drive.pull, damaged };
    },
  };
}

/** A PWM pad at one level of its waveform. */
function withLevel(drive: PadDrive, level: boolean | undefined): PadDrive {
  return drive.pwm && drive.output !== 'z' && level !== undefined ? { ...drive, output: level ? 'high' : 'low' } : drive;
}

/** Regulator or USB supply as a Norton source: V/R into the net, R to ground. Terminals: out, gnd. */
export function supplyBehavior(supply: BoardSupply): PartBehavior {
  const g = 1 / supply.rOut;
  let current = 0;
  return {
    damaged: false,
    stamp(ctx) {
      ctx.conductance('out', 'gnd', g);
      ctx.current('gnd', 'out', supply.volts * g);
    },
    onSolved(op) {
      current = (supply.volts - op.v('out')) * g;
    },
    observables: () => ({ current, volts: supply.volts - current / g, overloaded: current > supply.currentMax }),
  };
}
