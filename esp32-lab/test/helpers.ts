import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import type { BoardDef, BreadboardDef, PartInstance, Project, Wire } from '@esp32lab/project-model';
import { ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import buzzer from '@esp32lab-parts/buzzer';
import dht from '@esp32lab-parts/dht';
import diode from '@esp32lab-parts/diode';
import led from '@esp32lab-parts/led';
import photoresistor from '@esp32lab-parts/photoresistor';
import pirSensor from '@esp32lab-parts/pir-sensor';
import potentiometer from '@esp32lab-parts/potentiometer';
import pushbutton from '@esp32lab-parts/pushbutton';
import resistor from '@esp32lab-parts/resistor';
import rgbLed from '@esp32lab-parts/rgb-led';
import slideSwitch from '@esp32lab-parts/slide-switch';
import thermistor from '@esp32lab-parts/thermistor';
import tiltSwitch from '@esp32lab-parts/tilt-switch';
import ultrasonic from '@esp32lab-parts/ultrasonic';
import ds18b20 from '@esp32lab-parts/ds18b20';
import gasSensor from '@esp32lab-parts/gas-sensor';
import joystick from '@esp32lab-parts/joystick';
import keypad from '@esp32lab-parts/keypad';
import lcd1602 from '@esp32lab-parts/lcd1602';
import ledBar from '@esp32lab-parts/led-bar';
import relay from '@esp32lab-parts/relay';
import rotaryEncoder from '@esp32lab-parts/rotary-encoder';
import servo from '@esp32lab-parts/servo';
import neopixel from '@esp32lab-parts/neopixel';
import sevenSegment from '@esp32lab-parts/seven-segment';
import soilMoisture from '@esp32lab-parts/soil-moisture';
import ssd1306 from '@esp32lab-parts/ssd1306';
import board from '../boards/esp32-devkit-v1/board.json';
import half400 from '../breadboards/half-400/breadboard.json';

export const PARTS = {
  led,
  'rgb-led': rgbLed,
  resistor,
  potentiometer,
  photoresistor,
  diode,
  pushbutton,
  'slide-switch': slideSwitch,
  buzzer,
  thermistor,
  'tilt-switch': tiltSwitch,
  'pir-sensor': pirSensor,
  ultrasonic,
  dht,
  ds18b20,
  'gas-sensor': gasSensor,
  joystick,
  keypad,
  'led-bar': ledBar,
  lcd1602,
  relay,
  'rotary-encoder': rotaryEncoder,
  'seven-segment': sevenSegment,
  servo,
  neopixel,
  'soil-moisture': soilMoisture,
  ssd1306,
};
export const BOARD = board as BoardDef;
export const BREADBOARDS: Record<string, BreadboardDef> = { 'half-400': half400 as BreadboardDef };

export function project(parts: PartInstance[] = [], wires: Wire[] = []): Project {
  return {
    schemaVersion: 1,
    board: { type: 'esp32-devkit-v1', x: 0, y: 0 },
    breadboards: [{ id: 'bb1', type: 'half-400', x: 14, y: 0 }],
    parts,
    wires,
    firmware: { kind: 'none' },
    seed: 42,
  };
}

export function kernel(p: Project, setup?: (mcu: ScriptedMcu) => void) {
  const mcu = new ScriptedMcu(ESP32_PAD_NAMES);
  setup?.(mcu);
  const k = new SimKernel({ project: p, board: BOARD, breadboards: BREADBOARDS, parts: PARTS, mcu });
  return { k, mcu };
}

export const hole = (h: string) => ({ kind: 'hole' as const, bb: 'bb1', hole: h });
export const pin = (name: string) => ({ kind: 'board' as const, pin: name });
export const wire = (id: string, a: Wire['a'], b: Wire['b']): Wire => ({ id, a, b });
