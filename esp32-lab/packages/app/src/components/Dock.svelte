<script lang="ts">
  // One dock beside or below the bench: a strip of tabs over the tab shown. Tabs drag to another
  // dock or to another place in the strip; the edge toward the bench drags to resize; pressing the
  // tab already shown folds the dock down to its strip.
  import type { Snippet } from 'svelte';
  import { layout, type DockId, type ViewId } from '../lib/layout.svelte';
  import Icon from './Icon.svelte';

  let { id, labels, available, view, badge }: {
    id: DockId;
    labels: Record<ViewId, string>;
    /** Views that have something to show right now. */
    available: (v: ViewId) => boolean;
    view: Snippet<[ViewId]>;
    badge: Snippet<[ViewId]>;
  } = $props();

  let dock = $derived(layout.docks[id]);
  let tabs = $derived(dock.views.filter(available));
  let shown = $derived(dock.active && tabs.includes(dock.active) ? dock.active : (tabs[0] ?? null));
  let side = $derived(id !== 'bottom');
  /** The tab a dragged one would land before, or 'end'. */
  let over = $state<ViewId | 'end' | null>(null);

  function startResize(e: PointerEvent) {
    const el = (e.currentTarget as HTMLElement).parentElement!;
    const rect = el.getBoundingClientRect();
    const column = el.parentElement!.getBoundingClientRect();
    const move = (ev: PointerEvent) =>
      layout.resize(id, id === 'left' ? ev.clientX - rect.left : id === 'right' ? rect.right - ev.clientX : (column.bottom - ev.clientY) / column.height);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function dragStart(e: DragEvent, v: ViewId) {
    e.dataTransfer!.setData('text/plain', v);
    e.dataTransfer!.effectAllowed = 'move';
    // After the browser took its drag image: the drop zones over the bench would otherwise be in it
    setTimeout(() => (layout.dragging = v));
  }

  function dragOver(e: DragEvent, at: ViewId | 'end') {
    if (!layout.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    over = at;
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (layout.dragging) layout.move(layout.dragging, id, over === 'end' ? undefined : (over ?? undefined));
    layout.dragging = null;
    over = null;
  }
</script>

{#if tabs.length}
  <section class="dock {id}" class:open={dock.open} class:side style={dock.open ? (side ? `width: ${dock.size}px` : `flex: ${dock.size}`) : ''}>
    {#if dock.open}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="grip" onpointerdown={startResize} title="Kéo để đổi kích thước"></div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <nav role="tablist" ondragover={(e) => dragOver(e, 'end')} ondragleave={() => (over = null)} ondrop={drop}>
      {#each tabs as v (v)}
        <button role="tab" draggable="true" aria-selected={dock.open && shown === v} class:on={dock.open && shown === v} class:before={over === v}
          title={dock.open && shown === v ? 'Bấm để thu nhỏ · kéo sang khung khác để di chuyển' : 'Kéo sang khung khác để di chuyển'}
          onclick={() => layout.press(v, shown)} ondragstart={(e) => dragStart(e, v)} ondragend={() => { layout.dragging = null; over = null; }}
          ondragover={(e) => dragOver(e, v)}>
          {labels[v]}{@render badge(v)}
        </button>
      {/each}
      <span class="end" class:before={over === 'end'}></span>
      <button class="fold" onclick={() => layout.toggle(id)} title={dock.open ? 'Thu nhỏ' : 'Mở rộng'} aria-label={dock.open ? 'Thu nhỏ' : 'Mở rộng'}>
        <Icon name={(dock.open ? { left: 'chevron-left', right: 'chevron-right', bottom: 'chevron-down' } : { left: 'chevron-right', right: 'chevron-left', bottom: 'chevron-up' } as const)[id]} size={14} />
      </button>
    </nav>
    {#if dock.open && shown}
      <div class="body" role="tabpanel">{@render view(shown)}</div>
    {/if}
  </section>
{/if}

<style>
  .dock { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--surface-2); flex: 0 0 auto; }
  .dock.side.open { flex: 0 0 auto; }
  .dock.left { border-right: 1px solid var(--line); }
  .dock.right { border-left: 1px solid var(--line); }
  .dock.bottom { border-top: 1px solid var(--line); }
  .body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  nav { display: flex; border-bottom: 1px solid var(--line); background: var(--surface); flex: 0 0 auto; align-items: stretch; }
  nav button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 9px 10px 7px; font: 600 11px var(--font-mono); text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); display: inline-flex; gap: 5px; align-items: center; justify-content: center; white-space: nowrap; cursor: pointer; }
  nav button[role='tab'] { flex: 1 1 auto; }
  nav button + button { box-shadow: inset 1px 0 0 var(--line-soft); }
  nav button.on { color: var(--ink); border-bottom-color: var(--accent-hi); background: var(--surface-2); }
  nav button:hover { color: var(--ink); }
  nav button.before { box-shadow: inset 3px 0 0 var(--accent-hi); }
  .end { flex: 0 0 4px; }
  .end.before { background: var(--accent-hi); }
  .fold { display: flex; align-items: center; flex: 0 0 auto; padding: 4px 8px; color: var(--ink-3); }
  .bottom nav button[role='tab'] { flex: 0 0 auto; }
  .bottom nav .end { flex: 1 1 auto; }
  .bottom nav .end.before { background: none; box-shadow: inset 3px 0 0 var(--accent-hi); }
  /* Folded side dock: a thin strip, its tabs written down the side */
  .dock.side:not(.open) nav { flex-direction: column; border-bottom: none; height: 100%; width: 30px; }
  .dock.side:not(.open) nav button[role='tab'] { flex: 0 0 auto; writing-mode: vertical-rl; padding: 10px 7px; border-bottom: none; }
  .dock.side:not(.open) nav button + button { box-shadow: inset 0 1px 0 var(--line-soft); }
  .dock.side:not(.open) nav button.before { box-shadow: inset 0 3px 0 var(--accent-hi); }
  .dock.side:not(.open) .end { flex: 1 1 auto; }
  .dock.side:not(.open) .fold { order: -1; }
  .grip { position: absolute; z-index: 5; touch-action: none; }
  .left .grip { top: 0; bottom: 0; right: -4px; width: 7px; cursor: col-resize; }
  .right .grip { top: 0; bottom: 0; left: -4px; width: 7px; cursor: col-resize; }
  .bottom .grip { left: 0; right: 0; top: -4px; height: 7px; cursor: row-resize; }
  .grip:hover, :global(body.resizing) .grip:active { background: var(--accent-hi); }
  @media (max-width: 1100px) {
    .dock.side.open { width: auto !important; }
    .dock.left, .dock.right { border-inline: none; border-bottom: 1px solid var(--line); }
    .grip { display: none; }
    .dock.side:not(.open) nav { flex-direction: row; height: auto; width: auto; }
    .dock.side:not(.open) nav button[role='tab'] { writing-mode: horizontal-tb; }
    .left .body :global(section) { display: flex; gap: 8px; overflow-x: auto; align-items: center; }
    .left .body :global(h2), .left .body :global(.hint), .left .body :global(.keys), .left .body :global(.static) { display: none; }
    .left .body :global(.item) { flex: 0 0 auto; margin: 0; }
    .right .body { min-height: 50vh; }
  }
</style>
