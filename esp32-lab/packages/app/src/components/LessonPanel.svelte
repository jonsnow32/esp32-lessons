<script lang="ts">
  // Lesson picker and live checklist. Checks run in the worker against the real circuit and the
  // firmware's serial output.
  import { LESSONS } from '../lib/catalog';
  import { lab } from '../lib/lab.svelte';

  let lesson = $derived(LESSONS.find((l) => l.id === lab.lessonId));
  let mainSteps = $derived(lab.steps.filter((s) => lesson?.steps.some((x) => x.id === s.id)));
  let exercises = $derived(lab.steps.filter((s) => lesson?.exercises?.some((x) => x.id === s.id)));
</script>

<section>
  <h2>Bài học</h2>
  <select value={lab.lessonId ?? ''} onchange={(e) => lab.selectLesson(e.currentTarget.value || null)}>
    <option value="">— Tự do —</option>
    {#each LESSONS as l (l.id)}<option value={l.id}>{l.id} · {l.title}</option>{/each}
  </select>
  {#if lesson}
    <p class="src">Nội dung: <code>{lesson.source}</code> · firmware <code>{lesson.firmware.kind === 'pio-env' ? lesson.firmware.env : '—'}</code></p>
    <button onclick={() => lab.loadTemplate()}>Nạp mạch mẫu</button>
    <ol>
      {#each mainSteps as s (s.id)}
        <li class:pass={s.pass}><span class="mark">{s.pass ? '✓' : '○'}</span> {s.title}
          {#if !s.pass && s.hint}<div class="hint">{s.hint}</div>{/if}
        </li>
      {/each}
    </ol>
    {#if exercises.length}
      <h3>Bài tập</h3>
      <ol>
        {#each exercises as s (s.id)}
          <li class:pass={s.pass}><span class="mark">{s.pass ? '✓' : '○'}</span> {s.title}
            {#if !s.pass}
              {#each s.results.filter((r) => !r.pass && r.detail) as r}<div class="fail">{r.detail}</div>{/each}
              {#if s.hint}<div class="hint">{s.hint}</div>{/if}
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>

<style>
  section { padding: 10px 12px; border-bottom: 1px solid #e4e2dd; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6f6e77; margin: 0 0 6px; }
  h3 { font-size: 12px; margin: 10px 0 4px; }
  select { width: 100%; }
  .src { font-size: 11px; color: #8b8d98; }
  ol { list-style: none; padding: 0; margin: 8px 0 0; font-size: 13px; }
  li { margin: 6px 0; }
  .mark { display: inline-block; width: 18px; color: #b9bbc6; font-weight: 700; }
  .pass .mark { color: #30a46c; }
  .hint { font-size: 12px; color: #6f6e77; margin-left: 18px; }
  .fail { font-size: 12px; color: #e5484d; margin-left: 18px; }
</style>
