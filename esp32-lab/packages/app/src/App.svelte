<script lang="ts">
  import CodePanel from './components/CodePanel.svelte';
  import ExplainPanel from './components/ExplainPanel.svelte';
  import Inspector from './components/Inspector.svelte';
  import LessonPanel from './components/LessonPanel.svelte';
  import Library from './components/Library.svelte';
  import SerialMonitor from './components/SerialMonitor.svelte';
  import Workbench from './components/Workbench.svelte';
  import { lab } from './lib/lab.svelte';

  let dragType = $state<string | null>(null);
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
  const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  let damaged = $derived(lab.diagnostics.filter((d) => d.severity === 'error'));
</script>

<svelte:window onpointerup={() => setTimeout(() => (dragType = null))} />

<header>
  <h1>ESP32 Lab</h1>
  <label>Firmware
    <select value={lab.env ?? ''} onchange={(e) => (e.currentTarget.value === 'sketch' ? lab.buildAndRun() : lab.loadFirmware(e.currentTarget.value || null))}>
      <option value="">— không nạp —</option>
      {#if lab.env === 'sketch'}<option value="sketch">Code của bạn (main.cpp)</option>{/if}
      {#each lab.envs as env}<option value={env}>.pio/build/{env}</option>{/each}
    </select>
  </label>
  {#if lab.running}
    <button onclick={() => lab.pause()}>⏸ Tạm dừng</button>
  {:else}
    <button class="primary" onclick={() => lab.run()}>▶ Chạy</button>
  {/if}
  <button onclick={() => lab.reset()} title="Như nhấn nút EN">↺ Reset</button>
  <label>Tốc độ
    <select value={String(lab.speed)} onchange={(e) => lab.setSpeed(Number(e.currentTarget.value))}>
      {#each SPEEDS as s}<option value={String(s)}>{s}×</option>{/each}
    </select>
  </label>
  <span class="clock">t = {(lab.t / 1e9).toFixed(3)} s{#if lab.running} · {lab.rate.toFixed(2)}× thời gian thực{/if}</span>
  <span class="spacer"></span>
  <button onclick={() => lab.clear()}>Xoá bàn</button>
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
    {/if}
    <button class="code-toggle" onclick={() => (codeShare = codeShare > 0 ? 0 : 0.4)}>{codeShare > 0 ? '▾ Ẩn code' : '▴ Code'}</button>
  </div>
  <aside class="right">
    <Inspector />
    <ExplainPanel />
    <LessonPanel />
    <SerialMonitor />
  </aside>
</main>

<style>
  header { display: flex; gap: 12px; align-items: center; padding: 8px 14px; border-bottom: 1px solid #e4e2dd; background: #fff; }
  h1 { font-size: 16px; margin: 0 8px 0 0; }
  label { font-size: 13px; display: flex; gap: 6px; align-items: center; }
  .clock { font: 12px ui-monospace, monospace; color: #6f6e77; }
  .spacer { flex: 1; }
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
  .primary { background: #f76b15; color: #fff; border-color: #f76b15; }
  header { flex-wrap: wrap; }
  /* Tablets and phones: workbench on top, panels below, parts library as a strip */
  @media (max-width: 1100px) {
    main { grid-template-columns: 1fr; grid-template-rows: auto 62vh auto; height: auto; }
    .left { border-right: none; border-bottom: 1px solid #e4e2dd; }
    .left :global(section) { display: flex; gap: 8px; overflow-x: auto; align-items: center; }
    .left :global(h2), .left :global(.hint), .left :global(.keys), .left :global(.static) { display: none; }
    .left :global(.item) { flex: 0 0 auto; margin: 0; }
    .right { border-left: none; }
  }
</style>
