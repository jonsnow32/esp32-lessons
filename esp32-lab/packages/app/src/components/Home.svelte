<script lang="ts">
  // Lesson picker: one card per lesson plus the sandbox. Each lesson keeps its own bench and
  // code, so a card resumes where you left off.
  import { LESSONS } from '../lib/catalog';
  import { FREE, lab, loadWorkspace } from '../lib/lab.svelte';

  const cards = LESSONS.map((l) => {
    const ws = loadWorkspace(l.id);
    const total = l.steps.length + (l.exercises?.length ?? 0);
    const done = ws ? ws.passed.filter((id) => [...l.steps, ...(l.exercises ?? [])].some((s) => s.id === id)).length : 0;
    return { lesson: l, started: !!ws, done, total };
  });
  const freeStarted = !!loadWorkspace(FREE);
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
  .cta { font-size: 13px; font-weight: 600; color: #f76b15; }
</style>
