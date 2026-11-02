// The chip in live mode: a real ESP32 runs the sketch, and its probe tells the lab what each pin
// drives (see lib/live.ts). This MCU plays those drives into the simulated circuit, so the bench
// lights up as the real board does. The circuit's voltages do not reach the real chip: its inputs
// are the real parts wired to it.

import { ESP32_PAD_ELECTRICAL, PAD_Z, type McuModel, type McuStep, type PadDrive } from '@esp32lab/sim-core';
import type { SimTime } from '@esp32lab/part-sdk';

export class LiveMcu implements McuModel {
  readonly electrical = ESP32_PAD_ELECTRICAL;
  private drives = new Map<string, PadDrive>();
  private changed = false;
  /** The level each pin reads on the real chip. */
  readonly levels = new Map<string, 0 | 1>();

  constructor(readonly pads: readonly string[]) {}

  /** Pins the probe reported. */
  update(pins: Record<string, { drive: PadDrive; level: 0 | 1 }>) {
    for (const [pad, p] of Object.entries(pins)) {
      const old = this.drives.get(pad);
      if (!old || JSON.stringify(old) !== JSON.stringify(p.drive)) {
        this.drives.set(pad, p.drive);
        this.changed = true;
      }
      this.levels.set(pad, p.level);
    }
  }

  drive(pad: string): PadDrive {
    return this.drives.get(pad) ?? PAD_Z;
  }

  setInputs(): void {}

  runUntil(t: SimTime): McuStep {
    const padsChanged = this.changed;
    this.changed = false;
    return { t, padsChanged };
  }
}
