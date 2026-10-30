<script lang="ts">
  // Parts and breadboards to drag onto the bench, and the board to build on. Everything listed
  // comes from the component catalog. With many parts the list is searched, filtered by category
  // and shown as a grid of tiles grouped by category.
  import type { PartModule } from '@esp32lab/part-sdk';
  import { BOARDS, BREADBOARDS, LESSONS, PARTS } from '../lib/catalog';
  import { breadboard } from '../lib/geometry';
  import { lab } from '../lib/lab.svelte';
  import Icon from './Icon.svelte';

  let { dragType = $bindable<string | null>(null) } = $props();

  let lesson = $derived(LESSONS.find((l) => l.id === lab.lessonId));
  /** Part types the current lesson's checks ask for get a "this lesson" badge. */
  let wanted = $derived(new Set(JSON.stringify(lesson ?? {}).match(/"type":"(\w+)"/g)?.map((m) => m.slice(8, -1)) ?? []));

  const CATEGORIES: Record<string, string> = { output: 'Đầu ra', input: 'Đầu vào', sensor: 'Cảm biến', display: 'Hiển thị', passive: 'Thụ động', power: 'Nguồn', instrument: 'Đo lường' };
  const ENTRIES = Object.entries(PARTS);
  const order = Object.keys(CATEGORIES);
  /** Categories that have parts, in the order above. */
  const groups = [...new Set(ENTRIES.map(([, m]) => m.manifest.category))].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  /** Lowercase without Vietnamese marks, so "cam bien" finds "Cảm biến". */
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const haystack = (type: string, m: PartModule<any>) => fold([type, m.manifest.name, CATEGORIES[m.manifest.category] ?? '', ...(m.manifest.tags ?? [])].join(' '));
  const INDEX = new Map(ENTRIES.map(([type, m]) => [type, haystack(type, m)]));

  let query = $state('');
  /** Category chip: 'all', 'lesson' or a category. */
  let filter = $state<string>('all');
  let collapsed = $state<Record<string, boolean>>({ board: true, keys: true });

  let matches = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return ENTRIES.filter(([type, m]) =>
      words.every((w) => INDEX.get(type)!.includes(w)) &&
      (filter === 'all' || (filter === 'lesson' ? wanted.has(type) : m.manifest.category === filter)));
  });
  /** Searching or filtering shows one flat grid; otherwise the parts are grouped by category. */
  let flat = $derived(!!query.trim() || filter !== 'all');
  // A chip that no longer applies (the lesson was left) goes back to all
  $effect(() => {
    if (filter === 'lesson' && !wanted.size) filter = 'all';
  });

  function preview(type: string): string {
    const m = PARTS[type]!;
    const props: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(m.manifest.props)) props[k] = s.default;
    return m.view?.(props as never, {}) ?? '';
  }
  const count = (cat: string) => ENTRIES.filter(([, m]) => m.manifest.category === cat).length;
</script>

{#snippet tile(type: string, m: PartModule<any>)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tile trace" class:wanted={wanted.has(type)} title={m.manifest.name} onpointerdown={(e) => { e.preventDefault(); if (!lab.locked()) dragType = type; }}>
    <svg viewBox={m.icon ?? '-1 -3 6 6.5'} width="52" height="44">{@html preview(type)}</svg>
    <div class="name">{m.manifest.name}</div>
    {#if wanted.has(type)}<span class="badge" title="Bài học này dùng linh kiện này">Bài này</span>{/if}
    <button class="info" title="Trang chi tiết: sơ đồ chân, đặc tuyến, cách nối" aria-label="Chi tiết {m.manifest.name}" onpointerdown={(e) => e.stopPropagation()} onclick={() => (lab.docPage = type)}>i</button>
  </div>
{/snippet}

{#snippet head(key: string, label: string, n?: number)}
  <button class="group" aria-expanded={!collapsed[key]} onclick={() => (collapsed[key] = !collapsed[key])}>
    <Icon name={collapsed[key] ? 'chevron-right' : 'chevron-down'} size={11} />{label}{#if n !== undefined}<span class="n">{n}</span>{/if}
  </button>
{/snippet}

<section>
  <div class="toolbar">
    <div class="search">
      <span class="glass"><Icon name="search" size={14} /></span>
      <input type="search" placeholder="Tìm linh kiện… (vd: led, cam bien, i2c)" bind:value={query} onkeydown={(e) => e.key === 'Escape' && (query = '')} aria-label="Tìm linh kiện" />
    </div>
    <div class="chips" role="group" aria-label="Lọc theo nhóm">
      <button class:on={filter === 'all'} onclick={() => (filter = 'all')}>Tất cả <span>{ENTRIES.length}</span></button>
      {#if wanted.size}<button class="lesson" class:on={filter === 'lesson'} onclick={() => (filter = 'lesson')}>Bài này <span>{wanted.size}</span></button>{/if}
      {#each groups as g}<button class:on={filter === g} onclick={() => (filter = filter === g ? 'all' : g)}>{CATEGORIES[g] ?? g} <span>{count(g)}</span></button>{/each}
    </div>
  </div>

  {#if flat}
    {#if matches.length}
      <div class="grid">{#each matches as [type, m] (type)}{@render tile(type, m)}{/each}</div>
    {:else}
      <p class="empty">Không có linh kiện nào khớp “{query}”.{#if filter !== 'all'} <button class="link" onclick={() => (filter = 'all')}>Tìm trong tất cả</button>{/if}</p>
    {/if}
  {:else}
    {#each groups as g (g)}
      {@render head(g, CATEGORIES[g] ?? g, count(g))}
      {#if !collapsed[g]}
        <div class="grid">{#each ENTRIES.filter(([, m]) => m.manifest.category === g) as [type, m] (type)}{@render tile(type, m)}{/each}</div>
      {/if}
    {/each}
  {/if}

  {@render head('bb', 'Breadboard', Object.keys(BREADBOARDS).length)}
  {#if !collapsed.bb}
    {#each Object.entries(BREADBOARDS) as [type, def] (type)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="row trace" title="Kéo thả vào bàn để thêm. Chạm breadboard để chọn rồi kéo để di chuyển, Del để xoá." onpointerdown={(e) => { e.preventDefault(); if (!lab.locked()) dragType = `bb:${type}`; }}>
        <span class="bb-icon" aria-hidden="true"></span>
        <div>
          <div class="name">{def.name}</div>
          <div class="meta">{def.columns} cột{def.rails.length ? ` · ${def.rails.length} thanh nguồn` : ' · không có thanh nguồn'} · {breadboard(type)?.holes.size} lỗ</div>
        </div>
        <button class="info" title="Trang chi tiết: lỗ nào nối với lỗ nào" onpointerdown={(e) => e.stopPropagation()} onclick={() => (lab.docPage = `bb:${type}`)}>i</button>
      </div>
    {/each}
  {/if}

  {@render head('board', `Board · ${(BOARDS[lab.project.board.type]?.name ?? '').replace(/ \(.*/, '')}`)}
  {#if !collapsed.board}
    {#if lesson}<p class="hint">Bài học dùng board của bài; đổi board trong Sân chơi hoặc dự án của bạn.</p>{/if}
    {#each Object.entries(BOARDS) as [type, def] (type)}
      <div class="board-row">
        <button class="row board" class:current={lab.project.board.type === type} disabled={!!lesson && lab.project.board.type !== type}
          onclick={() => lab.setBoard(type)}>
          <div>
            <div class="name">{def.name.replace(/ \(.*/, '')}</div>
            <div class="meta">{def.pins.length} chân · {def.look?.module ?? 'ESP32-WROOM-32'}{#if lab.project.board.type === type} · <span class="badge-text">Đang dùng</span>{/if}</div>
          </div>
        </button>
        <button class="info" title="Trang chi tiết: sơ đồ chân, nguồn, mạch trên board" onclick={() => (lab.docPage = `board:${type}`)}>i</button>
      </div>
    {/each}
  {/if}

  {@render head('keys', 'Phím tắt & thao tác')}
  {#if !collapsed.keys}
    <div class="keys">
      Kéo thả linh kiện vào breadboard. Kéo từ một lỗ tới lỗ khác để nối dây. Hai ngón tay: phóng to, di chuyển.<br />
      R: xoay · Del: xoá · Esc: huỷ · +/− / 0: zoom<br />Ctrl+Z: hoàn tác · Ctrl+Y: làm lại<br />Kéo linh kiện ra ngoài breadboard: dây tự nối từ lỗ cũ tới chân; kéo từ chân để nối dây<br />Kéo chỗ trống: di chuyển bàn · Chạm board/breadboard rồi kéo: dời nó<br />Rê chuột hoặc chạm vào lỗ: xem các điểm cùng mạch
    </div>
  {/if}
</section>

<style>
  section { padding: 0 10px 12px; overflow: auto; }
  /* Search and category chips stay at the top while the list scrolls */
  .toolbar { position: sticky; top: 0; z-index: 2; background: var(--surface-2); margin: 0 -10px 4px; padding: 10px 10px 8px; border-bottom: 1px solid var(--line-soft); }
  .search { position: relative; }
  .glass { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); display: flex; color: var(--ink-3); pointer-events: none; }
  .search input { width: 100%; box-sizing: border-box; padding-left: 28px; font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .chips button { font: 600 10.5px var(--font-mono); text-transform: uppercase; letter-spacing: .05em; padding: 3px 7px; color: var(--ink-2); background: var(--surface); border-color: var(--line); }
  .chips button span { color: var(--ink-4); font-weight: 400; margin-left: 2px; }
  .chips button.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
  .chips button.on span { color: var(--ink-4); }
  .chips button.lesson:not(.on) { color: var(--accent); border-color: #f76b1566; }
  /* Group headers fold their part of the list */
  .group { display: flex; align-items: center; gap: 6px; width: 100%; margin: 10px 0 6px; padding: 4px 0; background: none; border: none; border-bottom: 1px solid var(--line-soft); font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); text-align: left; cursor: pointer; }
  .group:hover { color: var(--ink); }
  .group :global(.ico) { color: var(--ink-4); }
  .group .n { margin-left: auto; font-weight: 400; color: var(--ink-4); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; }
  .tile { position: relative; touch-action: none; -webkit-user-select: none; user-select: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px 6px; border: 1px solid var(--line); background: var(--surface); cursor: grab; min-width: 0; }
  .tile svg { background: var(--surface-2); border: 1px solid var(--line-soft); width: 100%; max-width: 72px; }
  .tile .name { font-size: 11.5px; font-weight: 600; line-height: 1.25; text-align: center; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
  .tile.wanted { border-color: #f76b1599; box-shadow: inset 0 2px 0 var(--accent); }
  .tile .badge { position: absolute; left: 4px; top: 4px; font: 600 9px var(--font-mono); text-transform: uppercase; letter-spacing: .04em; color: #fff; background: var(--accent); padding: 0 4px; line-height: 14px; }
  .tile .info { position: absolute; right: 4px; top: 4px; opacity: 0; transition: opacity .12s; }
  .tile:hover .info, .tile .info:focus-visible { opacity: 1; }
  @media (hover: none) { .tile .info { opacity: 1; } }
  .row { touch-action: none; -webkit-user-select: none; user-select: none; display: flex; gap: 10px; align-items: center; padding: 6px 8px; border: 1px solid var(--line); margin-bottom: 4px; background: var(--surface); cursor: grab; }
  .row.board { width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; }
  .row.board:disabled { cursor: not-allowed; opacity: .5; }
  .row.current { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
  /* A tiny breadboard: rows of holes */
  .bb-icon { flex: 0 0 auto; width: 32px; height: 22px; border: 1px solid var(--line-strong); background: radial-gradient(circle, var(--ink-3) 0.8px, transparent 1.2px) 0 0 / 4px 4px, var(--surface-2); }
  .name { font-size: 13px; font-weight: 600; }
  .meta { font: 10.5px var(--font-mono); color: var(--ink-3); margin-top: 1px; }
  .badge-text { color: var(--accent); font-weight: 600; }
  .hint, .keys, .empty { font-size: 12px; color: var(--ink-3); line-height: 1.45; }
  .hint { margin: 0 0 8px; }
  .empty { margin: 16px 2px; }
  .link { background: none; border: none; padding: 0; color: var(--signal); text-decoration: underline; font-size: 12px; cursor: pointer; }
  .keys { line-height: 1.6; padding: 8px 10px; border: 1px dashed var(--line-strong); background: var(--surface); }
  .board-row { position: relative; }
  .board-row .info { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
  .info { margin-left: auto; flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border-radius: 50%; font: italic 700 11px Georgia, serif; color: var(--signal); border-color: var(--line); background: var(--surface); cursor: pointer; }
  .info:hover { background: var(--signal-soft); border-color: var(--signal); }
</style>
