<script lang="ts">
  // A characteristic curve from a part's detail page: lines over a grid, linear or log axes,
  // with marked points and limit lines.
  import type { ChartAxis, ChartMark, ChartSeries } from '@esp32lab/part-sdk';

  let { x, y, series, marks = [] }: { x: ChartAxis; y: ChartAxis; series: ChartSeries[]; marks?: ChartMark[] } = $props();

  const W = 520;
  const H = 250;
  const M = { l: 54, r: 18, t: 14, b: 40 };

  function scale(a: ChartAxis, from: number, to: number) {
    if (a.log) {
      const [l0, l1] = [Math.log10(a.min), Math.log10(a.max)];
      return (v: number) => from + ((Math.log10(Math.max(v, a.min * 1e-3)) - l0) / (l1 - l0)) * (to - from);
    }
    return (v: number) => from + ((v - a.min) / (a.max - a.min)) * (to - from);
  }

  /** Ticks: the axis's own, the decades of a log axis, or 4–6 round steps. */
  function ticks(a: ChartAxis): number[] {
    if (a.ticks) return a.ticks;
    if (a.log) {
      const out = [];
      for (let e = Math.ceil(Math.log10(a.min)); e <= Math.floor(Math.log10(a.max)); e++) out.push(10 ** e);
      return out;
    }
    const raw = (a.max - a.min) / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
    const out = [];
    for (let v = Math.ceil(a.min / step) * step; v <= a.max + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }

  /** 1500 → 1,5k; 1e6 → 1M; small values with a Vietnamese decimal comma. */
  function compact(v: number): string {
    const a = Math.abs(v);
    const n = (x: number) => String(+x.toPrecision(3)).replace('.', ',');
    if (a >= 1e6) return `${n(v / 1e6)}M`;
    if (a >= 1e3) return `${n(v / 1e3)}k`;
    return n(v);
  }

  let sx = $derived(scale(x, M.l, W - M.r));
  let sy = $derived(scale(y, H - M.b, M.t));
  let fx = $derived(x.format ?? compact);
  let fy = $derived(y.format ?? compact);
  const PALETTE = ['var(--accent-hi)', 'var(--signal)', 'var(--info)', '#8e4ec6'];
  const TONE = { accent: 'var(--accent)', error: 'var(--error)', signal: 'var(--signal)' };

  const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${sx(a).toFixed(1)},${sy(b).toFixed(1)}`).join('');
  let shown = $derived(series.map((s, i) => ({ s, color: s.muted ? 'var(--line-strong)' : (s.color ?? PALETTE[i % PALETTE.length]) })));
  let legend = $derived(shown.filter((e) => e.s.label));
  const uid = `clip-${Math.random().toString(36).slice(2)}`;
</script>

<svg viewBox="0 0 {W} {H}" class="chart">
  <defs><clipPath id={uid}><rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} /></clipPath></defs>
  <rect class="plot" x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
  {#each ticks(x) as t}
    <line class="grid" x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} />
    <text class="tick" x={sx(t)} y={H - M.b + 14} text-anchor="middle">{fx(t)}</text>
  {/each}
  {#each ticks(y) as t}
    <line class="grid" x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} />
    <text class="tick" x={M.l - 6} y={sy(t) + 3.5} text-anchor="end">{fy(t)}</text>
  {/each}
  <text class="axis" x={(M.l + W - M.r) / 2} y={H - 6} text-anchor="middle">{x.label}</text>
  <text class="axis" transform="translate(13 {(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">{y.label}</text>
  <g clip-path="url(#{uid})">
    {#each shown.filter((e) => e.s.muted) as { s, color }}<path d={path(s.points)} stroke={color} class="line muted" />{/each}
    {#each shown.filter((e) => !e.s.muted) as { s, color }}<path d={path(s.points)} stroke={color} class="line" />{/each}
    {#each marks as m}
      {@const c = TONE[m.tone ?? 'accent']}
      {#if m.x !== undefined && m.y !== undefined}
        <line class="guide" x1={sx(m.x)} x2={sx(m.x)} y1={sy(m.y)} y2={H - M.b} stroke={c} />
        <line class="guide" x1={M.l} x2={sx(m.x)} y1={sy(m.y)} y2={sy(m.y)} stroke={c} />
        <circle cx={sx(m.x)} cy={sy(m.y)} r="4.5" fill={c} stroke="#fff" stroke-width="1.5" />
        <text class="mark" x={sx(m.x) + (sx(m.x) > W - 150 ? -8 : 8)} y={sy(m.y) - 8} fill={c} text-anchor={sx(m.x) > W - 150 ? 'end' : 'start'}>{m.label}</text>
      {:else if m.y !== undefined}
        <line class="limit" x1={M.l} x2={W - M.r} y1={sy(m.y)} y2={sy(m.y)} stroke={c} />
        <text class="mark" x={W - M.r - 4} y={sy(m.y) - 5} fill={c} text-anchor="end">{m.label}</text>
      {:else if m.x !== undefined}
        <line class="limit" x1={sx(m.x)} x2={sx(m.x)} y1={M.t} y2={H - M.b} stroke={c} />
        <text class="mark" x={sx(m.x) + 5} y={M.t + 12} fill={c}>{m.label}</text>
      {/if}
    {/each}
  </g>
</svg>
{#if legend.length > 1}
  <div class="legend">
    {#each legend as { s, color }}<span class:muted={s.muted}><i style="background: {color}"></i>{s.label}</span>{/each}
  </div>
{/if}

<style>
  .chart { width: 100%; height: auto; display: block; }
  .plot { fill: var(--surface); stroke: var(--line-strong); }
  .grid { stroke: var(--line-soft); }
  .tick { font: 10px var(--font-mono); fill: var(--ink-3); font-variant-numeric: tabular-nums; }
  .axis { font: 600 10.5px var(--font-mono); fill: var(--ink-2); letter-spacing: .02em; }
  .line { fill: none; stroke-width: 2.4; stroke-linejoin: round; }
  .line.muted { stroke-width: 1.3; }
  .guide { stroke-width: 1; stroke-dasharray: 2 3; opacity: .7; }
  .limit { stroke-width: 1.3; stroke-dasharray: 6 4; }
  .mark { font: 600 11px var(--font-mono); paint-order: stroke; stroke: var(--surface); stroke-width: 3px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font: 11px var(--font-mono); color: var(--ink-2); margin-top: 4px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend span.muted { color: var(--ink-4); }
  .legend i { width: 14px; height: 3px; display: inline-block; }
</style>
