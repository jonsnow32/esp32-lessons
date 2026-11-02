<script lang="ts">
  // Code editor: write an Arduino sketch, build it with PlatformIO on this machine (through the
  // dev server) and run the result on the emulated board. Compiler errors are marked in the
  // editor at their line. A project kept in a folder of the repo can have more sources than
  // main.cpp: one tab each, each with its own undo history.
  import { cpp } from '@codemirror/lang-cpp';
  import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { onDestroy, onMount, tick } from 'svelte';
  import { isSecretFile, lab, MAIN_FILE, type BuildError } from '../lib/lab.svelte';

  let host: HTMLDivElement;
  let view = $state.raw<EditorView | null>(null);
  let showLog = $state(false);
  let logEl: HTMLPreElement;
  /** The file the view holds now, and the other files' editor states (text, undo history, cursor). */
  let shown = MAIN_FILE;
  const states = new Map<string, EditorState>();
  let route = lab.route;

  /** Compiler diagnostics as editor lint markers (pushed after each build, not re-linted). */
  function diagnostics(v: EditorView): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const e of lab.build.errors) {
      if ((e.file ?? MAIN_FILE) !== shown || e.line < 1 || e.line > v.state.doc.lines) continue;
      const line = v.state.doc.line(e.line);
      const from = Math.min(line.from + Math.max(0, e.column - 1), line.to);
      out.push({ from, to: Math.max(from + 1, line.to), severity: e.severity, message: e.message });
    }
    return out;
  }

  function editorState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        cpp(),
        lintGutter(),
        keymap.of([{ key: 'Mod-Enter', run: () => (void lab.runCode(), true) }, { key: 'Mod-s', run: () => (void lab.runCode(), true) }]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) lab.setFile(shown, u.state.doc.toString());
        }),
        EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { fontFamily: "ui-monospace, 'JetBrains Mono', monospace" } }),
      ],
    });
  }

  onMount(() => {
    view = new EditorView({ parent: host, state: editorState(lab.code) });
  });
  onDestroy(() => view?.destroy());

  // Another tab or another project: its own editor state. Text replaced from outside (lesson
  // sketch loaded, the assistant's code applied, an edit made outside the lab): into the editor.
  $effect(() => {
    const name = lab.activeFile;
    const text = lab.fileText(name) ?? '';
    const r = lab.route;
    if (!view) return;
    if (r !== route) {
      states.clear();
      route = r;
      shown = name;
      view.setState(editorState(text));
    } else if (name !== shown) {
      states.set(shown, view.state);
      shown = name;
      view.setState(states.get(name) ?? editorState(text));
    }
    if (view.state.doc.toString() !== text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }
    view.dispatch(setDiagnostics(view.state, diagnostics(view)));
  });

  // Files gone (deleted, renamed): their editor states go too
  $effect(() => {
    const names = new Set([MAIN_FILE, ...lab.folderFiles]);
    for (const n of states.keys()) if (!names.has(n)) states.delete(n);
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

  async function jumpTo(e: BuildError) {
    const file = e.file ?? MAIN_FILE;
    if (lab.fileText(file) === undefined) return;
    lab.activeFile = file;
    await tick();
    if (!view || e.line > view.state.doc.lines) return;
    const pos = view.state.doc.line(e.line).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  let errors = $derived(lab.build.errors.filter((e) => e.severity === 'error'));
  let tabs = $derived([MAIN_FILE, ...lab.folderFiles]);
  const errorsIn = (name: string) => errors.filter((e) => (e.file ?? MAIN_FILE) === name).length;

  // A new file's name or a new name for one, typed in the tab bar
  let adding = $state(false);
  let renaming = $state<string | null>(null);
  let draft = $state('');
  let fileError = $state<string | null>(null);

  function startAdd() {
    [adding, renaming, draft, fileError] = [true, null, '', null];
  }

  function startRename(name: string) {
    if (name === MAIN_FILE || !lab.multiFile) return;
    [adding, renaming, draft, fileError] = [false, name, name, null];
  }

  function commit() {
    const name = draft.trim();
    if (!name || name === renaming) return cancel();
    fileError = adding ? lab.addFile(name) : renaming ? lab.renameFile(renaming, name) : null;
    if (!fileError) cancel();
  }

  function cancel() {
    [adding, renaming, draft] = [false, null, ''];
  }

  function onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      cancel();
      fileError = null;
    }
  }

  function remove(name: string) {
    if (confirm(`Xoá file ${name} khỏi thư mục ${lab.mine?.folder}? Không hoàn tác được trong lab (dùng git để lấy lại).`)) lab.removeFile(name);
  }

  const focus = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };
</script>

<section>
  <div class="bar">
    <div class="tabs" role="tablist">
      {#each tabs as name (name)}
        {#if renaming === name}
          <input class="name" bind:value={draft} onkeydown={onKey} onblur={commit} use:focus spellcheck="false" aria-label="Tên mới của file" />
        {:else}
          <button
            class="tab"
            class:on={lab.activeFile === name}
            role="tab"
            aria-selected={lab.activeFile === name}
            title={name === MAIN_FILE ? name : `${name}: bấm đúp để đổi tên${isSecretFile(name) ? '. Không gửi cho trợ lý AI' : ''}`}
            onclick={() => (lab.activeFile = name)}
            ondblclick={() => startRename(name)}
          >{#if isSecretFile(name)}🔒 {/if}{name}{#if errorsIn(name)}<span class="badge">{errorsIn(name)}</span>{/if}</button>
          {#if name !== MAIN_FILE && lab.activeFile === name && lab.multiFile}
            <button class="x" title="Xoá file {name}" aria-label="Xoá file {name}" onclick={() => remove(name)}>×</button>
          {/if}
        {/if}
      {/each}
      {#if lab.multiFile}
        {#if adding}
          <input class="name" bind:value={draft} onkeydown={onKey} onblur={commit} use:focus placeholder="vd: wifi.h" spellcheck="false" aria-label="Tên file mới" />
        {:else}
          <button class="add" title="Thêm file (.h, .cpp…) vào thư mục {lab.mine?.folder}" aria-label="Thêm file" onclick={startAdd}>+</button>
        {/if}
      {/if}
    </div>
    <span class="status {lab.build.status}">
      {#if lab.build.status === 'building'}⏳ PlatformIO đang biên dịch…
      {:else if lab.build.status === 'failed'}✗ Build lỗi{errors.length ? `: ${errors.length} lỗi, xem bên dưới` : ', xem log'}
      {:else if lab.program.kind !== 'none' && lab.codeChanged}✎ Code đã sửa, bấm ▶ Chạy (hoặc Ctrl/⌘ + Enter) để build lại
      {:else if lab.program.kind !== 'none'}✓ Board đang chạy đúng code này
      {:else}Bấm ▶ Chạy (hoặc Ctrl/⌘ + Enter) để build và chạy{/if}
    </span>
    <span class="spacer"></span>
    <button onclick={() => (showLog = !showLog)}>{showLog ? 'Ẩn log' : 'Log build'}</button>
  </div>

  {#if fileError}
    <div class="file-error">{fileError}</div>
  {/if}

  {#if errors.length}
    <ul class="errors">
      {#each errors as e}
        <li><button class="link" onclick={() => jumpTo(e)}>{(e.file ?? MAIN_FILE) === MAIN_FILE ? '' : `${e.file} `}Dòng {e.line}</button> {e.message}</li>
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
  section { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--surface); border-top: 1px solid var(--line); }
  .bar { display: flex; gap: 8px; align-items: center; padding: 5px 10px; border-bottom: 1px solid var(--line); background: var(--surface-2); flex-wrap: wrap; }
  .tabs { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; }
  .bar .tab { font: 12px var(--font-mono); padding: 2px 10px; background: transparent; border: 1px solid transparent; color: var(--ink-3); cursor: pointer; }
  .bar .tab:hover { color: var(--ink); border-color: var(--line); }
  .bar .tab.on { font-weight: 600; color: var(--ink); background: var(--surface); border-color: var(--line); box-shadow: inset 0 2px 0 var(--accent); }
  .badge { margin-left: 6px; padding: 0 5px; border-radius: 8px; background: var(--error); color: #fff; font-size: 10.5px; font-weight: 700; }
  .bar .x, .bar .add { padding: 0 6px; font: 600 13px var(--font-mono); background: transparent; border: 1px solid transparent; color: var(--ink-3); cursor: pointer; }
  .bar .x:hover { color: var(--error); border-color: var(--error-line); }
  .bar .add:hover { color: var(--ink); border-color: var(--line); }
  .name { font: 12px var(--font-mono); padding: 2px 6px; width: 130px; border: 1px solid var(--accent); background: var(--surface); }
  .file-error { padding: 4px 12px; font-size: 12px; color: var(--error); background: var(--error-soft); border-bottom: 1px solid var(--error-line); }
  .status { font-size: 12px; color: var(--ink-3); }
  .status.ok { color: var(--ok); }
  .status.failed { color: var(--error); font-weight: 600; }
  .spacer { flex: 1; }
  .bar button { font: 12px var(--font-mono); padding: 2px 10px; }
  .errors { margin: 0; padding: 6px 12px; list-style: none; background: var(--error-soft); border-bottom: 1px solid var(--error-line); box-shadow: inset 3px 0 0 var(--error); font-size: 12.5px; color: var(--error); max-height: 80px; overflow: auto; }
  .link { border: none; background: none; padding: 0 4px 0 0; color: var(--error); font: 700 12px var(--font-mono); text-decoration: underline; cursor: pointer; }
  .body { flex: 1; min-height: 0; display: flex; }
  .editor { flex: 1; min-width: 0; overflow: hidden; }
  .editor :global(.cm-gutters) { background: var(--surface-2); border-right: 1px solid var(--line); color: var(--ink-4); }
  .editor :global(.cm-activeLineGutter) { background: var(--surface-3); color: var(--ink-2); }
  .editor :global(.cm-activeLine) { background: #f76b150a; }
  .editor :global(.cm-focused) { outline: none; }
  .log { flex: 0 0 45%; margin: 0; padding: 8px 10px; background: var(--term); color: #c9d2da; border-left: 1px solid #000; font: 11.5px/1.45 var(--font-mono); overflow: auto; white-space: pre-wrap; }
</style>
