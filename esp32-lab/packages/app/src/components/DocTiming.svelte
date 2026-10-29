<script lang="ts">
  // A timing diagram from a part's detail page: one digital trace per signal, like a logic
  // analyser, with labelled brackets for the durations that matter.
  import type { TimingSignal, TimingSpan } from '@esp32lab/part-sdk';

  let { end, signals, spans = [] }: { end: number; signals: TimingSignal[]; spans?: TimingSpan[] } = $props();

  const W = 760;
  const NAME = 112;
  const TRACE = 26;
  const ROW = 40;
  const SPAN = 22;

  /** Top of each row: rows with brackets under them are taller. */
  let tops = $derived.by(() => {
    let y = 8;
    return signals.map((_, i) => {
      const top = y;
      y += ROW + (spans.some((s) => s.row === i) ? SPAN : 0);
      return top;
    });
  });
  let height = $derived(tops.length ? tops[tops.length - 1]! + ROW + (spans.some((s) => s.row === signals.length - 1) ? SPAN : 0) : 0);
  let sx = $derived((t: number) => NAME + 6 + (t / end) * (W - NAME - 14));

  function trace(s: TimingSignal, top: number): { line: string; fill: string } {
    const hi = top + 4;
    const lo = top + 4 + TRACE;
    const steps = [...s.steps, [end, s.steps[s.steps.length - 1]?.[1] ?? 0] as [number, 0 | 1]];
    let line = '';
    let fill = '';
    for (let i = 0; i < steps.length - 1; i++) {
      const [t, level] = steps[i]!;
      const [t2] = steps[i + 1]!;
      const y = level ? hi : lo;
      line += `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${y} L${sx(t2).toFixed(1)},${y} `;
      if (level) fill += `M${sx(t).toFixed(1)},${lo} V${hi} H${sx(t2).toFixed(1)} V${lo} Z `;
    }
    return { line, fill };
  }
</script>

<svg viewBox="0 0 {W} {height}" class="timing">
  {#each signals as s, i}
    {@const top = tops[i]!}
    {@const t = trace(s, top)}
    <text class="name" x={NAME} y={top + 4 + TRACE / 2 + 4} text-anchor="end">{s.name}</text>
    <line class="base" x1={NAME + 6} x2={W - 8} y1={top + 4 + TRACE} y2={top + 4 + TRACE} />
    <path d={t.fill} class="high" style="fill: {s.color ?? 'var(--signal)'}" />
    <path d={t.line} class="trace" style="stroke: {s.color ?? 'var(--signal)'}" />
    {#each spans.filter((sp) => sp.row === i) as sp}
      {@const y = top + ROW + 4}
      <path class="bracket" d="M{sx(sp.from)},{y - 5} V{y} H{sx(sp.to)} V{y - 5}" />
      <text class="span" x={(sx(sp.from) + sx(sp.to)) / 2} y={y + 13} text-anchor="middle">{sp.label}</text>
    {/each}
  {/each}
</svg>

<style>
  .timing { width: 100%; height: auto; display: block; background: var(--surface); border: 1px solid var(--line-strong); }
  .name { font: 600 11px var(--font-mono); fill: var(--ink-2); }
  .base { stroke: var(--line-soft); stroke-dasharray: 2 3; }
  .trace { fill: none; stroke-width: 2; stroke-linejoin: miter; }
  .high { opacity: .1; }
  .bracket { fill: none; stroke: var(--accent); stroke-width: 1.2; }
  .span { font: 600 10.5px var(--font-mono); fill: var(--accent); }
</style>
