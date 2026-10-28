// Everything the workbench can place, loaded from the component packages. Adding a part,
// board, breadboard or lesson means adding it here (and nothing else in the app).

import type { Lesson } from '@esp32lab/lesson-engine';
import type { PartModule } from '@esp32lab/part-sdk';
import type { BoardDef, BreadboardDef } from '@esp32lab/project-model';
import buzzer from '@esp32lab-parts/buzzer';
import diode from '@esp32lab-parts/diode';
import led from '@esp32lab-parts/led';
import photoresistor from '@esp32lab-parts/photoresistor';
import potentiometer from '@esp32lab-parts/potentiometer';
import pushbutton from '@esp32lab-parts/pushbutton';
import resistor from '@esp32lab-parts/resistor';
import rgbLed from '@esp32lab-parts/rgb-led';
import slideSwitch from '@esp32lab-parts/slide-switch';
import devkit from '../../../../boards/esp32-devkit-v1/board.json';
import half400 from '../../../../breadboards/half-400/breadboard.json';
import lesson01 from '../../../../lessons/01-blink/lesson.json';
import lesson02 from '../../../../lessons/02-button/lesson.json';

export const PARTS: Record<string, PartModule<any>> = {
  led,
  'rgb-led': rgbLed,
  resistor,
  potentiometer,
  photoresistor,
  diode,
  pushbutton,
  'slide-switch': slideSwitch,
  buzzer,
};
export const BOARDS: Record<string, BoardDef> = { 'esp32-devkit-v1': devkit as unknown as BoardDef };
export const BREADBOARDS: Record<string, BreadboardDef> = { 'half-400': half400 as unknown as BreadboardDef };
export const LESSONS: Lesson[] = [lesson01 as unknown as Lesson, lesson02 as unknown as Lesson];
