<script lang="ts">
  import CodePanel from './components/CodePanel.svelte';
  import ExplainPanel from './components/ExplainPanel.svelte';
  import Home from './components/Home.svelte';
  import Inspector from './components/Inspector.svelte';
  import LessonPanel from './components/LessonPanel.svelte';
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

  function menu(action: () => void) {
    menuOpen = false;
    action();
  }
</script>

<svelte:window onpointerup={() => setTimeout(() => (dragType = null))} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#if lab.route === 'home'}
  <Home />
{:else}
  <header>
    <button class="back" onclick={() => lab.goHome()} title="Danh sách bài học">← Bài học</button>
    <h1>{lab.route === FREE ? '🧪 Tự do' : (lab.lesson?.titleVi ?? lab.lesson?.title)}</h1>
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
          <button role="menuitem" onclick={() => menu(() => confirm(lab.route === FREE ? 'Xoá hết mạch và code trong chế độ Tự do?' : 'Đưa mạch và code về như lúc mới mở bài? Phần bạn đã sửa sẽ mất.') && lab.restart())}>
            ↺ {lab.route === FREE ? 'Xoá bàn và code' : 'Làm lại bài từ đầu'}
          </button>
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
      <Inspector />
      <LessonPanel />
      <ExplainPanel />
      <SerialMonitor />
    </aside>
  </main>
{/if}

<style>
  header { display: flex; gap: 10px; align-items: center; padding: 8px 14px; border-bottom: 1px solid #e4e2dd; background: #fff; flex-wrap: wrap; position: relative; z-index: 5; }
  h1 { font-size: 15px; margin: 0; white-space: nowrap; }
  .back { font-weight: 600; }
  .sep { width: 1px; height: 22px; background: #e4e2dd; }
  label { font-size: 13px; display: flex; gap: 6px; align-items: center; }
  .program { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 4px 10px; border-radius: 999px; background: #f4f4f2; color: #4b4d57; }
  .program .dot { width: 8px; height: 8px; border-radius: 50%; background: #b9bbc6; }
  .program.run { background: #eefaf3; color: #18794e; }
  .program.run .dot { background: #30a46c; box-shadow: 0 0 0 3px #30a46c33; }
  .program.stale { background: #fff7ed; color: #8a3d00; }
  .program.stale .dot { background: #f76b15; }
  .program.busy .dot { background: #f5a524; }
  .clock { font: 12px ui-monospace, monospace; color: #6f6e77; }
  .spacer { flex: 1; }
  .more { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 4px); background: #fff; border: 1px solid #e4e2dd; border-radius: 10px; box-shadow: 0 8px 24px #0002; padding: 6px; min-width: 260px; display: flex; flex-direction: column; }
  .menu button { border: none; text-align: left; border-radius: 6px; }
  .menu-head { font-size: 11px; color: #8b8d98; padding: 8px 10px 2px; border-top: 1px solid #eee; margin-top: 4px; }
  .banner { padding: 6px 14px; background: #fff0f0; color: #ce2c31; font-size: 13px; border-bottom: 1px solid #fdd; }
  .banner.warn { background: #fff7ed; color: #cc4e00; }
  main { display: grid; grid-template-columns: 240px 1fr 360px; height: calc(100vh - 49px); }
  aside { background: #fcfcfb; overflow: auto; }
  .left { border-right: 1px solid #e4e2dd; }
  .right { border-left: 1px solid #e4e2dd; display: flex; flex-direction: column; }
  .center { min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .bench, .code { min-height: 0; }
  .splitter { flex: 0 0 6px; cursor: row-resize; background: #ece9e2; touch-action: none; }
  .splitter:hover { background: #f5a524; }
  .code-toggle { position: absolute; right: 12px; top: 10px; z-index: 2; font-size: 12px; box-shadow: 0 1px 3px #0002; }
  .primary { background: #f76b15; color: #fff; border-color: #f76b15; min-width: 110px; font-weight: 600; }
  .primary:disabled { opacity: 0.75; cursor: progress; }
  @media (max-width: 1100px) {
    main { grid-template-columns: 1fr; grid-template-rows: auto 62vh auto; height: auto; }
    .left { border-right: none; border-bottom: 1px solid #e4e2dd; }
    .left :global(section) { display: flex; gap: 8px; overflow-x: auto; align-items: center; }
    .left :global(h2), .left :global(.hint), .left :global(.keys), .left :global(.static) { display: none; }
    .left :global(.item) { flex: 0 0 auto; margin: 0; }
    .right { border-left: none; }
  }
</style>
