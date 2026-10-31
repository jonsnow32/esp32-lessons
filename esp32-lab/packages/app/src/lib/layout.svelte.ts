// Where the panels around the bench sit, IDE style: three docks (left, right, bottom), each a
// strip of tabs. A tab can be dragged to another dock, a dock resized or folded down to its
// strip. Kept in the browser so the layout is there again next time.

export type ViewId = 'library' | 'code' | 'select' | 'lesson' | 'explain' | 'serial' | 'ai';
export type DockId = 'left' | 'right' | 'bottom';

export interface Dock {
  views: ViewId[];
  /** The tab shown when the dock is open. */
  active: ViewId | null;
  /** Width in px for the side docks, share of the centre column for the bottom one. */
  size: number;
  open: boolean;
}

const KEY = 'esp32lab.layout';
export const DOCKS: DockId[] = ['left', 'right', 'bottom'];
const VIEWS: ViewId[] = ['library', 'code', 'select', 'lesson', 'explain', 'serial', 'ai'];
export const LIMITS: Record<DockId, [number, number]> = { left: [160, 520], right: [240, 720], bottom: [0.12, 0.85] };

function defaults(): Record<DockId, Dock> {
  const codeShare = Number(localStorage.getItem('esp32lab.codeShare') ?? 0.4);
  return {
    left: { views: ['library'], active: 'library', size: 240, open: true },
    right: { views: ['select', 'lesson', 'explain', 'serial', 'ai'], active: 'lesson', size: 360, open: true },
    bottom: { views: ['code'], active: 'code', size: codeShare || 0.4, open: codeShare > 0 },
  };
}

/**
 * The stored layout if it is whole (every view in at most one dock), the default otherwise. Views
 * added since it was stored go at the end of the right dock.
 */
function load(): Record<DockId, Dock> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<DockId, Dock> | null;
    const all = stored && DOCKS.flatMap((d) => stored[d].views);
    if (stored && new Set(all).size === all!.length && all!.every((v) => VIEWS.includes(v))) {
      stored.right.views.push(...VIEWS.filter((v) => !all!.includes(v)));
      return stored;
    }
  } catch {
    /* unreadable: start over */
  }
  return defaults();
}

class Layout {
  docks = $state(load());
  /** The tab being dragged, while it is. */
  dragging = $state<ViewId | null>(null);

  constructor() {
    $effect.root(() => {
      $effect(() => localStorage.setItem(KEY, JSON.stringify(this.docks)));
    });
  }

  dockOf(view: ViewId): DockId {
    return DOCKS.find((d) => this.docks[d].views.includes(view))!;
  }

  /** Put a view in a dock, before another of its tabs or last, and show it there. */
  move(view: ViewId, to: DockId, before?: ViewId) {
    if (view === before) return;
    const from = this.docks[this.dockOf(view)];
    from.views = from.views.filter((v) => v !== view);
    if (from.active === view) from.active = from.views[0] ?? null;
    const dock = this.docks[to];
    const i = before ? dock.views.indexOf(before) : -1;
    dock.views = i < 0 ? [...dock.views, view] : [...dock.views.slice(0, i), view, ...dock.views.slice(i)];
    dock.active = view;
    dock.open = true;
  }

  /** Open the dock a view is in, on that view. */
  reveal(view: ViewId) {
    const dock = this.docks[this.dockOf(view)];
    dock.active = view;
    dock.open = true;
  }

  /** A tab pressed: show it, or fold the dock when it is the one already showing. */
  press(view: ViewId, shown: ViewId | null) {
    const dock = this.docks[this.dockOf(view)];
    if (dock.open && shown === view) dock.open = false;
    else this.reveal(view);
  }

  toggle(id: DockId) {
    this.docks[id].open = !this.docks[id].open;
  }

  resize(id: DockId, size: number) {
    const [min, max] = LIMITS[id];
    this.docks[id].size = Math.min(max, Math.max(min, size));
  }

  reset() {
    localStorage.removeItem('esp32lab.codeShare');
    this.docks = defaults();
  }
}

export const layout = new Layout();
