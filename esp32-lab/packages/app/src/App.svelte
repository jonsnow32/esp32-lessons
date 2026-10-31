<script lang="ts">
  import AiPanel from './components/AiPanel.svelte';
  import CodePanel from './components/CodePanel.svelte';
  import ExplainPanel from './components/ExplainPanel.svelte';
  import Home from './components/Home.svelte';
  import Inspector from './components/Inspector.svelte';
  import LessonPanel from './components/LessonPanel.svelte';
  import BoardPage from './components/BoardPage.svelte';
  import BreadboardPage from './components/BreadboardPage.svelte';
  import InventoryPage from './components/InventoryPage.svelte';
  import PartPage from './components/PartPage.svelte';
  import Library from './components/Library.svelte';
  import SerialMonitor from './components/SerialMonitor.svelte';
  import Workbench from './components/Workbench.svelte';
  import Dock from './components/Dock.svelte';
  import Icon, { type IconName } from './components/Icon.svelte';
  import TitleInput from './components/TitleInput.svelte';
  import { FREE, lab } from './lib/lab.svelte';
  import { DOCKS, layout, type DockId, type ViewId } from './lib/layout.svelte';

  let dragType = $state<string | null>(null);
  const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  let damaged = $derived(lab.diagnostics.filter((d) => d.severity === 'error'));
  let menuOpen = $state(false);
  /** The open project's name is being edited in the top bar. */
  let renaming = $state(false);
  /** Started from an empty bench (the sandbox, or a project of the user's own not copied from a featured one). */
  let blank = $derived(lab.route === FREE || (!!lab.mine && !lab.mine.from));
  /** A project of the user's own set up with the new-bench steps: restarting goes back to that bench. */
  let setUp = $derived(!!lab.mine?.start);

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

  let run = $derived<[IconName, string]>(
    lab.build.status === 'building'
      ? ['build', 'Đang build…']
      : lab.codeChanged
        ? ['play', lab.program.kind === 'none' ? 'Chạy' : 'Chạy code mới']
        : lab.running ? ['pause', 'Tạm dừng'] : ['play', 'Tiếp tục'],
  );

  /** Panels around the bench, in docks the user arranges (see layout.svelte.ts). */
  let labels = $derived<Record<ViewId, string>>({
    library: 'Linh kiện',
    code: 'Code',
    select: 'Đang chọn',
    lesson: lab.lesson ? 'Bài học' : 'Dự án',
    explain: 'Mạch',
    serial: 'Serial',
    ai: 'Trợ lý AI',
  });
  /** "Đang chọn" only exists while something is selected, the lesson page with a lesson or project. */
  const available = (v: ViewId) => (v === 'select' ? !!lab.selection : v === 'lesson' ? !!(lab.lesson || lab.source) : true);
  /** A view is on screen: its dock is open and showing it. */
  function visible(v: ViewId) {
    const dock = layout.docks[layout.dockOf(v)];
    const tabs = dock.views.filter(available);
    return dock.open && (dock.active && tabs.includes(dock.active) ? dock.active : tabs[0]) === v;
  }
  // Selecting something on the bench brings up its page, if its dock is open
  $effect(() => {
    if (lab.selection) layout.docks[layout.dockOf('select')].active = 'select';
  });
  /** Warnings and errors the circuit page has, shown on its tab. */
  let problems = $derived(lab.notes.filter((n) => n.level === 'warn' || n.level === 'error').length);
  /** Serial output not seen yet: a dot on the Serial tab. */
  let serialSeen = $state(0);
  $effect(() => {
    if (visible('serial')) serialSeen = lab.serial.length;
  });
  let serialNew = $derived(!visible('serial') && lab.serial.length > serialSeen);
  // A notice says what just happened: it goes by itself after a while, and the "circuit is
  // locked" one as soon as it is not
  $effect(() => {
    if (!lab.notice) return;
    const t = setTimeout(() => (lab.notice = null), 6000);
    return () => clearTimeout(t);
  });
  $effect(() => {
    if (!lab.editLocked && lab.notice?.startsWith('Chương trình đang chạy')) lab.notice = null;
  });
  /** Over which drop zone a dragged tab is, beside or below the bench. */
  let zone = $state<DockId | null>(null);

  function menu(action: () => void) {
    menuOpen = false;
    action();
  }
</script>

<svelte:window onpointerup={() => setTimeout(() => (dragType = null))} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#if lab.docPage}
  {#key lab.docPage}
    {#if lab.docPage === 'inventory'}<InventoryPage />{:else if lab.docPage.startsWith('board:')}<BoardPage />{:else if lab.docPage.startsWith('bb:')}<BreadboardPage />{:else}<PartPage />{/if}
  {/key}
{/if}

{#if lab.route === 'home'}
  <Home />
{:else}
  <!-- Top bar: where you are, the run controls, and the layout. What the board is doing goes in the status bar below -->
  <header>
    <div class="where">
      <button class="back" onclick={() => lab.goHome()} title="Trang chủ: bài học và dự án mẫu" aria-label="Trang chủ"><Icon name="back" /></button>
      <span class="kind">{lab.mine ? 'Dự án của tôi' : lab.route === FREE ? 'Tự do' : lab.featured ? 'Dự án mẫu' : 'Bài học'}</span>
      {#if lab.mine}
        {@const mine = lab.mine}
        {#if renaming}
          <h1><TitleInput value={mine.title} onsave={(t) => lab.renameMyProject(mine.id, t)} ondone={() => (renaming = false)} /></h1>
        {:else}
          <h1>{mine.title}</h1>
          <button class="icon" title="Đổi tên dự án" onclick={() => (renaming = true)}><Icon name="edit" size={14} /></button>
        {/if}
      {:else if lab.route !== FREE}
        <h1>{lab.featured ? lab.featured.title : (lab.lesson?.titleVi ?? lab.lesson?.title)}</h1>
      {/if}
    </div>
    <div class="transport">
      <button class="primary" disabled={lab.build.status === 'building'} onclick={() => lab.runOrPause()}><Icon name={run[0]} size={14} />{run[1]}</button>
      <button class="icon-btn" onclick={() => lab.reset()} disabled={lab.program.kind === 'none'} title="Reset: khởi động lại chương trình, như nhấn nút EN" aria-label="Reset"><Icon name="reset" /></button>
    </div>
    <div class="tools">
      <div class="docks" role="group" aria-label="Khung">
        {#each DOCKS as d}
          <button class="dock-toggle {d}" aria-pressed={layout.docks[d].open} onclick={() => layout.toggle(d)}
            title={`${layout.docks[d].open ? 'Thu nhỏ' : 'Mở'} khung ${d === 'left' ? 'trái' : d === 'right' ? 'phải' : 'dưới'}`}><span></span></button>
        {/each}
      </div>
      <div class="more">
        <button onclick={() => (menuOpen = !menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen} title="Thêm" aria-label="Thêm"><Icon name="more" /></button>
        {#if menuOpen}
          <div class="menu" role="menu">
            {#if !lab.featured}
            <button role="menuitem" onclick={() => menu(() => confirm(setUp ? 'Đưa bàn về như lúc mới tạo và code về mặc định? Phần bạn đã sửa sẽ mất.' : blank ? 'Xoá hết mạch và code trên bàn này?' : (lab.mine ? 'Đưa mạch và code của bản sao về như dự án gốc? Phần bạn đã sửa sẽ mất.' : 'Đưa mạch và code về như lúc mới mở bài? Phần bạn đã sửa sẽ mất.')) && lab.restart())}>
              <Icon name="reset" />{setUp ? 'Đưa bàn về như lúc mới tạo' : blank ? 'Xoá bàn và code' : lab.mine ? 'Đưa bản sao về như bản gốc' : 'Làm lại bài từ đầu'}
            </button>
            {/if}
            <button role="menuitem" onclick={() => menu(() => (visible('code') ? layout.toggle(layout.dockOf('code')) : layout.reveal('code')))}>{visible('code') ? 'Ẩn' : 'Hiện'} trình soạn code</button>
            <label class="menu-check" title="Bật: muốn di chuyển hay sửa mạch phải tạm dừng chương trình trước">
              <input type="checkbox" bind:checked={lab.lockWhileRunning} />Khoá mạch khi chương trình đang chạy
            </label>
            <button role="menuitem" onclick={() => menu(() => layout.reset())}><Icon name="layout" />Đặt lại bố cục các khung</button>
            {#if lab.envs.length}
              <div class="menu-head">Chạy bản build sẵn (.pio/build), bỏ qua editor</div>
              {#each lab.envs as env}
                <button role="menuitem" onclick={() => menu(() => lab.runPrebuilt(env))}>{env}</button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </header>


  {#snippet view(v: ViewId)}
    {#if v === 'library'}<Library bind:dragType />
    {:else if v === 'code'}<CodePanel />
    {:else if v === 'select'}<Inspector />
    {:else if v === 'lesson'}<LessonPanel />
    {:else if v === 'explain'}<ExplainPanel />
    {:else if v === 'ai'}<AiPanel />
    {:else}<SerialMonitor />{/if}
  {/snippet}
  {#snippet badge(v: ViewId)}
    {#if v === 'explain' && problems}<span class="count">{problems}</span>{/if}
    {#if v === 'serial' && serialNew}<span class="new"></span>{/if}
  {/snippet}

  <main>
    <Dock id="left" {labels} {available} {view} {badge} />
    <div class="center">
      <!-- Messages float over the top of the bench: nothing under the pointer moves when one appears -->
      <div class="banners">
        {#if lab.halted}<div class="banner">Chip dừng: {lab.halted}</div>{/if}
        {#if lab.error}<div class="banner" role="alert"><span>{lab.error}</span><button onclick={() => (lab.error = null)} title="Đóng" aria-label="Đóng"><Icon name="close" size={14} /></button></div>{/if}
        {#each damaged as d}<div class="banner warn"><Icon name="warn" /><span>{d.message}</span></div>{/each}
        {#if lab.notice}<div class="banner info" role="status"><span>{lab.notice}</span><button onclick={() => (lab.notice = null)} title="Đóng" aria-label="Đóng"><Icon name="close" size={14} /></button></div>{/if}
      </div>
      <div class="bench" style="flex: {layout.docks.bottom.open && layout.docks.bottom.views.some(available) ? 1 - layout.docks.bottom.size : 1}"><Workbench bind:dragType /></div>
      <Dock id="bottom" {labels} {available} {view} {badge} />
      {#if layout.dragging}
        <!-- While a tab is dragged: drop it beside or below the bench to dock it there -->
        <div class="zones">
          {#each DOCKS as d}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="zone {d}" class:over={zone === d}
              ondragover={(e) => { e.preventDefault(); zone = d; }} ondragleave={() => (zone = null)}
              ondrop={(e) => { e.preventDefault(); layout.move(layout.dragging!, d); layout.dragging = null; zone = null; }}>
              <Icon name="dock-{d}" size={18} />{d === 'left' ? 'Khung trái' : d === 'right' ? 'Khung phải' : 'Khung dưới'}
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <Dock id="right" {labels} {available} {view} {badge} />
  </main>

  <!-- Status bar: what is on the board, simulated time and speed -->
  <footer>
    <span class="program {programText.tone}" title={programText.text}><span class="dot"></span><span class="text">{programText.text}</span></span>
    {#if lab.featured}<span class="cell original" title="Dự án mẫu không bị sửa: thay đổi đầu tiên sẽ tạo một bản sao của bạn">Bản gốc · sửa sẽ tạo bản sao</span>{/if}
    <span class="spacer"></span>
    {#if lab.program.kind !== 'none'}
      <span class="cell mono" title="Thời gian mô phỏng">t = {(lab.t / 1e9).toFixed(2)} s</span>
      {#if lab.running}<span class="cell mono" title="Tốc độ thực tế so với thời gian thật">{lab.rate.toFixed(2)}×</span>{/if}
    {/if}
    <label class="cell">Tốc độ
      <select value={String(lab.speed)} onchange={(e) => lab.setSpeed(Number(e.currentTarget.value))}>
        {#each SPEEDS as s}<option value={String(s)}>{s}×</option>{/each}
      </select>
    </label>
  </footer>
{/if}

<style>
  /* Top bar is the instrument bezel: where you are on the left, run controls centred, layout on the right; pinned at the top */
  header { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; box-sizing: border-box; height: 44px; padding: 0 10px; border-bottom: 1px solid #000; background: var(--bezel); color: var(--ink-inv); position: sticky; top: 0; z-index: 20; color-scheme: dark; }
  .where, .transport, .tools { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .tools { justify-content: flex-end; gap: 10px; }
  header button:not(.primary):not(.dock-toggle):not([role='menuitem']), footer select { background-color: transparent; color: var(--ink-inv); border-color: transparent; }
  header button:not(.primary):not(.dock-toggle):not([role='menuitem']):hover, footer select:hover { background-color: var(--bezel-2); }
  header button:not(.primary):disabled { background-color: transparent; color: #6b747c; border-color: transparent; }
  .more > button { display: flex; padding: 6px 8px; }
  .more > button[aria-expanded='true'] { background-color: var(--bezel-2); border-color: var(--ink-inv-2); }
  /* Icons on the bezel: copper reads brighter on the dark ground */
  header, footer { --icon-accent: var(--accent-hi); }
  .back { display: flex; padding: 6px 8px; }
  .kind { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-inv-2); white-space: nowrap; padding-left: 6px; border-left: 1px solid var(--bezel-line); }
  .kind:has(+ h1)::after { content: ' /'; color: #5d666e; }
  h1 { font-size: 14px; font-weight: 600; letter-spacing: .005em; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .icon { display: flex; padding: 4px 6px; color: var(--ink-inv-2) !important; }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border-color: var(--bezel-line) !important; background-color: var(--bezel-2) !important; }
  .icon-btn:hover:not(:disabled) { background-color: #2f353c !important; border-color: transparent !important; }
  .icon-btn:disabled { background-color: transparent !important; border-color: #2c3237 !important; }
  /* Status bar at the bottom: the program, simulated time and speed, in a row of cells */
  footer { display: flex; align-items: stretch; height: 26px; box-sizing: border-box; border-top: 1px solid #000; background: var(--bezel); color: var(--ink-inv-2); font-size: 12px; color-scheme: dark; position: sticky; bottom: 0; z-index: 20; }
  footer .cell { display: flex; align-items: center; gap: 6px; padding: 0 10px; border-left: 1px solid var(--bezel-line); white-space: nowrap; }
  footer .mono { font: 12px var(--font-mono); font-variant-numeric: tabular-nums; color: #9ee6bd; }
  footer label { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
  footer select { font: 12px var(--font-mono); padding: 0 4px; height: 20px; }
  .program { display: flex; align-items: center; gap: 8px; padding: 0 12px; min-width: 0; }
  .program .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .program .dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: #5d666e; }
  .program.run { color: #8fe0b4; }
  .program.run .dot { background: var(--ok-dot); box-shadow: 0 0 0 3px #30a46c40; }
  .program.stale { color: #f9bb8a; }
  .program.stale .dot { background: var(--accent-hi); }
  .program.busy { color: #f6d28c; }
  .program.busy .dot { background: var(--warn-dot); }
  .original { font: 11px var(--font-mono); color: #f3c46b; }
  .spacer { flex: 1; }
  .more { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--surface); color: var(--ink); color-scheme: light; border: 1px solid var(--line-strong); border-top: 2px solid var(--accent); border-radius: 0; box-shadow: var(--shadow-float); padding: 4px; min-width: 260px; display: flex; flex-direction: column; }
  .menu button { display: flex; align-items: center; gap: 8px; border: none; text-align: left; border-radius: 0; }
  .menu button :global(.ico) { color: var(--ink-3); }
  .menu-check { display: flex; gap: 8px; align-items: center; padding: 6px 10px; font: 13px var(--font-ui); text-transform: none; letter-spacing: 0; color: var(--ink); cursor: pointer; }
  .menu-check:hover { background: var(--surface-3); }
  .menu-head { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 8px 10px 3px; border-top: 1px solid var(--line-soft); margin-top: 4px; }
  .banners { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 10; width: max-content; max-width: min(620px, calc(100% - 24px)); display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
  .banner { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; padding: 7px 8px 7px 12px; background: var(--error-soft); color: var(--error); font-size: 13px; line-height: 1.4; border: 1px solid var(--error-line); box-shadow: inset 3px 0 0 currentColor, var(--shadow-float); }
  .banner span { flex: 1; }
  .banner.warn { background: var(--warn-soft); color: var(--warn); border-color: #f2d7b3; }
  .banner.info { background: var(--info-soft); color: var(--info); border-color: var(--info-line); }
  .banner > :global(.ico) { margin-top: 2px; }
  .banner button { display: flex; align-items: center; height: 18px; flex: 0 0 auto; background: transparent; border-color: transparent; color: inherit; padding: 0 6px; font-size: 16px; line-height: 18px; opacity: .7; }
  .banner button:hover { opacity: 1; background: #0000000d; }
  main { display: flex; height: calc(100vh - 44px - 26px); }
  .count { background: var(--accent); color: #fff; font: 600 10px var(--font-mono); padding: 0 5px; line-height: 15px; }
  .new { width: 7px; height: 7px; border-radius: 50%; background: var(--ok-dot); box-shadow: 0 0 0 2px #30a46c33; }
  .center { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .bench { min-height: 0; }
  /* Drop zones over the bench edges while a tab is dragged */
  .zones { position: absolute; inset: 0; z-index: 30; pointer-events: none; }
  .zone { position: absolute; pointer-events: auto; display: flex; align-items: center; justify-content: center; font: 600 11px var(--font-mono); text-transform: uppercase; letter-spacing: .07em; gap: 8px; color: var(--accent); background: #f76b1514; border: 2px dashed #f76b1566; }
  .zone.left { left: 8px; top: 8px; bottom: 30%; width: 22%; }
  .zone.right { right: 8px; top: 8px; bottom: 30%; width: 22%; }
  .zone.bottom { left: 8px; right: 8px; bottom: 8px; height: calc(30% - 16px); }
  .zone.over { background: #f76b1540; border-color: var(--accent-hi); border-style: solid; }
  /* Dock toggles in the top bar: a small window outline with the dock's side filled in */
  .docks { display: flex; gap: 2px; }
  .dock-toggle { width: 28px; height: 26px; padding: 0; display: grid; place-items: center; background-color: var(--bezel-2); border-color: var(--bezel-line); }
  .dock-toggle:hover { background-color: #2f353c; }
  .dock-toggle span { width: 14px; height: 11px; border: 1.5px solid #6b747c; box-sizing: border-box; position: relative; }
  .dock-toggle span::after { content: ''; position: absolute; background: #6b747c; }
  .dock-toggle.left span::after { left: 0; top: 0; bottom: 0; width: 4px; }
  .dock-toggle.right span::after { right: 0; top: 0; bottom: 0; width: 4px; }
  .dock-toggle.bottom span::after { left: 0; right: 0; bottom: 0; height: 3px; }
  .dock-toggle[aria-pressed='true'] span { border-color: var(--ink-inv); }
  .dock-toggle[aria-pressed='true'] span::after { background: var(--ink-inv); }
  .primary { --trace: #fff; --icon-accent: currentColor; display: inline-flex; align-items: center; justify-content: center; gap: 7px; background: var(--accent); color: #fff; border-color: var(--accent); min-width: 110px; font-weight: 600; }
  .primary:hover { background-color: #a94507; }
  .primary:disabled { opacity: 0.75; cursor: progress; color: #fff; border-color: var(--accent); }
  @media (max-width: 1100px) {
    main { flex-direction: column; height: auto; }
    .center { flex: 0 0 62vh; }
    .docks { display: none; }
    .program .text { white-space: normal; }
  }
</style>
