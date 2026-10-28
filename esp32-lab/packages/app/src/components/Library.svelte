<script lang="ts">
  // Parts to drag onto the breadboard. Everything listed comes from the component catalog.
  import { PARTS } from '../lib/catalog';
  import { LESSONS } from '../lib/catalog';
  import { lab } from '../lib/lab.svelte';

  let { dragType = $bindable<string | null>(null) } = $props();

  let lesson = $derived(LESSONS.find((l) => l.id === lab.lessonId));
  /** Part types the current lesson's checks ask for get a "this lesson" badge. */
  let wanted = $derived(new Set(JSON.stringify(lesson ?? {}).match(/"type":"(\w+)"/g)?.map((m) => m.slice(8, -1)) ?? []));

  function preview(type: string): string {
    const m = PARTS[type]!;
    const props: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(m.manifest.props)) props[k] = s.default;
    return m.view?.(props as never, {}) ?? '';
  }
</script>

<section>
  <h2>Linh kiện</h2>
  <p class="hint">Kéo thả vào breadboard. Kéo từ một lỗ tới lỗ khác để nối dây. Hai ngón tay: phóng to, di chuyển.</p>
  {#each Object.entries(PARTS) as [type, m] (type)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="item" onpointerdown={(e) => { e.preventDefault(); dragType = type; }}>
      <svg viewBox={m.icon ?? '-1 -3 6 6.5'} width="44" height="44">{@html preview(type)}</svg>
      <div>
        <div class="name">{m.manifest.name}</div>
        <div class="meta">{m.manifest.category}{#if wanted.has(type)} · <span class="badge">Bài này</span>{/if}</div>
      </div>
    </div>
  {/each}
  <h2>Board</h2>
  <div class="item static"><div class="name">ESP32 DevKit V1 (30 chân)</div></div>
  <h2>Breadboard</h2>
  <div class="item static"><div class="name">Half+ 400 lỗ</div></div>
  <div class="keys">
    <b>Thao tác</b><br />R: xoay · Del: xoá · Esc: huỷ · +/− / 0: zoom<br />Ctrl+Z: hoàn tác · Ctrl+Y: làm lại<br />Kéo linh kiện ra ngoài breadboard: dây tự nối từ lỗ cũ tới chân; kéo từ chân để nối dây<br />Kéo chỗ trống: di chuyển bàn<br />Rê chuột hoặc chạm vào lỗ: xem các điểm cùng mạch
  </div>
</section>

<style>
  section { padding: 12px; overflow: auto; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6f6e77; margin: 14px 0 6px; }
  .hint, .keys { font-size: 12px; color: #6f6e77; }
  .keys { margin-top: 18px; line-height: 1.6; }
  .item { touch-action: none; -webkit-user-select: none; user-select: none; display: flex; gap: 10px; align-items: center; padding: 6px 8px; border: 1px solid #e4e2dd; border-radius: 8px; margin-bottom: 6px; background: #fff; cursor: grab; }
  .item.static { cursor: default; color: #555; }
  .name { font-size: 13px; font-weight: 600; }
  .meta { font-size: 11px; color: #8b8d98; }
  .badge { color: #f76b15; font-weight: 600; }
</style>
