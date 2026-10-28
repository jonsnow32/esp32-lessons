<script lang="ts">
  // Code editor: write an Arduino sketch, build it with PlatformIO on this machine (through the
  // dev server) and run the result on the emulated board. Compiler errors are marked in the
  // editor at their line.
  import { cpp } from '@codemirror/lang-cpp';
  import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { onDestroy, onMount } from 'svelte';
  import { LESSONS } from '../lib/catalog';
  import { lab } from '../lib/lab.svelte';

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let showLog = $state(false);
  let logEl: HTMLPreElement;
  let lesson = $derived(LESSONS.find((l) => l.id === lab.lessonId));

  /** Compiler diagnostics as editor lint markers (pushed after each build, not re-linted). */
  function diagnostics(v: EditorView): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const e of lab.build.errors) {
      if (e.line < 1 || e.line > v.state.doc.lines) continue;
      const line = v.state.doc.line(e.line);
      const from = Math.min(line.from + Math.max(0, e.column - 1), line.to);
      out.push({ from, to: Math.max(from + 1, line.to), severity: e.severity, message: e.message });
    }
    return out;
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      doc: lab.code,
      extensions: [
        basicSetup,
        cpp(),
        lintGutter(),
        keymap.of([{ key: 'Mod-Enter', run: () => (void lab.buildAndRun(), true) }, { key: 'Mod-s', run: () => (void lab.buildAndRun(), true) }]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) lab.setCode(u.state.doc.toString());
        }),
        EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { fontFamily: "ui-monospace, 'JetBrains Mono', monospace" } }),
      ],
    });
  });
  onDestroy(() => view?.destroy());

  // Code replaced from outside (lesson sketch loaded): push it into the editor
  $effect(() => {
    const code = lab.code;
    if (view && view.state.doc.toString() !== code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    }
  });

  // Re-run the linter when a build finishes, and open the log on failure
  $effect(() => {
    void lab.build.errors;
    if (view) view.dispatch(setDiagnostics(view.state, diagnostics(view)));
    if (lab.build.status === 'failed' && lab.build.errors.length === 0) showLog = true;
  });

  $effect(() => {
    void lab.build.log;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  function jumpTo(line: number) {
    if (!view || line > view.state.doc.lines) return;
    const pos = view.state.doc.line(line).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  let errors = $derived(lab.build.errors.filter((e) => e.severity === 'error'));
</script>

<section>
  <div class="bar">
    <b>main.cpp</b>
    {#if lesson?.sketch}
      <button onclick={() => lab.loadLessonSketch()} title={lesson.sketch}>Nạp code bài {lesson.id.slice(0, 2)}</button>
    {/if}
    <button class="primary" disabled={lab.build.status === 'building'} onclick={() => lab.buildAndRun()} title="Ctrl/⌘ + Enter">
      {lab.build.status === 'building' ? '⏳ Đang build…' : '▶ Build & Run'}
    </button>
    <span class="status {lab.build.status}">
      {#if lab.build.status === 'ok'}✓ Build xong ({(lab.build.ms / 1000).toFixed(1)} s), đang chạy trên board ảo
      {:else if lab.build.status === 'failed'}✗ Build lỗi{errors.length ? `: ${errors.length} lỗi` : ''}
      {:else if lab.build.status === 'building'}PlatformIO đang biên dịch (lần đầu khoảng 10 s)…{/if}
    </span>
    <span class="spacer"></span>
    <button onclick={() => (showLog = !showLog)}>{showLog ? 'Ẩn log' : 'Log build'}</button>
  </div>

  {#if errors.length}
    <ul class="errors">
      {#each errors as e}
        <li><button class="link" onclick={() => jumpTo(e.line)}>Dòng {e.line}</button> {e.message}</li>
      {/each}
    </ul>
  {/if}

  <div class="body">
    <div class="editor" bind:this={host}></div>
    {#if showLog}
      <pre class="log" bind:this={logEl}>{lab.build.log || '(chưa build)'}</pre>
    {/if}
  </div>
</section>

<style>
  section { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #fff; border-top: 1px solid #e4e2dd; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
  .bar b { font: 600 13px ui-monospace, monospace; }
  .primary { background: #f76b15; color: #fff; border-color: #f76b15; }
  .primary:disabled { opacity: 0.7; cursor: progress; }
  .status { font-size: 12px; color: #6f6e77; }
  .status.ok { color: #18794e; }
  .status.failed { color: #ce2c31; }
  .spacer { flex: 1; }
  .errors { margin: 0; padding: 6px 12px; list-style: none; background: #fff0f0; font-size: 12.5px; color: #a3161b; max-height: 80px; overflow: auto; }
  .link { border: none; background: none; padding: 0 4px 0 0; color: #a3161b; font-weight: 700; text-decoration: underline; cursor: pointer; }
  .body { flex: 1; min-height: 0; display: flex; }
  .editor { flex: 1; min-width: 0; overflow: hidden; }
  .log { flex: 0 0 45%; margin: 0; padding: 8px; background: #111316; color: #cfd6df; font: 11.5px/1.4 ui-monospace, monospace; overflow: auto; white-space: pre-wrap; }
</style>
