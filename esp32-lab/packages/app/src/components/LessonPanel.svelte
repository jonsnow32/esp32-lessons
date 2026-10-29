<script lang="ts">
  // The lesson's steps and exercises, checked live against the circuit and serial output.
  import { lab } from '../lib/lab.svelte';

  let lesson = $derived(lab.lesson);
  // A copy keeps showing its original's description and suggestions
  let featured = $derived(lab.source);
  const result = (id: string) => lab.steps.find((s) => s.id === id);
  const passed = (id: string) => result(id)?.pass ?? false;
</script>

{#if lesson}
  <section>
    <h2>Các bước của bài</h2>
    <ol>
      {#each lesson.steps as step, i (step.id)}
        <li class:pass={passed(step.id)}>
          <span class="mark">{passed(step.id) ? '✓' : i + 1}</span>
          <div>
            {step.title}
            {#if !passed(step.id) && step.hint}<div class="hint">{step.hint}</div>{/if}
          </div>
        </li>
      {/each}
    </ol>
    {#if lesson.exercises?.length}
      <h3>Bài tập</h3>
      <ol>
        {#each lesson.exercises as ex (ex.id)}
          <li class:pass={passed(ex.id)}>
            <span class="mark">{passed(ex.id) ? '✓' : '★'}</span>
            <div>
              {ex.title}
              {#if !passed(ex.id)}
                {#each result(ex.id)?.results.filter((r) => !r.pass && r.detail) ?? [] as r}<div class="fail">{r.detail}</div>{/each}
                {#if ex.hint}<div class="hint">{ex.hint}</div>{/if}
              {/if}
              {#if ex.template}
                <button class="small" onclick={() => confirm('Thay mạch trên bàn bằng mạch khởi đầu của bài tập? Code giữ nguyên.') && lab.startExercise(ex.id)}>Bắt đầu bài tập</button>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {/if}
    <p class="src">Lý thuyết: <code>{lesson.source}</code></p>
  </section>
{:else if featured}
  <section>
    <h2>{lab.mine ? `Bản sao của: ${featured.title}` : 'Dự án mẫu'}</h2>
    <p class="about">{featured.summary}</p>
    <h3>Thử xem</h3>
    <ol>
      {#each featured.tryIt as t, i (i)}<li><span class="mark">{i + 1}</span><div>{t}</div></li>{/each}
    </ol>
    <p class="src">Bấm ▶ Chạy: code được build bằng PlatformIO trên máy (~10 s) rồi chạy trên board giả lập.</p>
  </section>
{/if}

<style>
  section { padding: 10px 12px; border-bottom: 1px solid var(--line); }
  h2 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 0 0 6px; }
  h3 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); margin: 14px 0 4px; padding-top: 10px; border-top: 1px dashed var(--line); }
  ol { list-style: none; padding: 0; margin: 4px 0 0; font-size: 13px; }
  li { display: flex; gap: 9px; margin: 7px 0; line-height: 1.4; }
  /* Step marks are test points: hollow until the check passes */
  .mark { flex: 0 0 20px; height: 20px; box-sizing: border-box; border-radius: 0; background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink-3); font: 700 11px var(--font-mono); display: grid; place-items: center; }
  .pass .mark { background: var(--ok); border-color: var(--ok); color: #fff; }
  .pass > div { color: var(--ink-3); }
  .hint { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
  .fail { font-size: 12px; color: var(--error); }
  .small { margin-top: 4px; font-size: 12px; padding: 2px 8px; }
  .about { font-size: 13px; line-height: 1.5; margin: 0 0 6px; color: var(--ink-2); }
  .src { font-size: 11px; color: var(--ink-3); margin: 12px 0 0; }
</style>
