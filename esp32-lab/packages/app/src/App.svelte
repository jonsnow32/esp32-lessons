<script lang="ts">
  import CodePanel from './components/CodePanel.svelte';
  import ExplainPanel from './components/ExplainPanel.svelte';
  import Home from './components/Home.svelte';
  import Inspector from './components/Inspector.svelte';
  import LessonPanel from './components/LessonPanel.svelte';
  import BoardPage from './components/BoardPage.svelte';
  import BreadboardPage from './components/BreadboardPage.svelte';
  import PartPage from './components/PartPage.svelte';
  import Library from './components/Library.svelte';
  import SerialMonitor from './components/SerialMonitor.svelte';
  import Workbench from './components/Workbench.svelte';
  import { FREE, lab } from './lib/lab.svelte';

  let dragType = $state<string | null>(null);
  const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  let damaged = $derived(lab.diagnostics.filter((d) => d.severity === 'error'));
  let menuOpen = $state(false);

  /** Code editor below the bench: share of the centre column, 0 = collapsed. */
  let codeShare = $state(Number(localStorage.getItem('esp32lab.codeShare') ?? 0.4));
  $effect(() => localStorage.setItem('esp32lab.codeShare', String(codeShare)));

  function startResize(e: PointerEvent) {
    const column = (e.currentTarget as HTMLElement).parentElement!;
    const rect = column.getBoundingClientRect();
    const move = (ev: PointerEvent) => (codeShare = Math.min(0.8, Math.max(0.12, (rect.bottom - ev.clientY) / rect.height)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const time = (at: number) => new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  /** One plain sentence: what is on the board right now. */
  let programText = $derived.by(() => {
    const p = lab.program;
    if (lab.build.status === 'building') return { tone: 'busy', text: 'Đang build code của bạn…' };
    if (p.kind === 'none') return { tone: 'idle', text: 'Board chưa chạy chương trình nào' };
    const what = p.kind === 'sketch' ? `main.cpp của bạn (build ${time(p.at)})` : p.codeHash ? `code gốc của bài (bản build sẵn ${p.env})` : `bản build sẵn .pio/build/${p.env}`;
    if (lab.codeChanged) return { tone: 'stale', text: `Đang chạy ${what}. Code trong editor đã sửa, chưa build lại` };
    return { tone: lab.running ? 'run' : 'idle', text: `${lab.running ? 'Đang chạy' : 'Tạm dừng'}: ${what}` };
  });

  let runLabel = $derived(
    lab.build.status === 'building'
      ? '⏳ Đang build…'
      : lab.codeChanged
        ? lab.program.kind === 'none' ? '▶ Chạy' : '▶ Chạy code mới'
        : lab.running ? '⏸ Tạm dừng' : '▶ Tiếp tục',
  );

  /** Right column: one page at a time. "Đang chọn" only exists while something is selected. */
  type Page = 'select' | 'lesson' | 'explain' | 'serial';
  let pages = $derived(
    [
      lab.selection && { id: 'select' as const, label: 'Đang chọn' },
      (lab.lesson || lab.source) && { id: 'lesson' as const, label: lab.lesson ? 'Bài học' : 'Dự án' },
      { id: 'explain' as const, label: 'Mạch' },
      { id: 'serial' as const, label: 'Serial' },
    ].filter((p): p is { id: Page; label: string } => !!p),
  );
  let chosen = $state<Page>('lesson');
  /** The chosen page, or the first one when it is not there (no selection, no lesson). */
  let page = $derived(pages.some((p) => p.id === chosen) ? chosen : pages[0]!.id);
  // Selecting something on the bench brings up its page
  $effect(() => {
    if (lab.selection) chosen = 'select';
  });
  /** Warnings and errors the circuit page has, shown on its tab. */
  let problems = $derived(lab.notes.filter((n) => n.level === 'warn' || n.level === 'error').length);
  /** Serial output not seen yet: a dot on the Serial tab. */
  let serialSeen = $state(0);
  $effect(() => {
    if (page === 'serial') serialSeen = lab.serial.length;
  });
  let serialNew = $derived(page !== 'serial' && lab.serial.length > serialSeen);

  function menu(action: () => void) {
    menuOpen = false;
    action();
  }
</script>

<svelte:window onpointerup={() => setTimeout(() => (dragType = null))} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#if lab.docPage}
  {#key lab.docPage}
    {#if lab.docPage.startsWith('board:')}<BoardPage />{:else if lab.docPage.startsWith('bb:')}<BreadboardPage />{:else}<PartPage />{/if}
  {/key}
{/if}

{#if lab.route === 'home'}
  <Home />
{:else}
  <header>
    <button class="back" onclick={() => lab.goHome()} title="Trang chủ: bài học và dự án mẫu">← Trang chủ</button>
    {#if lab.mine}
      {@const mine = lab.mine}
      <h1>📁 {mine.title}</h1>
      <button class="icon" title="Đổi tên dự án" onclick={() => { const t = prompt('Tên dự án', mine.title); if (t) lab.renameMyProject(mine.id, t); }}>✎</button>
    {:else}
      <h1>{lab.route === FREE ? '🧪 Tự do' : lab.featured ? `⭐ ${lab.featured.title}` : (lab.lesson?.titleVi ?? lab.lesson?.title)}</h1>
      {#if lab.featured}<span class="original" title="Dự án mẫu không bị sửa: thay đổi đầu tiên sẽ tạo một bản sao của bạn">Bản gốc · sửa sẽ tạo bản sao</span>{/if}
    {/if}
    <span class="sep"></span>
    <button class="primary" disabled={lab.build.status === 'building'} onclick={() => lab.runOrPause()}>{runLabel}</button>
    <button onclick={() => lab.reset()} disabled={lab.program.kind === 'none'} title="Khởi động lại chương trình, như nhấn nút EN">↺ Reset</button>
    <label>Tốc độ
      <select value={String(lab.speed)} onchange={(e) => lab.setSpeed(Number(e.currentTarget.value))}>
        {#each SPEEDS as s}<option value={String(s)}>{s}×</option>{/each}
      </select>
    </label>
    <span class="program {programText.tone}"><span class="dot"></span>{programText.text}</span>
    {#if lab.program.kind !== 'none'}
      <span class="clock">t = {(lab.t / 1e9).toFixed(2)} s{#if lab.running} · {lab.rate.toFixed(2)}×{/if}</span>
    {/if}
    <span class="spacer"></span>
    <div class="more">
      <button onclick={() => (menuOpen = !menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen} title="Thêm">⋯</button>
      {#if menuOpen}
        <div class="menu" role="menu">
          {#if !lab.featured}
          <button role="menuitem" onclick={() => menu(() => confirm(lab.route === FREE ? 'Xoá hết mạch và code trong chế độ Tự do?' : (lab.mine ? 'Đưa mạch và code của bản sao về như dự án gốc? Phần bạn đã sửa sẽ mất.' : 'Đưa mạch và code về như lúc mới mở bài? Phần bạn đã sửa sẽ mất.')) && lab.restart())}>
            ↺ {lab.route === FREE ? 'Xoá bàn và code' : lab.mine ? 'Đưa bản sao về như bản gốc' : 'Làm lại bài từ đầu'}
          </button>
          {/if}
          <button role="menuitem" onclick={() => menu(() => (codeShare = codeShare > 0 ? 0 : 0.4))}>{codeShare > 0 ? 'Ẩn' : 'Hiện'} trình soạn code</button>
          {#if lab.envs.length}
            <div class="menu-head">Chạy bản build sẵn (.pio/build), bỏ qua editor</div>
            {#each lab.envs as env}
              <button role="menuitem" onclick={() => menu(() => lab.runPrebuilt(env))}>{env}</button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </header>

  {#if lab.halted}<div class="banner">Chip dừng: {lab.halted}</div>{/if}
  {#if lab.notice}<div class="banner info" role="status">{lab.notice} <button onclick={() => (lab.notice = null)}>×</button></div>{/if}
  {#if lab.error}<div class="banner" role="alert">{lab.error} <button onclick={() => (lab.error = null)}>×</button></div>{/if}
  {#each damaged as d}<div class="banner warn">⚠ {d.message}</div>{/each}

  <main>
    <aside class="left"><Library bind:dragType /></aside>
    <div class="center">
      <div class="bench" style="flex: {codeShare > 0 ? 1 - codeShare : 1}"><Workbench bind:dragType /></div>
      {#if codeShare > 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="splitter" onpointerdown={startResize} title="Kéo để đổi kích thước"></div>
        <div class="code" style="flex: {codeShare}"><CodePanel /></div>
      {:else}
        <button class="code-toggle" onclick={() => (codeShare = 0.4)}>▴ Code</button>
      {/if}
    </div>
    <aside class="right">
      <nav class="pages" role="tablist">
        {#each pages as p (p.id)}
          <button role="tab" aria-selected={page === p.id} class:on={page === p.id} onclick={() => (chosen = p.id)}>
            {p.label}
            {#if p.id === 'explain' && problems}<span class="count">{problems}</span>{/if}
            {#if p.id === 'serial' && serialNew}<span class="new"></span>{/if}
          </button>
        {/each}
      </nav>
      <div class="page" role="tabpanel">
        {#if page === 'select'}<Inspector />
        {:else if page === 'lesson'}<LessonPanel />
        {:else if page === 'explain'}<ExplainPanel />
        {:else}<SerialMonitor />{/if}
      </div>
    </aside>
  </main>
{/if}

<style>
  /* Top bar is the instrument bezel: dark, with the run controls and a readout; it stays pinned at the top while the page scrolls */
  header { display: flex; gap: 10px; align-items: center; box-sizing: border-box; min-height: 49px; padding: 8px 14px; border-bottom: 1px solid #000; background: var(--bezel); color: var(--ink-inv); flex-wrap: wrap; position: sticky; top: 0; z-index: 20; color-scheme: dark; }
  header > button:not(.primary), .more > button, label select { background-color: var(--bezel-2); color: var(--ink-inv); border-color: var(--bezel-line); }
  header > button:not(.primary):hover, .more > button:hover, label select:hover { background-color: #2f353c; }
  header > button:not(.primary):disabled { background-color: transparent; color: #6b747c; border-color: #2c3237; }
  .more > button[aria-expanded='true'] { background-color: #2f353c; border-color: var(--ink-inv-2); }
  h1 { font-size: 14.5px; font-weight: 600; letter-spacing: .005em; margin: 0; white-space: nowrap; }
  .back { font-weight: 600; }
  .sep { width: 1px; height: 22px; background: var(--bezel-line); }
  label { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-inv-2); display: flex; gap: 6px; align-items: center; }
  label select { font: 13px var(--font-mono); text-transform: none; letter-spacing: 0; }
  .program { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; padding: 3px 10px; border: 1px solid var(--bezel-line); border-radius: 0; background: var(--bezel-2); color: var(--ink-inv-2); }
  .program .dot { width: 7px; height: 7px; border-radius: 0; background: #5d666e; }
  .program.run { color: #8fe0b4; border-color: #1f4a35; background: #15241d; }
  .program.run .dot { background: var(--ok-dot); box-shadow: 0 0 0 3px #30a46c40; }
  .program.stale { color: #f9bb8a; border-color: #5a3418; background: #2a1d14; }
  .program.stale .dot { background: var(--accent-hi); }
  .program.busy { color: #f6d28c; }
  .program.busy .dot { background: var(--warn-dot); }
  /* Readout: a small LCD window */
  .clock { font: 12px var(--font-mono); font-variant-numeric: tabular-nums; color: #9ee6bd; background: #0a0d0f; border: 1px solid var(--bezel-line); box-shadow: inset 0 1px 2px #000; padding: 3px 8px; }
  .spacer { flex: 1; }
  .more { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--surface); color: var(--ink); color-scheme: light; border: 1px solid var(--line-strong); border-top: 2px solid var(--accent); border-radius: 0; box-shadow: var(--shadow-float); padding: 4px; min-width: 260px; display: flex; flex-direction: column; }
  .menu button { border: none; text-align: left; border-radius: 0; }
  .menu-head { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 8px 10px 3px; border-top: 1px solid var(--line-soft); margin-top: 4px; }
  .banner { padding: 6px 14px; background: var(--error-soft); color: var(--error); font-size: 13px; border-bottom: 1px solid var(--error-line); box-shadow: inset 3px 0 0 currentColor; }
  .banner.warn { background: var(--warn-soft); color: var(--warn); border-bottom-color: #f2d7b3; }
  .banner.info { background: var(--info-soft); color: var(--info); border-bottom-color: var(--info-line); }
  .banner button { background: transparent; border-color: transparent; color: inherit; padding: 0 6px; }
  .original { font: 11px var(--font-mono); color: #f3c46b; background: transparent; border: 1px solid #5f4a1c; border-radius: 0; padding: 1px 8px; }
  .icon { padding: 2px 6px; font-size: 13px; }
  main { display: grid; grid-template-columns: 240px 1fr 360px; height: calc(100vh - 49px); }
  aside { background: var(--surface-2); overflow: auto; }
  .left { border-right: 1px solid var(--line); }
  .right { border-left: 1px solid var(--line); display: flex; flex-direction: column; overflow: hidden; }
  .pages { display: flex; border-bottom: 1px solid var(--line); background: var(--surface); flex: 0 0 auto; }
  .pages button { flex: 1; border: none; border-bottom: 2px solid transparent; background: none; padding: 9px 6px 7px; font: 600 11px var(--font-mono); text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); display: inline-flex; gap: 5px; align-items: center; justify-content: center; }
  .pages button + button { box-shadow: inset 1px 0 0 var(--line-soft); }
  .pages button.on { color: var(--ink); border-bottom-color: var(--accent-hi); background: var(--surface-2); }
  .count { background: var(--accent); color: #fff; font: 600 10px var(--font-mono); padding: 0 5px; line-height: 15px; }
  .new { width: 7px; height: 7px; border-radius: 50%; background: var(--ok-dot); box-shadow: 0 0 0 2px #30a46c33; }
  .page { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .center { min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .bench, .code { min-height: 0; }
  .splitter { flex: 0 0 6px; box-sizing: border-box; cursor: row-resize; background: var(--surface-3); border-block: 1px solid var(--line); touch-action: none; }
  .splitter:hover { background: var(--accent-hi); border-color: var(--accent-hi); }
  .code-toggle { position: absolute; right: 12px; top: 10px; z-index: 2; font: 600 12px var(--font-mono); box-shadow: var(--shadow-float); }
  .primary { --trace: #fff; background: var(--accent); color: #fff; border-color: var(--accent); min-width: 110px; font-weight: 600; }
  .primary:hover { background-color: #a94507; }
  .primary:disabled { opacity: 0.75; cursor: progress; color: #fff; border-color: var(--accent); }
  @media (max-width: 1100px) {
    main { grid-template-columns: 1fr; grid-template-rows: auto 62vh auto; height: auto; }
    .left { border-right: none; border-bottom: 1px solid var(--line); }
    .left :global(section) { display: flex; gap: 8px; overflow-x: auto; align-items: center; }
    .left :global(h2), .left :global(.hint), .left :global(.keys), .left :global(.static) { display: none; }
    .left :global(.item) { flex: 0 0 auto; margin: 0; }
    .right { border-left: none; overflow: visible; }
    .page { min-height: 50vh; }
  }
</style>
