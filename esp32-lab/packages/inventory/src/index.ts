// The user's own box of parts, and what a project needs from it. A stocked item is a catalog
// part with the props that make it a different physical item (`PartManifest.stock`), a board, a
// breadboard, or anything else written in by hand. Nothing here touches the DOM: the app keeps
// the items, this works out bills of materials and what is missing.

import type { PartManifest, PartModule, PartProps } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';

export type StockKind = 'part' | 'board' | 'breadboard' | 'custom';

export interface StockItem {
  /** The stock key (see `stockKey`); for a custom item `custom:<random>`. */
  id: string;
  kind: StockKind;
  /** Catalog id of the part, board or breadboard; none for a custom item. */
  type?: string;
  /** The identifying props only, e.g. `{ resistance: 220 }`. */
  props?: PartProps;
  /** Name of a custom item. */
  name?: string;
  qty: number;
  /** Where it is kept, e.g. "Hộp A, ngăn 3". */
  location?: string;
  note?: string;
  /** What one cost (VND), for working out savings later. */
  unitPrice?: number;
  /** When it last changed, ms since the epoch. */
  updated: number;
}

/** One kind of item a project needs, and how many. */
export interface BomLine {
  key: string;
  kind: Exclude<StockKind, 'custom'>;
  type: string;
  props: PartProps;
  qty: number;
}

export interface CheckLine extends BomLine {
  have: number;
  /** How many more are needed, 0 when stocked. */
  missing: number;
}

export interface ProjectCheck {
  lines: CheckLine[];
  /** Every line is stocked. */
  complete: boolean;
  /** Item kinds stocked, out of `needCount`. */
  haveCount: number;
  needCount: number;
}

/** The props that identify the stocked item, defaults filled in, in the manifest's order. */
export function stockProps(manifest: PartManifest, props: PartProps = {}): PartProps {
  const out: PartProps = {};
  for (const k of manifest.stock ?? []) {
    const value = props[k] ?? manifest.props[k]?.default;
    if (value !== undefined) out[k] = value;
  }
  return out;
}

/** `led?color=red`, `resistor?resistance=220`, `board:esp32-devkit-v1`, `bb:half-400`. */
export function stockKey(kind: Exclude<StockKind, 'custom'>, type: string, props: PartProps = {}): string {
  if (kind === 'board') return `board:${type}`;
  if (kind === 'breadboard') return `bb:${type}`;
  const query = Object.keys(props)
    .sort()
    .map((k) => `${k}=${String(props[k])}`)
    .join('&');
  return query ? `${type}?${query}` : type;
}

/** What it takes to build the project: its parts grouped by stocked item, its board and breadboards. */
export function bom(project: Project, parts: Record<string, PartModule<any>>): BomLine[] {
  const lines = new Map<string, BomLine>();
  const add = (kind: BomLine['kind'], type: string, props: PartProps) => {
    const key = stockKey(kind, type, props);
    const line = lines.get(key);
    if (line) line.qty++;
    else lines.set(key, { key, kind, type, props, qty: 1 });
  };
  add('board', project.board.type, {});
  for (const b of project.breadboards) add('breadboard', b.type, {});
  for (const p of project.parts) {
    const m = parts[p.type]?.manifest;
    add('part', p.type, m ? stockProps(m, p.props) : {});
  }
  return [...lines.values()];
}

/** How many of each stock key there are. */
export function stockLevels(items: StockItem[]): Map<string, number> {
  const levels = new Map<string, number>();
  for (const item of items) levels.set(item.id, (levels.get(item.id) ?? 0) + item.qty);
  return levels;
}

/** Hold the bill of materials against the stock. */
export function checkProject(lines: BomLine[], items: StockItem[]): ProjectCheck {
  const levels = stockLevels(items);
  const checked = lines.map((l) => {
    const have = levels.get(l.key) ?? 0;
    return { ...l, have, missing: Math.max(0, l.qty - have) };
  });
  const haveCount = checked.filter((l) => l.missing === 0).length;
  return { lines: checked, complete: haveCount === checked.length, haveCount, needCount: checked.length };
}

/** "I have this kit": add the whole bill of materials to the stock. */
export function addFromBom(items: StockItem[], lines: BomLine[], now = Date.now()): StockItem[] {
  const out = items.map((i) => ({ ...i }));
  for (const l of lines) {
    const item = out.find((i) => i.id === l.key);
    if (item) {
      item.qty += l.qty;
      item.updated = now;
    } else out.push({ id: l.key, kind: l.kind, type: l.type, props: l.props, qty: l.qty, updated: now });
  }
  return out;
}
