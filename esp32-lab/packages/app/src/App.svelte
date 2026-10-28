<script lang="ts">
  import Inspector from './components/Inspector.svelte';
  import LessonPanel from './components/LessonPanel.svelte';
  import Library from './components/Library.svelte';
  import SerialMonitor from './components/SerialMonitor.svelte';
  import Workbench from './components/Workbench.svelte';
  import { lab } from './lib/lab.svelte';

  let dragType = $state<string | null>(null);
  const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  let damaged = $derived(lab.diagnostics.filter((d) => d.severity === 'error'));
</script>

<svelte:window onpointerup={() => setTimeout(() => (dragType = null))} />

<header>
  <h1>ESP32 Lab</h1>
  <label>Firmware
    <select value={lab.env ?? ''} onchange={(e) => lab.loadFirmware(e.currentTarget.value || null)}>
      <option value="">— không nạp —</option>
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
  <div class="center"><Workbench bind:dragType /></div>
  <aside class="right">
    <Inspector />
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
  .center { min-width: 0; min-height: 0; }
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
