import { Overstress, type PartBehavior, type PartEnv, type PartModule } from '@esp32lab/part-sdk';
import manifest from './part.json';

export interface ResistorProps {
  resistance: number;
  [key: string]: number;
}

function create(props: ResistorProps, _env: PartEnv): PartBehavior {
  const r = props.resistance;
  const powerMax = manifest.ratings.powerMax;
  const overstress = new Overstress(manifest.ratings.overstressTime);
  let current = 0;
  let power = 0;
  let damaged = false;

  return {
    get damaged() {
      return damaged;
    },
    stamp(ctx) {
      // A burnt resistor goes open circuit
      if (!damaged) ctx.conductance('a', 'b', 1 / r);
    },
    onSolved(op) {
      const v = op.v('a') - op.v('b');
      current = damaged ? 0 : v / r;
      power = v * current;
      if (overstress.update(power > powerMax, op.dt)) damaged = true;
    },
    observables: () => ({ current, power, damaged }),
  };
}

export const resistor: PartModule<ResistorProps> = { manifest: manifest as PartModule['manifest'], create };
export default resistor;
