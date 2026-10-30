<script lang="ts">
  // The bench as a schematic (see lib/schematic.ts): read-only, redrawn on every edit. Drag to
  // pan, wheel or pinch to zoom; tapping a part selects it, as on the bench.

  import { buildSchematic } from '../lib/schematic';
  import { lab } from '../lib/lab.svelte';

  let svg: SVGSVGElement;
  let drawing = $derived(lab.netKernel ? buildSchematic(lab.project, lab.netKernel, lab.overlay === 'voltage' ? lab.voltages : {}) : null);
  let view = $state({ x: 0, y: 0, w: 600, h: 400 });
  let pan: { x: number; y: number; view: typeof view; moved: boolean } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; view: typeof view } | null = null;

  /** Frame the whole drawing, keeping the panel's aspect ratio. */
  export function fit() {
    if (!drawing || !svg) return;
    const r = svg.getBoundingClientRect();
    const aspect = r.height / Math.max(1, r.width);
    const m = 20;
    const w = Math.max(drawing.width + 2 * m, (drawing.height + 2 * m) / aspect, 300);
    const h = w * aspect;
    view = { x: drawing.width / 2 - w / 2, y: drawing.height / 2 - h / 2, w, h };
  }

  // Refit when parts come or go, not on every voltage update
  let count = $derived(lab.project.parts.length);
  $effect(() => {
    void count;
    fit();
  });

  function zoom(factor: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
    const w = Math.min(4000, Math.max(80, view.w * factor));
    const k = w / view.w;
    view = { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w, h: view.h * k };
  }

  function toWorld(clientX: number, clientY: number) {
    const p = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }

  function onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const p = toWorld(ev.clientX, ev.clientY);
    zoom(Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
  }

  function onDown(ev: PointerEvent) {
    svg.setPointerCapture(ev.pointerId);
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), view };
      pan = null;
    } else pan = { x: ev.clientX, y: ev.clientY, view, moved: false };
  }

  function onMove(ev: PointerEvent) {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const r = svg.getBoundingClientRect();
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const k = pinch.dist / Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y));
      view = pinch.view;
      zoom(k);
      return;
    }
    if (!pan) return;
    const dx = ((ev.clientX - pan.x) / r.width) * pan.view.w;
    const dy = ((ev.clientY - pan.y) / r.height) * pan.view.h;
    if (Math.hypot(ev.clientX - pan.x, ev.clientY - pan.y) > 4) pan.moved = true;
    view = { ...pan.view, x: pan.view.x - dx, y: pan.view.y - dy };
  }

  function onUp(ev: PointerEvent) {
    touches.delete(ev.pointerId);
    if (touches.size < 2) pinch = null;
    if (pan && !pan.moved) {
      // A tap: select the part under it, or nothing
      const id = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-part]') as HTMLElement | null)?.dataset.part;
      lab.selection = id ? { kind: 'part', id } : null;
    }
    pan = null;
  }

  let selected = $derived(lab.selection?.kind === 'part' ? lab.selection.id : null);
  $effect(() => {
    void drawing;
    for (const el of svg.querySelectorAll<SVGGElement>('[data-part]')) el.classList.toggle('sel', el.dataset.part === selected);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg bind:this={svg} class="schematic" viewBox="{view.x} {view.y} {view.w} {view.h}"
  onwheel={onWheel} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}>
  {#if drawing}
    <g class="sheet">{@html drawing.svg}</g>
  {/if}
</svg>
{#if !drawing || drawing.empty}
  <div class="hint">Chưa có linh kiện nào. Cắm linh kiện lên breadboard và nối dây, sơ đồ nguyên lý sẽ tự hiện ở đây.</div>
{/if}

<style>
  .schematic {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: var(--surface);
    touch-action: none;
    cursor: grab;
    user-select: none;
  }
  .hint {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-width: 340px;
    text-align: center;
    color: var(--ink-3);
    font-size: 13px;
    pointer-events: none;
  }
  /* Classes of part-sdk's schematic.ts, as on the part pages */
  .sheet :global(.sch-w) { fill: none; stroke: var(--ink-2); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .sheet :global(.sch-w.sch-s) { stroke: var(--signal); }
  .sheet :global(.sch-w.sch-a) { stroke: var(--accent-hi); stroke-width: 1.3; }
  .sheet :global(.sch-w.sch-nc) { stroke: var(--ink-4); }
  .sheet :global(.sch-a-fill) { fill: var(--accent-hi); }
  .sheet :global(.sch-b) { fill: var(--surface); stroke: var(--ink-2); stroke-width: 1.6; }
  .sheet :global(.sch-b-ink) { fill: var(--ink-2); }
  .sheet :global(.sch-chip) { fill: var(--bezel); stroke: var(--bezel); }
  .sheet :global(.sch-dot) { fill: var(--ink-2); }
  .sheet :global(.sch-flag) { fill: var(--signal-soft); stroke: var(--signal); stroke-width: 1; }
  .sheet :global(.sch-t) { font: 11px var(--font-mono); fill: var(--ink); }
  .sheet :global(.sch-t.sch-m) { fill: var(--ink-3); }
  .sheet :global(.sch-t.sch-a) { fill: var(--accent); font-weight: 600; }
  .sheet :global(.sch-t.sch-s) { fill: var(--signal); font-weight: 600; }
  .sheet :global(.sch-t.sch-strong) { font-weight: 700; }
  .sheet :global(.sch-t.sch-chip-t) { fill: var(--ink-inv); font-weight: 600; }
  .sheet :global(.sch-t.sch-volt) { fill: var(--accent); }
  .sheet :global([data-part]) { cursor: pointer; }
  .sheet :global([data-part].sel) { filter: drop-shadow(0 0 1.5px var(--accent)) drop-shadow(0 0 1.5px var(--accent)); }
  .sheet :global([data-part]:hover) { filter: drop-shadow(0 0 2px var(--accent-hi)); }
</style>
