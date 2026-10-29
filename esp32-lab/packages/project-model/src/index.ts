// Project model – the serialisable description of a workbench: which board, which breadboards,
// which parts sit in which holes, which wires, which firmware. Pure data, no simulation.

import type { PartManifest, PartProps } from '@esp32lab/part-sdk';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Breadboards
// ---------------------------------------------------------------------------

/** Compact breadboard description (breadboard.json); expanded into holes + strips by expandBreadboard. */
export interface BreadboardDef {
  id: string;
  name: string;
  columns: number;
  /** Terminal blocks: each column of `rows` is one 5-hole metal strip. */
  blocks: { rows: string[]; y0: number }[];
  /** Power rails: one continuous strip each, holes grouped in fives. */
  rails: { id: string; polarity: '+' | '-'; y: number; x0: number; groups: number; groupSize: number; groupGap: number }[];
}

export interface Hole {
  name: string;
  x: number;
  y: number;
}

export interface ExpandedBreadboard {
  def: BreadboardDef;
  holes: Map<string, Hole>;
  /** Each strip is a list of hole names joined by one metal clip. */
  strips: string[][];
  holeAt(x: number, y: number): Hole | undefined;
}

export function expandBreadboard(def: BreadboardDef): ExpandedBreadboard {
  const holes = new Map<string, Hole>();
  const byPos = new Map<string, Hole>();
  const strips: string[][] = [];
  const add = (name: string, x: number, y: number) => {
    const hole = { name, x, y };
    holes.set(name, hole);
    byPos.set(`${x},${y}`, hole);
    return name;
  };

  for (const block of def.blocks) {
    for (let c = 1; c <= def.columns; c++) {
      strips.push(block.rows.map((row, i) => add(`${row}${c}`, c - 1, block.y0 + i)));
    }
  }
  for (const rail of def.rails) {
    const strip: string[] = [];
    let k = 1;
    for (let g = 0; g < rail.groups; g++) {
      for (let i = 0; i < rail.groupSize; i++) {
        strip.push(add(`${rail.id}${k++}`, rail.x0 + g * (rail.groupSize + rail.groupGap) + i, rail.y));
      }
    }
    strips.push(strip);
  }

  return { def, holes, strips, holeAt: (x, y) => byPos.get(`${x},${y}`) };
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** Where something on the board connects: an MCU pad, a board-wide net, or a private board node. */
export type BoardNode = { pad: string } | { net: string } | { node: string };

export interface BoardPin {
  /** Silkscreen label, e.g. "D2". */
  name: string;
  /** Header position in pitches, so a board can later be plugged straight into a breadboard. */
  x: number;
  y: number;
  connect: BoardNode;
}

export interface BoardSupply {
  name: string;
  net: string;
  volts: number;
  /** Output resistance of the regulator / USB source (Ω). */
  rOut: number;
  currentMax: number;
}

export interface BoardPart {
  id: string;
  type: string;
  props?: PartProps;
  connect: Record<string, BoardNode>;
  /** Shown in the UI, e.g. "BOOT" for the GPIO0 button. */
  label?: string;
  /** Where the UI draws it on the board, in pitches; omitted for parts that are not shown. */
  x?: number;
  y?: number;
}

export interface BoardDef {
  id: string;
  name: string;
  mcu: string;
  width: number;
  height: number;
  pins: BoardPin[];
  supplies: BoardSupply[];
  /** Parts soldered on the board, built from the same part packages as user parts. */
  onboard: BoardPart[];
  /** How the UI draws it; DevKit V1 look (blue PCB, ESP32-WROOM-32, CP2102) when omitted. */
  look?: { pcb?: 'blue' | 'black'; module?: string; usbChip?: string };
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type Rotation = 0 | 90 | 180 | 270;

export type Endpoint =
  | { kind: 'hole'; bb: string; hole: string }
  | { kind: 'board'; pin: string }
  | { kind: 'part'; part: string; terminal: string };

export interface PartInstance {
  id: string;
  type: string;
  version?: string;
  props?: PartProps;
  /** Plugged into a breadboard (anchor = first terminal), or null when only wired by terminals. */
  placement: { bb: string; hole: string; rot: Rotation } | null;
  /**
   * Where an unplugged part lies on the bench: world position of its first terminal, in pitches.
   * Wires reach its legs through `{ kind: 'part' }` endpoints.
   */
  bench?: { x: number; y: number; rot: Rotation };
}

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color?: string;
}

export type Firmware =
  | { kind: 'pio-env'; env: string }
  | { kind: 'elf'; url: string }
  | { kind: 'none' };

export interface Project {
  schemaVersion: number;
  name?: string;
  board: { type: string; x: number; y: number };
  breadboards: { id: string; type: string; x: number; y: number }[];
  parts: PartInstance[];
  wires: Wire[];
  firmware: Firmware;
  lessonId?: string;
  /** Seed for the deterministic PRNG (button bounce, ADC noise...). */
  seed?: number;
}

/** Upgrade an older saved project to the current schema. Each schema bump adds one step here. */
export function migrate(raw: unknown): Project {
  const project = raw as Project;
  if (project.schemaVersion === SCHEMA_VERSION) return project;
  throw new Error(`Unsupported project schemaVersion ${String(project.schemaVersion)}`);
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Rotate a terminal offset clockwise on screen (y grows downwards). */
export function rotate(dx: number, dy: number, rot: Rotation): [number, number] {
  switch (rot) {
    case 0:
      return [dx, dy];
    case 90:
      return [-dy, dx];
    case 180:
      return [-dx, -dy];
    case 270:
      return [dy, -dx];
  }
}

export type PlacementResult =
  | { ok: true; holes: Record<string, string> }
  | { ok: false; missing: string[] };

/** Which hole each terminal of a placed part lands in; fails if any leg misses a hole. */
export function resolvePlacement(
  bb: ExpandedBreadboard,
  manifest: PartManifest,
  anchorHole: string,
  rot: Rotation,
): PlacementResult {
  const anchor = bb.holes.get(anchorHole);
  if (!anchor) return { ok: false, missing: manifest.terminals.map((t) => t.name) };
  const first = manifest.terminals[0];
  const holes: Record<string, string> = {};
  const missing: string[] = [];
  for (const t of manifest.terminals) {
    const [dx, dy] = rotate(t.dx - (first?.dx ?? 0), t.dy - (first?.dy ?? 0), rot);
    const hole = bb.holeAt(anchor.x + dx, anchor.y + dy);
    if (hole) holes[t.name] = hole.name;
    else missing.push(t.name);
  }
  return missing.length ? { ok: false, missing } : { ok: true, holes };
}
