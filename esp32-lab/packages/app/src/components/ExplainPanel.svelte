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
  h2 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 0 0 8px; }
  .empty { font-size: 12px; color: var(--ink-3); margin: 0; line-height: 1.5; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  /* Notes as probe readings: a coloured lead on the left says what kind */
  li { display: flex; gap: 8px; font-size: 13px; line-height: 1.45; padding: 6px 8px; border-radius: 0; background: var(--surface); cursor: pointer; border: 1px solid var(--line-soft); box-shadow: inset 3px 0 0 var(--line-strong); }
  li.pinned { border-color: var(--accent-hi); background-color: var(--accent-soft); }
  li.info { box-shadow: inset 3px 0 0 var(--info); }
  li.error { background-color: var(--error-soft); color: var(--error); box-shadow: inset 3px 0 0 var(--error); }
  li.warn { background-color: var(--warn-soft); color: var(--warn); box-shadow: inset 3px 0 0 var(--warn-dot); }
  li.ok { background-color: var(--ok-soft); color: #14532d; font-weight: 500; box-shadow: inset 3px 0 0 var(--ok-dot); }
  .icon { flex: 0 0 auto; }
</style>
