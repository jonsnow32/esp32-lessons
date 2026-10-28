// ESP32 MCU package. For now: pad capability data used by the UI and lesson checks.
// The Xtensa LX6 emulator (crates/esp32-wasm) will implement McuModel here in M3.

import pads from '../pads.json';

export interface PadCapabilities {
  inputOnly: boolean;
  pullResistors: boolean;
  flash: boolean;
  strapping: boolean;
  adc?: string;
  adcBlockedByWifi?: boolean;
  touch?: string;
  dac?: string;
  note?: string;
}

export const ESP32_PADS: Record<string, PadCapabilities> = pads.pads;
export const ESP32_PAD_NAMES = Object.keys(ESP32_PADS);
