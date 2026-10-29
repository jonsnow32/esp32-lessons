// Everything the workbench can place, loaded from the component packages. Adding a part,
// board, breadboard or lesson means adding it here (and nothing else in the app).

import type { Lesson } from '@esp32lab/lesson-engine';
import type { PartModule } from '@esp32lab/part-sdk';
import type { BoardDef, BreadboardDef, Project } from '@esp32lab/project-model';
import buzzer from '@esp32lab-parts/buzzer';
import diode from '@esp32lab-parts/diode';
import led from '@esp32lab-parts/led';
import photoresistor from '@esp32lab-parts/photoresistor';
import potentiometer from '@esp32lab-parts/potentiometer';
import pushbutton from '@esp32lab-parts/pushbutton';
import resistor from '@esp32lab-parts/resistor';
import rgbLed from '@esp32lab-parts/rgb-led';
import slideSwitch from '@esp32lab-parts/slide-switch';
import devkitc from '../../../../boards/esp32-devkitc-v4/board.json';
import devkit from '../../../../boards/esp32-devkit-v1/board.json';
import nodemcu32s from '../../../../boards/nodemcu-32s/board.json';
import full830 from '../../../../breadboards/full-830/breadboard.json';
import half400 from '../../../../breadboards/half-400/breadboard.json';
import mini170 from '../../../../breadboards/mini-170/breadboard.json';
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
export const BOARDS: Record<string, BoardDef> = {
  'esp32-devkit-v1': devkit as unknown as BoardDef,
  'esp32-devkitc-v4': devkitc as unknown as BoardDef,
  'nodemcu-32s': nodemcu32s as unknown as BoardDef,
};
export const BREADBOARDS: Record<string, BreadboardDef> = {
  'mini-170': mini170 as unknown as BreadboardDef,
  'half-400': half400 as unknown as BreadboardDef,
  'full-830': full830 as unknown as BreadboardDef,
};
export const LESSONS: Lesson[] = [lesson01 as unknown as Lesson, lesson02 as unknown as Lesson];

/** A ready-made circuit with its sketch: open it, press Run, then change it. */
export interface FeaturedProject {
  id: string;
  order: number;
  title: string;
  summary: string;
  /** Things to try once it runs (Vietnamese UI copy). */
  tryIt: string[];
  project: Project;
  /** The sketch (projects/<id>/main.cpp). */
  code: string;
}

// Every folder in projects/ with a project.json and its main.cpp
const projectFiles = import.meta.glob<Omit<FeaturedProject, 'code'> & { sketch: string }>('../../../../projects/*/project.json', {
  eager: true,
  import: 'default',
});
const sketches = import.meta.glob<string>('../../../../projects/*/main.cpp', { eager: true, query: '?raw', import: 'default' });

export const FEATURED: FeaturedProject[] = Object.entries(projectFiles)
  .map(([path, p]) => ({ ...p, code: sketches[path.replace('project.json', p.sketch)] ?? '' }))
  .sort((a, b) => a.order - b.order);
