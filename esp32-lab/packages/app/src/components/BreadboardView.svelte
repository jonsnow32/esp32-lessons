<script lang="ts">
  // A breadboard drawn from its definition: body, centre channel, rails with +/− markings,
  // row letters, column numbers and holes. Highlighting comes from the hovered net.
  import type { ExpandedBreadboard } from '@esp32lab/project-model';
  import { keyOf } from '@esp32lab/sim-core';

  let {
    id,
    bb,
    net,
    here,
    fillFor = () => null,
  }: {
    id: string;
    bb: ExpandedBreadboard;
    net: Set<string>;
    here: string | null;
    /** Overlay colour for a hole (voltage view), or null for the normal look. */
    fillFor?: (key: string) => string | null;
  } = $props();

  let cols = $derived(bb.def.columns);
  let top = $derived(Math.min(...bb.def.rails.map((r) => r.y), 0) - 1.2);
  let bottom = $derived(Math.max(...bb.def.rails.map((r) => r.y), ...bb.def.blocks.map((b) => b.y0 + b.rows.length - 1)) + 1.2);
  /** Rails come in +/− pairs; each one's coloured line sits on the side away from its partner. */
  function railSide(rail: ExpandedBreadboard['def']['rails'][number]): number {
    const partner = bb.def.rails
      .filter((r) => r !== rail)
      .reduce((best, r) => (Math.abs(r.y - rail.y) < Math.abs(best.y - rail.y) ? r : best));
    return rail.y > partner.y ? 1 : -1;
  }

  let gap = $derived.by(() => {
    const [a, b] = bb.def.blocks;
    return a && b ? { y: a.y0 + a.rows.length - 0.5, h: b.y0 - (a.y0 + a.rows.length) + 1 } : null;
  });
</script>

<rect x="-1.6" y={top} width={cols + 2.2} height={bottom - top} rx="0.6" fill="url(#bb-body)" stroke="#d3cdbf" stroke-width="0.08" />
{#if gap}
  <rect x="-1.6" y={gap.y} width={cols + 2.2} height={gap.h} fill="#e3ddcf" />
  <rect x="-1.6" y={gap.y + gap.h / 2 - 0.05} width={cols + 2.2} height="0.1" fill="#d3ccbc" />
{/if}

{#each bb.def.rails as rail}
  {@const lineY = rail.y + 0.55 * railSide(rail)}
  <line x1="1" x2={cols - 2} y1={lineY} y2={lineY} stroke={rail.polarity === '+' ? '#e5484d' : '#3e63dd'} stroke-width="0.09" />
  <text x="-0.9" y={rail.y + 0.22} font-size="0.62" font-weight="700" fill={rail.polarity === '+' ? '#e5484d' : '#3e63dd'}>{rail.polarity === '+' ? '+' : '−'}</text>
  <text x={cols - 0.1} y={rail.y + 0.22} font-size="0.62" font-weight="700" fill={rail.polarity === '+' ? '#e5484d' : '#3e63dd'}>{rail.polarity === '+' ? '+' : '−'}</text>
{/each}

{#each bb.def.blocks as block}
  {#each block.rows as row, i}
    <text x="-1.05" y={block.y0 + i + 0.17} font-size="0.42" fill="#a39e93" text-anchor="middle">{row}</text>
    <text x={cols + 0.05} y={block.y0 + i + 0.17} font-size="0.42" fill="#a39e93" text-anchor="middle">{row}</text>
  {/each}
{/each}
{#each Array.from({ length: cols }, (_, c) => c + 1).filter((c) => c === 1 || c % 5 === 0) as c}
  <text x={c - 1} y={(bb.def.blocks[0]?.y0 ?? 0) - 0.6} font-size="0.4" fill="#a39e93" text-anchor="middle">{c}</text>
  <text x={c - 1} y={(bb.def.blocks.at(-1)?.y0 ?? 0) + (bb.def.blocks.at(-1)?.rows.length ?? 0) + 0.15} font-size="0.4" fill="#a39e93" text-anchor="middle">{c}</text>
{/each}

{#each [...bb.holes.values()] as h (h.name)}
  {@const key = keyOf.hole(id, h.name)}
  <rect x={h.x - 0.21} y={h.y - 0.21} width="0.42" height="0.42" rx="0.07"
    fill={here === h.name ? '#f76b15' : net.has(key) ? '#12a594' : (fillFor(key) ?? 'url(#bb-hole)')} />
{/each}
