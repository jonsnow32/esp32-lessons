// Parts the kernel creates itself rather than loading from parts/: MCU pads and board supplies.

import { Overstress, S, type OperatingPoint, type PartBehavior, type StampContext } from '@esp32lab/part-sdk';
import type { BoardSupply } from '@esp32lab/project-model';
import type { McuModel, PadDrive } from './mcu';

/**
 * One MCU pad as a Thevenin output stage: on-resistance to VDD or GND when driving, plus the
 * optional ~45 kΩ pull resistor. Terminals: pad, vdd, gnd.
 */
export function padBehavior(mcu: McuModel, pad: string): PartBehavior {
  const { rOn, rPull, currentMax } = mcu.electrical;
  const overstress = new Overstress(1 * S);
  let drive: PadDrive = mcu.drive(pad);
  let current = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx: StampContext) {
      drive = mcu.drive(pad);
      const gOn = 1 / (rOn[drive.strength] ?? rOn[2]!);
      if (drive.output === 'high') ctx.conductance('pad', 'vdd', gOn);
      if (drive.output === 'low') ctx.conductance('pad', 'gnd', gOn);
      if (drive.pull === 'up') ctx.conductance('pad', 'vdd', 1 / rPull);
      if (drive.pull === 'down') ctx.conductance('pad', 'gnd', 1 / rPull);
    },
    onSolved(op: OperatingPoint) {
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
    observables: () => ({ current, output: drive.output, pull: drive.pull, damaged }),
  };
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
