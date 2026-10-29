<script lang="ts">
  // Parts and breadboards to drag onto the bench, and the board to build on. Everything listed
  // comes from the component catalog.
  import { BOARDS, BREADBOARDS, LESSONS, PARTS } from '../lib/catalog';
  import { breadboard } from '../lib/geometry';
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
    <div class="item trace" onpointerdown={(e) => { e.preventDefault(); dragType = type; }}>
      <svg viewBox={m.icon ?? '-1 -3 6 6.5'} width="44" height="44">{@html preview(type)}</svg>
      <div>
        <div class="name">{m.manifest.name}</div>
        <div class="meta">{m.manifest.category}{#if wanted.has(type)} · <span class="badge">Bài này</span>{/if}</div>
      </div>
      <button class="info" title="Trang chi tiết: sơ đồ chân, đặc tuyến, cách nối" onpointerdown={(e) => e.stopPropagation()} onclick={() => (lab.docPage = type)}>i</button>
    </div>
  {/each}
  <h2>Board</h2>
  {#if lesson}<p class="hint">Bài học dùng board của bài; đổi board trong Sân chơi hoặc dự án của bạn.</p>{/if}
  {#each Object.entries(BOARDS) as [type, def] (type)}
    <div class="board-row">
      <button class="item board" class:current={lab.project.board.type === type} disabled={!!lesson && lab.project.board.type !== type}
        onclick={() => lab.setBoard(type)}>
        <div>
          <div class="name">{def.name.replace(/ \(.*/, '')}</div>
          <div class="meta">{def.pins.length} chân · {def.look?.module ?? 'ESP32-WROOM-32'}{#if lab.project.board.type === type} · <span class="badge">Đang dùng</span>{/if}</div>
        </div>
      </button>
      <button class="info" title="Trang chi tiết: sơ đồ chân, nguồn, mạch trên board" onclick={() => (lab.docPage = `board:${type}`)}>i</button>
    </div>
  {/each}
  <h2>Breadboard</h2>
  <p class="hint">Kéo thả vào bàn để thêm. Chạm breadboard để chọn rồi kéo để di chuyển, Del để xoá.</p>
  {#each Object.entries(BREADBOARDS) as [type, def] (type)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="item trace" onpointerdown={(e) => { e.preventDefault(); dragType = `bb:${type}`; }}>
      <div>
        <div class="name">{def.name}</div>
        <div class="meta">{def.columns} cột{def.rails.length ? ` · ${def.rails.length} thanh nguồn` : ' · không có thanh nguồn'} · {breadboard(type)?.holes.size} lỗ</div>
      </div>
      <button class="info" title="Trang chi tiết: lỗ nào nối với lỗ nào" onpointerdown={(e) => e.stopPropagation()} onclick={() => (lab.docPage = `bb:${type}`)}>i</button>
    </div>
  {/each}
  <div class="keys">
    <b>Thao tác</b><br />R: xoay · Del: xoá · Esc: huỷ · +/− / 0: zoom<br />Ctrl+Z: hoàn tác · Ctrl+Y: làm lại<br />Kéo linh kiện ra ngoài breadboard: dây tự nối từ lỗ cũ tới chân; kéo từ chân để nối dây<br />Kéo chỗ trống: di chuyển bàn · Chạm board/breadboard rồi kéo: dời nó<br />Rê chuột hoặc chạm vào lỗ: xem các điểm cùng mạch
  </div>
</section>

<style>
  section { padding: 12px; overflow: auto; }
  h2 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 16px 0 6px; }
  h2:first-child { margin-top: 2px; }
  .hint, .keys { font-size: 12px; color: var(--ink-3); line-height: 1.45; }
  .hint { margin: 0 0 8px; }
  .keys { margin-top: 18px; line-height: 1.6; padding: 8px 10px; border: 1px dashed var(--line-strong); background: var(--surface); }
  .keys b { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); }
  .item { touch-action: none; -webkit-user-select: none; user-select: none; display: flex; gap: 10px; align-items: center; padding: 6px 8px; border: 1px solid var(--line); border-radius: 0; margin-bottom: 4px; background: var(--surface); cursor: grab; }
  .item svg { flex: 0 0 auto; background: var(--surface-2); border: 1px solid var(--line-soft); }
  .item.board { width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; }
  .item.board:disabled { cursor: not-allowed; opacity: .5; }
  .item.current { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
  .name { font-size: 13px; font-weight: 600; }
  .meta { font: 10.5px var(--font-mono); color: var(--ink-3); margin-top: 1px; }
  .badge { color: var(--accent); font-weight: 600; }
  .board-row { position: relative; }
  .board-row .info { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
  .info { margin-left: auto; flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border-radius: 50%; font: italic 700 12px Georgia, serif; color: var(--signal); border-color: var(--line); background: var(--surface); cursor: pointer; }
  .info:hover { background: var(--signal-soft); border-color: var(--signal); }
</style>
