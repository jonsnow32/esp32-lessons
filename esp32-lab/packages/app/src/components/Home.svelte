<script lang="ts">
  // Home: one card per lesson plus the sandbox, then the featured projects. Each keeps its own
  // bench and code, so a card resumes where you left off.
  import { FEATURED, LESSONS, PARTS } from '../lib/catalog';
  import CircuitThumb from './CircuitThumb.svelte';
  import { FREE, lab, loadWorkspace } from '../lib/lab.svelte';

  const cards = LESSONS.map((l) => {
    const ws = loadWorkspace(l.id);
    const total = l.steps.length + (l.exercises?.length ?? 0);
    const done = ws ? ws.passed.filter((id) => [...l.steps, ...(l.exercises ?? [])].some((s) => s.id === id)).length : 0;
    return { lesson: l, started: !!ws, done, total };
  });
  const freeStarted = !!loadWorkspace(FREE);

  /** Each featured project's parts, once per type, for the chips under its title. */
  const featured = FEATURED.map((f) => {
    const seen = new Set<string>();
    const parts = f.project.parts.filter((p) => !seen.has(p.type) && seen.add(p.type));
    return { f, parts };
  });

  /** The user's projects with their saved bench, for the thumbnails. */
  let mine = $derived(lab.myProjects.map((p) => ({ p, ws: loadWorkspace(p.id), from: FEATURED.find((f) => f.id === p.from) })));

  const when = (t: number) => new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
</script>

<main>
  <header>
    <h1>ESP32 Lab</h1>
    <p>Phòng thí nghiệm ESP32 ảo: cắm linh kiện, viết code Arduino, chạy firmware thật trên board giả lập và xem dòng điện đi trong mạch.</p>
  </header>

  <h2>Chọn bài học</h2>
  <div class="grid">
    {#each cards as c (c.lesson.id)}
      <button class="card" onclick={() => lab.open(c.lesson.id)}>
        <span class="num">{c.lesson.id.slice(0, 2)}</span>
        <span class="title">{c.lesson.titleVi ?? c.lesson.title}</span>
        <span class="summary">{c.lesson.summary ?? ''}</span>
        <span class="progress">
          <span class="bar"><span style="width: {(c.done / Math.max(1, c.total)) * 100}%"></span></span>
          {c.done}/{c.total} bước
        </span>
        <span class="cta">{c.started ? 'Tiếp tục →' : 'Bắt đầu →'}</span>
      </button>
    {/each}
    <button class="card free" onclick={() => lab.open(FREE)}>
      <span class="num">🧪</span>
      <span class="title">Tự do</span>
      <span class="summary">Bàn trống và code tự viết: thử bất cứ mạch nào bạn muốn.</span>
      <span class="cta">{freeStarted ? 'Tiếp tục →' : 'Mở →'}</span>
    </button>
  </div>

  <h2>Dự án mẫu</h2>
  <p class="lead">Mạch và code đã sẵn sàng: mở ra, bấm ▶ Chạy, rồi sửa tuỳ ý. Mỗi dự án lưu bản của riêng bạn.</p>
  <div class="grid">
    {#each featured as { f, parts } (f.id)}
      <button class="card project" onclick={() => lab.open(f.id)}>
        <span class="thumb"><CircuitThumb project={f.project} /></span>
        <span class="title">{f.title}</span>
        <span class="summary">{f.summary}</span>
        <span class="chips">{#each parts as p (p.id)}<span>{PARTS[p.type]!.manifest.name.replace(/ \(.*\)$/, '')}</span>{/each}</span>
        <span class="cta">Mở dự án →</span>
      </button>
    {/each}
  </div>

  {#if mine.length}
    <h2>Dự án của tôi</h2>
    <p class="lead">Bản sao bạn đã sửa từ các dự án mẫu, lưu trên trình duyệt này.</p>
    <div class="grid">
      {#each mine as { p, ws, from } (p.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="card project" role="button" tabindex="0" onclick={() => lab.open(p.id)} onkeydown={(e) => e.key === 'Enter' && lab.open(p.id)}>
          <span class="thumb">{#if ws}<CircuitThumb project={ws.project} />{/if}</span>
          <span class="title">{p.title}</span>
          <span class="summary">{from ? `Từ dự án mẫu "${from.title}". ` : ''}Sửa lần cuối {when(p.updated)}.</span>
          <span class="actions">
            <span class="cta">Mở →</span>
            <button title="Đổi tên" onclick={(e) => { e.stopPropagation(); const t = prompt('Tên dự án', p.title); if (t) lab.renameMyProject(p.id, t); }}>✎ Đổi tên</button>
            <button title="Xoá dự án" onclick={(e) => { e.stopPropagation(); if (confirm(`Xoá "${p.title}"? Mạch và code của bản sao này sẽ mất.`)) lab.deleteMyProject(p.id); }}>🗑 Xoá</button>
          </span>
        </div>
      {/each}
    </div>
  {/if}
</main>

<style>
  main { max-width: 980px; margin: 0 auto; padding: 40px 24px; }
  header h1 { font-size: 28px; margin: 0 0 6px; }
  header p { color: #60646c; margin: 0 0 28px; max-width: 640px; line-height: 1.5; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #6f6e77; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; text-align: left; padding: 18px; border-radius: 14px; border: 1px solid #e4e2dd; background: #fff; cursor: pointer; min-height: 190px; box-shadow: 0 1px 2px #0000000d; transition: transform .1s, box-shadow .1s; }
  .card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px #00000014; border-color: #f5a524; background: #fff; }
  .num { font: 700 13px ui-monospace, monospace; color: #f76b15; background: #fff1e7; border-radius: 6px; padding: 2px 8px; }
  .free .num { background: #eef6ff; }
  .title { font-size: 17px; font-weight: 700; }
  .summary { font-size: 13.5px; color: #60646c; line-height: 1.5; flex: 1; }
  .progress { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6f6e77; width: 100%; }
  .bar { flex: 1; height: 6px; border-radius: 3px; background: #efeee9; overflow: hidden; }
  .bar span { display: block; height: 100%; background: #30a46c; }
  .lead { color: #60646c; font-size: 13.5px; margin: -4px 0 12px; }
  h2:not(:first-of-type) { margin-top: 34px; }
  .project { padding: 0 0 16px; overflow: hidden; }
  .project > :not(.thumb) { margin: 0 18px; }
  .thumb { display: block; width: 100%; height: 150px; padding: 8px; box-sizing: border-box; background: radial-gradient(circle at 50% 120%, #fbf3e4, #f1ece2); border-bottom: 1px solid #ece7dc; margin-bottom: 4px; }
  .actions { display: flex; align-items: center; gap: 6px; width: calc(100% - 36px); }
  .actions .cta { flex: 1; }
  .actions button { font-size: 12px; padding: 2px 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chips span { font-size: 11px; color: #5b5e66; background: #f3f2ee; border-radius: 4px; padding: 1px 6px; }
  .cta { font-size: 13px; font-weight: 600; color: #f76b15; }
</style>
