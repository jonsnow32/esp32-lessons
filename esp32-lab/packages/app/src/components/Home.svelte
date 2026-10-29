<script lang="ts">
  // Home: one card per lesson plus the sandbox, then the featured projects. Each keeps its own
  // bench and code, so a card resumes where you left off.
  import { BOARDS, BREADBOARDS, FEATURED, LESSONS, PARTS } from '../lib/catalog';
  import { breadboard, breadboardBox } from '../lib/geometry';
  import BoardView from './BoardView.svelte';
  import BreadboardView from './BreadboardView.svelte';
  import CircuitThumb from './CircuitThumb.svelte';
  import { SCENE_DEFS } from '../lib/scene';
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

  /** Each part at rest, for the component cards. */
  const parts = Object.entries(PARTS).map(([type, m]) => {
    const props = Object.fromEntries(Object.entries(m.manifest.props).map(([k, s]) => [k, s.default]));
    return { type, m, svg: m.view?.(props as never, m.doc?.active ?? {}) ?? '' };
  });

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

  <h2>Linh kiện</h2>
  <p class="lead">Mỗi linh kiện có một trang riêng: hình dạng, sơ đồ chân, cấu tạo bên trong, đặc tuyến và cách nối với ESP32.</p>
  <svg width="0" height="0" style="position: absolute"><defs>{@html SCENE_DEFS}</defs></svg>
  <div class="parts">
    {#each parts as { type, m, svg } (type)}
      <button class="part" onclick={() => (lab.docPage = type)}>
        <svg viewBox={m.icon ?? '-1 -3 6 6.5'}>{@html svg}</svg>
        <span>{m.manifest.name}</span>
      </button>
    {/each}
  </div>

  <h2>Board và breadboard</h2>
  <p class="lead">Sơ đồ chân từng board (chân nào đọc analog, chân nào nên tránh) và bên trong breadboard: lỗ nào nối với lỗ nào.</p>
  <div class="parts">
    {#each Object.entries(BOARDS) as [type, b] (type)}
      {@const right = Math.max(...b.pins.map((p) => p.x))}
      <button class="part" onclick={() => (lab.docPage = `board:${type}`)}>
        <svg viewBox="-1.6 -3.9 {right + 3.2} {b.height + 3.4}"><BoardView board={b} net={new Set()} observables={{}} pinFill={() => 'url(#gold)'} pinHint={() => ''} onpress={() => {}} onrelease={() => {}} /></svg>
        <span>{b.name.replace(/ \(.*/, '')}</span>
      </button>
    {/each}
    {#each Object.entries(BREADBOARDS) as [type, d] (type)}
      {@const bx = breadboardBox(type)!}
      <button class="part" onclick={() => (lab.docPage = `bb:${type}`)}>
        <svg viewBox="{bx.x - 0.3} {bx.y - 0.3} {bx.w + 0.6} {bx.h + 0.6}"><BreadboardView id={type} bb={breadboard(type)!} net={new Set()} here={null} /></svg>
        <span>{d.name}</span>
      </button>
    {/each}
  </div>

  {#if mine.length}
    <h2>Dự án của tôi</h2>
    <p class="lead">Bản sao bạn đã sửa từ các dự án mẫu, lưu trên trình duyệt này.</p>
    <div class="grid">
      {#each mine as { p, ws, from } (p.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="card project trace" role="button" tabindex="0" onclick={() => lab.open(p.id)} onkeydown={(e) => e.key === 'Enter' && lab.open(p.id)}>
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
  /* Title block, like the corner of a schematic sheet */
  header { border: 1px solid var(--line-strong); border-left: 4px solid var(--accent); background: var(--surface); padding: 18px 22px; margin-bottom: 28px; }
  header h1 { font-size: 26px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 6px; }
  header p { color: var(--ink-3); margin: 0; max-width: 640px; line-height: 1.55; font-size: 14px; }
  h2 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); padding-bottom: 7px; border-bottom: 1px solid var(--line); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; text-align: left; padding: 16px 18px; border-radius: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; min-height: 190px; }
  .card:hover { background-color: var(--surface); }
  .num { font: 700 12px var(--font-mono); color: var(--accent); background: var(--accent-soft); border: 1px solid #f1c7a6; border-radius: 0; padding: 1px 7px; letter-spacing: .04em; }
  .free .num { background: var(--signal-soft); border-color: #bfe2dc; }
  .title { font-size: 16.5px; font-weight: 700; line-height: 1.3; }
  .summary { font-size: 13.5px; color: var(--ink-3); line-height: 1.5; flex: 1; }
  .progress { display: flex; align-items: center; gap: 8px; font: 11.5px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-3); width: 100%; }
  /* Bar graph: lit segments over a dark track */
  .bar { flex: 1; height: 6px; border-radius: 0; background: var(--surface-3); box-shadow: inset 0 0 0 1px var(--line-soft); overflow: hidden; }
  .bar span { display: block; height: 100%; background: repeating-linear-gradient(90deg, var(--ok-dot) 0 7px, transparent 7px 9px); }
  .lead { color: var(--ink-3); font-size: 13.5px; margin: -4px 0 12px; }
  h2:not(:first-of-type) { margin-top: 36px; }
  .project { padding: 0 0 16px; overflow: hidden; }
  .project > :not(.thumb) { margin: 0 18px; }
  .thumb { display: block; width: 100%; height: 150px; padding: 8px; box-sizing: border-box; background-color: var(--bg); background-image: linear-gradient(#0000000a 1px, transparent 1px), linear-gradient(90deg, #0000000a 1px, transparent 1px); background-size: 12px 12px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .actions { display: flex; align-items: center; gap: 6px; width: calc(100% - 36px); }
  .actions .cta { flex: 1; }
  .actions button { font-size: 12px; padding: 2px 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chips span { font: 10.5px var(--font-mono); color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); border-radius: 0; padding: 0 5px; }
  .parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .part { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px; border: 1px solid var(--line); background: var(--surface); text-align: center; }
  .part svg { width: 100%; height: 76px; background-color: var(--bg); background-image: linear-gradient(#0000000a 1px, transparent 1px), linear-gradient(90deg, #0000000a 1px, transparent 1px); background-size: 8px 8px; border: 1px solid var(--line-soft); }
  .part span { font-size: 12px; font-weight: 600; line-height: 1.3; }
  .part:hover { border-color: var(--accent); background-color: var(--surface); }
  .cta { font: 600 12px var(--font-mono); letter-spacing: .02em; color: var(--accent); }
</style>
