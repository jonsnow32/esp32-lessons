// The user's box of parts, kept in the browser like the settings: one object behind one key,
// with a version and the time it last changed, so it can later be synced with a profile in the
// cloud (the newer copy wins). What a project needs from it is worked out in @esp32lab/inventory.

import { addFromBom, bom, checkProject, stockKey, stockLevels, stockProps, type StockItem } from '@esp32lab/inventory';
import type { PartProps } from '@esp32lab/part-sdk';
import type { Project } from '@esp32lab/project-model';
import { BOARDS, BREADBOARDS, FEATURED, PARTS } from './catalog';

interface Stored {
  version: 1;
  /** When the stock last changed, ms since the epoch. */
  updated: number;
  items: StockItem[];
}

const KEY = 'esp32lab.inventory';

function load(): StockItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    return stored?.version === 1 && Array.isArray(stored.items) ? stored.items : [];
  } catch {
    return [];
  }
}

/** What the line or item is called in the UI: "Điện trở 220 Ω", "LED 5 mm (đỏ)", "Hộp dây cắm". */
export function itemName(item: Pick<StockItem, 'kind' | 'type' | 'props' | 'name'>): string {
  if (item.kind === 'custom') return item.name ?? 'Món khác';
  if (item.kind === 'board') return BOARDS[item.type!]?.name ?? item.type!;
  if (item.kind === 'breadboard') return BREADBOARDS[item.type!]?.name ?? item.type!;
  const m = PARTS[item.type!]?.manifest;
  if (!m) return item.type!;
  const values = Object.entries(item.props ?? {}).map(([k, v]) => {
    const s = m.props[k];
    return s?.type === 'number' && s.unit ? `${v} ${s.unit}` : String(v);
  });
  return values.length ? `${m.name} · ${values.join(', ')}` : m.name;
}

class Inventory {
  items = $state<StockItem[]>(load());
  /** Quantity on hand per stock key. */
  levels = $derived(stockLevels(this.items));
  /** Each featured project held against the stock. */
  featured = $derived(new Map(FEATURED.map((f) => [f.id, checkProject(bom(f.project, PARTS), this.items)])));

  private save() {
    const stored: Stored = { version: 1, updated: Date.now(), items: this.items };
    localStorage.setItem(KEY, JSON.stringify(stored));
  }

  qtyOf(key: string): number {
    return this.levels.get(key) ?? 0;
  }

  /** The stock key of a part with these props (only the identifying ones count). */
  partKey(type: string, props: PartProps = {}): string {
    return stockKey('part', type, stockProps(PARTS[type]!.manifest, props));
  }

  /** Add `qty` of a catalog item, merged with what is stocked already. */
  add(kind: Exclude<StockItem['kind'], 'custom'>, type: string, props: PartProps = {}, qty = 1) {
    const ids = kind === 'part' ? stockProps(PARTS[type]!.manifest, props) : {};
    const id = stockKey(kind, type, ids);
    const item = this.items.find((i) => i.id === id);
    if (item) this.update(id, { qty: item.qty + qty });
    else {
      this.items = [...this.items, { id, kind, type, props: ids, qty, updated: Date.now() }];
      this.save();
    }
  }

  addCustom(name: string, qty = 1) {
    const id = `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.items = [...this.items, { id, kind: 'custom', name, qty, updated: Date.now() }];
    this.save();
  }

  update(id: string, change: Partial<Pick<StockItem, 'qty' | 'location' | 'note' | 'unitPrice' | 'name'>>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...change, qty: Math.max(0, change.qty ?? i.qty), updated: Date.now() } : i));
    this.save();
  }

  remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  }

  /** "I have this kit": everything the project needs goes into the stock. */
  addProject(project: Project) {
    this.items = addFromBom(this.items, bom(project, PARTS));
    this.save();
  }

  /** The bill of materials of a project, for the circuit open on the bench. */
  check(project: Project) {
    return checkProject(bom(project, PARTS), this.items);
  }

  /** The stock as a JSON file to keep or move to another computer. */
  export(): string {
    return JSON.stringify({ version: 1, updated: Date.now(), items: this.items } satisfies Stored, null, 2);
  }

  /** Replace the stock with an exported one; false if the file is not one. */
  import(text: string): boolean {
    try {
      const stored = JSON.parse(text) as Stored;
      if (stored.version !== 1 || !Array.isArray(stored.items) || !stored.items.every((i) => typeof i.id === 'string' && typeof i.qty === 'number')) return false;
      this.items = stored.items;
      this.save();
      return true;
    } catch {
      return false;
    }
  }
}

export const inventory = new Inventory();
