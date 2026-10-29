<script lang="ts">
  // A small, still picture of a project's bench (board, breadboard, parts, wires) for its card.
  // Parts are drawn switched on, so the picture shows what the project does.
  import type { Project } from '@esp32lab/project-model';
  import { PARTS } from '../lib/catalog';
  import { benchBounds, board, breadboard, endpointPos, partAnchor, wirePath } from '../lib/geometry';
  import { SCENE_DEFS } from '../lib/scene';
  import BoardView from './BoardView.svelte';
  import BreadboardView from './BreadboardView.svelte';

  let { project }: { project: Project } = $props();

  const SHOWCASE = { brightness: 0.8, red: 0.9, green: 0.6, blue: 0, loudness: 0.8 };
  const none = new Set<string>();
  const noop = () => {};

  let b = $derived(board(project));
  /** Frame around the board and the breadboards. */
  let box = $derived.by(() => {
    const k = benchBounds(project);
    return `${k.x} ${k.y} ${k.w} ${k.h}`;
  });

  function view(type: string, props: Record<string, unknown> = {}): string {
    const m = PARTS[type];
    if (!m?.view) return '';
    const full: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(m.manifest.props)) full[k] = props[k] ?? s.default;
    return m.view(full as never, SHOWCASE);
  }
</script>

<svg viewBox={box} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>{@html SCENE_DEFS}</defs>
  <g transform="translate({project.board.x},{project.board.y})">
    <BoardView board={b} net={none} observables={{}} pinFill={() => 'url(#gold)'} pinHint={() => ''} onpress={noop} onrelease={noop} />
  </g>
  {#each project.breadboards as inst (inst.id)}
    {@const bb = breadboard(inst.type)}
    {#if bb}<g transform="translate({inst.x},{inst.y})"><BreadboardView id={inst.id} {bb} net={none} here={null} /></g>{/if}
  {/each}
  {#each project.parts as part (part.id)}
    {@const anchor = partAnchor(project, part)}
    {#if anchor}<g transform="translate({anchor.at.x},{anchor.at.y}) rotate({anchor.rot})">{@html view(part.type, part.props)}</g>{/if}
  {/each}
  {#each project.wires as w (w.id)}
    {@const a = endpointPos(project, w.a)}
    {@const z = endpointPos(project, w.b)}
    {#if a && z}<path d={wirePath(a, z, w.points, w.free)} stroke={w.color ?? '#3e63dd'} stroke-width="0.32" fill="none" stroke-linecap="round" />{/if}
  {/each}
</svg>

<style>
  svg { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
