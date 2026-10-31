<script lang="ts">
  // Setting up a new bench, one step at a time: the board, the parts to start with, then a
  // breadboard or none (the parts are then wired straight to the board) and the project's name.
  import { BOARDS, BREADBOARDS, CATEGORY, PARTS } from '../lib/catalog';
  import { breadboard, breadboardBox } from '../lib/geometry';
  import { lab } from '../lib/lab.svelte';
  import BoardView from './BoardView.svelte';
  import BreadboardView from './BreadboardView.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const STEPS = ['Board', 'Linh kiện', 'Breadboard'];
  let step = $state(0);

  let board = $state(Object.keys(BOARDS)[0]!);
  /** How many of each part type, by type. */
  let counts = $state<Record<string, number>>({});
  let bb = $state<string | null>('half-400');
  let plug = $state(true);
  let title = $state(lab.nextTitle);
  let creating = $state(false);

  const ENTRIES = Object.entries(PARTS);
  const order = Object.keys(CATEGORY);
  const groups = [...new Set(ENTRIES.map(([, m]) => m.manifest.category))].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  /** Lowercase without Vietnamese marks, so "cam bien" finds "Cảm biến". */
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  let query = $state('');
  let shown = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return ENTRIES.filter(([type, m]) => words.every((w) => fold([type, m.manifest.name, CATEGORY[m.manifest.category] ?? '', ...(m.manifest.tags ?? [])].join(' ')).includes(w)));
  });

  let chosen = $derived(Object.entries(counts).filter(([, n]) => n > 0));
  let total = $derived(chosen.reduce((s, [, n]) => s + n, 0));

  const set = (type: string, n: number) => (counts[type] = Math.max(0, Math.min(9, n)));

  function preview(type: string): string {
    const m = PARTS[type]!;
    const props = Object.fromEntries(Object.entries(m.manifest.props).map(([k, s]) => [k, s.default]));
    return m.view?.(props as never, {}) ?? '';
  }

  async function create() {
    if (creating) return;
    creating = true;
    const parts = chosen.flatMap(([type, n]) => Array<string>(n).fill(type));
    onclose();
    await lab.newMyProject({ title, board, breadboard: bb, parts, plug });
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

{#snippet tile(type: string)}
  {@const m = PARTS[type]!}
  {@const n = counts[type] ?? 0}
  <div class="tile" class:on={n > 0}>
    <button class="pick" title={m.manifest.name} onclick={() => set(type, n + 1)}>
      <svg viewBox={m.icon ?? '-1 -3 6 6.5'}>{@html preview(type)}</svg>
      <span class="name">{m.manifest.name}</span>
    </button>
    {#if n > 0}
      <span class="qty">
        <button aria-label="Bớt {m.manifest.name}" onclick={() => set(type, n - 1)}><Icon name="minus" size={12} /></button>
        <b>{n}</b>
        <button aria-label="Thêm {m.manifest.name}" onclick={() => set(type, n + 1)}><Icon name="plus" size={12} /></button>
      </span>
    {/if}
  </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Tạo bàn làm việc mới">
    <header>
      <h2>Tạo bàn làm việc mới</h2>
      <ol class="steps">
        {#each STEPS as s, i}
          <li class:on={i === step} class:done={i < step}>
            <button disabled={i > step} onclick={() => (step = i)}><span class="n">{#if i < step}<Icon name="check" size={11} />{:else}{i + 1}{/if}</span>{s}</button>
          </li>
        {/each}
      </ol>
      <button class="close" aria-label="Đóng" onclick={onclose}><Icon name="close" size={14} /></button>
    </header>

    <div class="body">
      {#if step === 0}
        <p class="lead">Chọn board ESP32 bạn sẽ dùng. Đổi lại sau được, dây nối sẽ theo chân tương ứng.</p>
        <div class="cards">
          {#each Object.entries(BOARDS) as [type, b] (type)}
            {@const right = Math.max(...b.pins.map((p) => p.x))}
            <button class="card" class:on={board === type} onclick={() => (board = type)} ondblclick={() => (step = 1)}>
              <svg viewBox="-1.6 -3.9 {right + 3.2} {b.height + 3.4}"><BoardView board={b} net={new Set()} observables={{}} pinFill={() => 'url(#gold)'} pinHint={() => ''} onpress={() => {}} onrelease={() => {}} /></svg>
              <span class="name">{b.name.replace(/ \(.*/, '')}</span>
              <span class="meta">{b.name.match(/\((.*)\)/)?.[1] ?? ''} · {b.pins.length} chân</span>
            </button>
          {/each}
        </div>
      {:else if step === 1}
        <p class="lead">Bấm vào linh kiện để thêm, bấm nữa để thêm cái thứ hai. Có thể bỏ qua bước này và kéo linh kiện vào sau.</p>
        <div class="search">
          <span class="glass"><Icon name="search" size={14} /></span>
          <input type="search" placeholder="Tìm linh kiện… (vd: led, cam bien, i2c)" bind:value={query} onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Escape') query = ''; }} aria-label="Tìm linh kiện" />
        </div>
        <div class="parts">
          {#if query.trim()}
            <div class="grid">{#each shown as [type] (type)}{@render tile(type)}{/each}</div>
            {#if !shown.length}<p class="meta">Không có linh kiện nào khớp "{query}".</p>{/if}
          {:else}
            {#each groups as g}
              <h3>{CATEGORY[g] ?? g}</h3>
              <div class="grid">{#each ENTRIES.filter(([, m]) => m.manifest.category === g) as [type] (type)}{@render tile(type)}{/each}</div>
            {/each}
          {/if}
        </div>
      {:else}
        <p class="lead">Cắm linh kiện lên breadboard, hay để chúng nằm trên bàn và nối dây thẳng tới board?</p>
        <div class="cards">
          <button class="card" class:on={bb === null} onclick={() => (bb = null)}>
            <span class="none"><Icon name="close" size={28} /></span>
            <span class="name">Không dùng breadboard</span>
            <span class="meta">Chân linh kiện nối dây thẳng tới board</span>
          </button>
          {#each Object.entries(BREADBOARDS) as [type, d] (type)}
            {@const bx = breadboardBox(type)!}
            <button class="card" class:on={bb === type} onclick={() => (bb = type)}>
              <svg viewBox="{bx.x - 0.3} {bx.y - 0.3} {bx.w + 0.6} {bx.h + 0.6}"><BreadboardView id={type} bb={breadboard(type)!} net={new Set()} here={null} /></svg>
              <span class="name">{d.name}</span>
              <span class="meta">{d.columns} cột{d.rails.length ? ' · có ray nguồn' : ' · không có ray nguồn'}</span>
            </button>
          {/each}
        </div>
        <div class="finish">
          <label class="title">Tên dự án <input bind:value={title} maxlength="80" onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') create(); }} /></label>
          {#if total}
            <label class="check"><input type="checkbox" bind:checked={plug} /> Tự cắm và nối dây các linh kiện theo cách cắm mẫu</label>
          {/if}
        </div>
      {/if}
    </div>

    <footer>
      <span class="summary">
        {BOARDS[board]!.name.replace(/ \(.*/, '')}
        · {total ? `${total} linh kiện` : 'chưa có linh kiện'}
        {#if step === 2}· {bb ? BREADBOARDS[bb]!.name : 'không breadboard'}{/if}
      </span>
      {#if step > 0}<button onclick={() => step--}><Icon name="chevron-left" size={12} />Quay lại</button>{/if}
      {#if step < STEPS.length - 1}
        <button class="primary" onclick={() => step++}>{step === 1 && !total ? 'Bỏ qua' : 'Tiếp'}<Icon name="chevron-right" size={12} /></button>
      {:else}
        <button class="primary" disabled={creating} onclick={create}>Tạo bàn</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 50; background: #15191d66; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .dialog { display: flex; flex-direction: column; width: min(860px, 100%); max-height: min(720px, 100%); background: var(--surface); border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); box-shadow: var(--shadow-float); }
  header { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  h2 { font-size: 16px; font-weight: 700; margin: 0; white-space: nowrap; }
  .steps { display: flex; gap: 4px; list-style: none; margin: 0 auto 0 0; padding: 0; }
  .steps button { display: flex; align-items: center; gap: 6px; border: none; background: none; padding: 4px 8px; font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); }
  .steps button:disabled { color: var(--ink-4); }
  .steps .n { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: 1px solid currentColor; font-size: 10.5px; }
  .steps .on button { color: var(--accent); }
  .steps .on .n { background: var(--accent); border-color: var(--accent); color: #fff; }
  .steps .done button { color: var(--ok); }
  .steps li + li::before { content: ''; display: inline-block; width: 14px; height: 1px; background: var(--line-strong); vertical-align: middle; margin-right: 4px; }
  .steps li { display: flex; align-items: center; }
  .close { border: none; background: none; padding: 4px; }
  .body { flex: 1; overflow-y: auto; padding: 14px 16px 16px; }
  .lead { margin: 0 0 12px; color: var(--ink-3); font-size: var(--fs-md); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px; text-align: left; border: 1px solid var(--line); background: var(--surface); }
  .card.on, .tile.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background-color: var(--accent-soft); }
  .card svg, .card .none { width: 100%; height: 120px; background-color: var(--bg); background-image: linear-gradient(#0000000a 1px, transparent 1px), linear-gradient(90deg, #0000000a 1px, transparent 1px); background-size: 8px 8px; border: 1px solid var(--line-soft); margin-bottom: 4px; }
  .card .none { display: flex; align-items: center; justify-content: center; color: var(--ink-4); box-sizing: border-box; }
  .name { font-size: 13px; font-weight: 600; line-height: 1.3; }
  .meta { font: var(--fs-xs) var(--font-mono); color: var(--ink-3); }
  .search { position: relative; margin-bottom: 8px; }
  .search .glass { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--ink-4); display: flex; }
  .search input { width: 100%; box-sizing: border-box; padding-left: 28px; }
  .parts h3 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 12px 0 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
  .tile { position: relative; display: flex; flex-direction: column; border: 1px solid var(--line); background: var(--surface); }
  .pick { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 6px; border: none; background: none; text-align: center; }
  .pick svg { width: 100%; height: 44px; }
  .pick .name { font-size: 11.5px; }
  .qty { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--accent); }
  .qty button { border: none; background: none; padding: 2px 8px; min-height: 0; }
  .qty b { font: 700 12px var(--font-mono); color: var(--accent); }
  .finish { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
  .finish .title { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: var(--fs-md); }
  .finish .title input { flex: 1; max-width: 360px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md); }
  footer { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--line); background: var(--surface-2); }
  footer button { display: inline-flex; align-items: center; gap: 4px; }
  .summary { margin-right: auto; font: var(--fs-xs) var(--font-mono); color: var(--ink-3); }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .primary:hover:not(:disabled) { background-color: var(--accent-hi); }
  .primary:disabled { background: var(--surface-3); border-color: var(--line); color: var(--ink-3); }
</style>
