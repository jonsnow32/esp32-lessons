<script lang="ts">
  // "Mạch đang làm gì": live notes from the explanation engine. Hovering (or tapping) a note
  // highlights the parts and connections it talks about.
  import { lab } from '../lib/lab.svelte';

  const ICON = { error: '⛔', warn: '⚠️', ok: '⚡', info: 'ℹ️' } as const;
  let pinned = $state<number | null>(null);

  function show(i: number | null) {
    lab.emphasis = i === null ? [] : (lab.notes[i]?.highlight ?? []);
  }
</script>

<section>
  <h2>Mạch đang làm gì</h2>
  {#if lab.notes.length === 0}
    <p class="empty">Cắm linh kiện và nối dây, rồi bấm ▶ Chạy: phần này sẽ giải thích dòng điện đang đi đâu và vì sao.</p>
  {:else}
    <ul>
      {#each lab.notes as n, i (i + n.text)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li class="{n.level} trace" class:pinned={pinned === i}
          onpointerenter={() => pinned === null && show(i)}
          onpointerleave={() => pinned === null && show(null)}
          onclick={() => { pinned = pinned === i ? null : i; show(pinned); }}
          onkeydown={(e) => e.key === 'Enter' && (pinned = pinned === i ? null : i, show(pinned))}>
          <span class="icon">{ICON[n.level]}</span><span>{n.text}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section { padding: 10px 12px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6f6e77; margin: 0 0 6px; }
  .empty { font-size: 12px; color: #8b8d98; margin: 0; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; gap: 8px; font-size: 13px; line-height: 1.45; padding: 6px 8px; border-radius: 0; background: #f4f4f2; cursor: pointer; border: 1px solid transparent; }
  li.pinned { border-color: #f5a524; }
  li.error { background: #fff0f0; color: #a3161b; }
  li.warn { background: #fff7ed; color: #8a3d00; }
  li.ok { background: #eefaf3; color: #14532d; font-weight: 500; }
  .icon { flex: 0 0 auto; }
</style>
