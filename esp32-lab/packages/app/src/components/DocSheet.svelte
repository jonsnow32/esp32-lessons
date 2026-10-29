<script lang="ts">
  // The frame of every detail page (part, board, breadboard): a sheet over the app with a top
  // bar to go back or step through the pages of the same kind, and the styles the pages share
  // (hero, spec table, rating meters, figures, schematic drawings).
  import type { Snippet } from 'svelte';
  import { lab } from '../lib/lab.svelte';

  let {
    title,
    kind,
    siblings,
    children,
  }: {
    title: string;
    /** What the crumb calls this kind of page, e.g. "Linh kiện". */
    kind: string;
    /** Pages of the same kind, in order, for the previous / next buttons. */
    siblings: { page: string; name: string }[];
    children: Snippet;
  } = $props();

  let at = $derived(siblings.findIndex((s) => s.page === lab.docPage));
  let prev = $derived(siblings[(at - 1 + siblings.length) % siblings.length]!);
  let next = $derived(siblings[(at + 1) % siblings.length]!);

  const close = () => (lab.docPage = null);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
  <header>
    <button class="back" onclick={close}>← Quay lại</button>
    <span class="crumb">{kind} / <b>{title}</b></span>
    <span class="spacer"></span>
    {#if siblings.length > 1}
      <button title={prev.name} onclick={() => (lab.docPage = prev.page)}>‹ Trước</button>
      <button title={next.name} onclick={() => (lab.docPage = next.page)}>Sau ›</button>
    {/if}
  </header>
  <main>{@render children()}</main>
</div>

<style>
  .sheet { position: fixed; inset: 0; z-index: 50; background: var(--bg); overflow: auto; }
  header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 8px 14px; min-height: 49px; box-sizing: border-box; background: var(--bezel); color: var(--ink-inv); border-bottom: 1px solid #000; color-scheme: dark; }
  header button { background-color: var(--bezel-2); color: var(--ink-inv); border-color: var(--bezel-line); }
  header button:hover { background-color: #2f353c; }
  .back { font-weight: 600; }
  .crumb { font: 12px var(--font-mono); color: var(--ink-inv-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crumb b { color: var(--ink-inv); font-weight: 600; }
  .spacer { flex: 1; }
  main { max-width: 1080px; margin: 0 auto; padding: 24px 24px 60px; display: flex; flex-direction: column; gap: 14px; }

  .sheet :global {
    section { background: var(--surface); border: 1px solid var(--line); padding: 14px 16px; min-width: 0; }
    h2 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 0 0 12px; padding-bottom: 7px; border-bottom: 1px solid var(--line-soft); display: flex; gap: 8px; align-items: baseline; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    /* Hero: the part on a grid sheet, at rest and at work, beside its introduction */
    .hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 0; padding: 0; border-left: 4px solid var(--accent); }
    .stage { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 22px; min-height: 300px; background-color: var(--bg); background-image: linear-gradient(#0000000c 1px, transparent 1px), linear-gradient(90deg, #0000000c 1px, transparent 1px); background-size: 16px 16px; border-right: 1px solid var(--line); }
    figure { margin: 0; flex: 1; max-width: 300px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    figure svg { width: 100%; height: 240px; filter: drop-shadow(0 3px 4px #0000002a); }
    figcaption { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); background: var(--surface); border: 1px solid var(--line); padding: 2px 8px; }
    figure.on figcaption { color: var(--ok); border-color: #b9dcc8; background: var(--ok-soft); }
    .arrow { font: 20px var(--font-mono); color: var(--ink-4); }
    .intro { padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; }
    .cat { align-self: flex-start; font: 600 11px var(--font-mono); color: var(--accent); background: var(--accent-soft); border: 1px solid #f1c7a6; padding: 1px 8px; letter-spacing: .04em; }
    h1 { font-size: 24px; line-height: 1.25; margin: 0; letter-spacing: -.01em; }
    .intro p { margin: 0; color: var(--ink-2); line-height: 1.6; font-size: 14px; }
    /* Specs: a datasheet table */
    .specs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0; margin: 0; border-top: 1px solid var(--line-soft); border-left: 1px solid var(--line-soft); }
    .specs div { padding: 8px 10px; border-right: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); }
    .specs dt { font: 10.5px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
    .specs dd { margin: 3px 0 0; font: 600 14px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink); }
    /* Pinout */
    .note { font-size: 12.5px; color: var(--ink-3); margin: 10px 0 0; line-height: 1.5; }
    /* Limits: a meter scale with working, overstressed and burnt zones */
    .limit { margin-bottom: 16px; }
    .limit-head { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 5px; gap: 8px; }
    .limit-head b { font: 600 12px var(--font-mono); }
    .meter { display: flex; height: 12px; border: 1px solid var(--line-strong); }
    .meter span { display: block; height: 100%; }
    .ok, i.ok { background: repeating-linear-gradient(90deg, var(--ok-dot) 0 6px, #30a46cb0 6px 8px); }
    .over, i.over { background: repeating-linear-gradient(135deg, var(--warn-dot) 0 4px, #f5a52490 4px 8px); }
    .burn, i.burn { background: var(--error); }
    .scale { position: relative; height: 16px; font: 10px var(--font-mono); color: var(--ink-3); }
    .scale span { position: absolute; top: 2px; transform: translateX(-50%); white-space: nowrap; }
    .scale span:first-child { transform: none; }
    .key { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11.5px; color: var(--ink-3); }
    .key span { display: inline-flex; align-items: center; gap: 5px; }
    .key i { width: 16px; height: 9px; display: inline-block; }
    /* Figures */
    .figs { display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: dense; gap: 14px; }
    .fig.wide { grid-column: 1 / -1; }
    .fig-n { color: var(--accent); }
    .drawing { width: 100%; height: auto; display: block; background: var(--surface); border: 1px solid var(--line-soft); }
    .caption { font-size: 13px; color: var(--ink-2); line-height: 1.55; margin: 10px 0 0; }
    /* Schematic classes used by the parts' drawings (part-sdk schematic.ts) */
    .drawing .sch-w { fill: none; stroke: var(--ink-2); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .drawing .sch-w.sch-s { stroke: var(--signal); }
    .drawing .sch-w.sch-a { stroke: var(--accent-hi); stroke-width: 1.3; }
    .drawing .sch-a-fill { fill: var(--accent-hi); }
    .drawing .sch-b { fill: var(--surface); stroke: var(--ink-2); stroke-width: 1.6; }
    .drawing .sch-b-ink { fill: var(--ink-2); }
    .drawing .sch-chip { fill: var(--bezel); stroke: var(--bezel); }
    .drawing .sch-dot { fill: var(--ink-2); }
    .drawing .sch-t { font: 11px var(--font-mono); fill: var(--ink); }
    .drawing .sch-t.sch-m { fill: var(--ink-3); }
    .drawing .sch-t.sch-a { fill: var(--accent); font-weight: 600; }
    .drawing .sch-t.sch-s { fill: var(--signal); font-weight: 600; }
    .drawing .sch-t.sch-strong { font-weight: 700; }
    .drawing .sch-t.sch-chip-t { fill: var(--ink-inv); font-weight: 600; }
    .drawing .sch-t.sch-ui { font-family: var(--font-ui); }
    .drawing .sch-lead { fill: none; stroke: var(--ink-4); stroke-width: 1; }
    .drawing .sch-lead-dot { fill: var(--ink-3); }
    .drawing .sch-head { fill: var(--signal); }
    .drawing .sch-head.sch-a { fill: var(--accent-hi); }
    .drawing .sch-flow { stroke-width: 2; stroke-dasharray: 5 4; }
    .drawing .sch-metal { fill: #c3c8ce; stroke: #6f767e; stroke-width: 1.2; }
    .drawing .sch-plastic { fill: #2a2d31; stroke: #111; stroke-width: 1.2; }
    .drawing .sch-zone { fill: var(--signal-soft); stroke: var(--signal); stroke-width: 1; stroke-dasharray: 3 3; }
    .steps, .tips { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; line-height: 1.55; counter-reset: step; }
    .steps li { counter-increment: step; display: flex; gap: 10px; }
    .steps li::before { content: counter(step); flex: 0 0 22px; height: 22px; background: var(--accent); color: #fff; font: 700 11.5px var(--font-mono); display: inline-flex; align-items: center; justify-content: center; }
    .tips li { padding-left: 12px; box-shadow: inset 3px 0 0 var(--info); }
    .uses { display: flex; flex-wrap: wrap; gap: 8px; }
    .uses button { display: inline-flex; gap: 8px; align-items: center; font-weight: 600; }
    .uses button span { font: 10.5px var(--font-mono); color: var(--ink-3); font-weight: 400; }

    @media (max-width: 860px) {
      .hero, .two, .figs { grid-template-columns: 1fr; }
      .stage { border-right: none; border-bottom: 1px solid var(--line); }
    }
  }
</style>
