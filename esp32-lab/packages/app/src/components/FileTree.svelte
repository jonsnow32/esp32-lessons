<script lang="ts">
  // The project's files as a tree, as in VS Code's explorer: folders fold, a click opens a file
  // as a tab, and files and folders are made, renamed and deleted here (on disk too). Only for a
  // project kept in a folder of the repo.
  import { isSecretFile, lab, MAIN_FILE } from '../lib/lab.svelte';
  import Icon from './Icon.svelte';

  type Node = { name: string; path: string; dir: boolean; children: Node[] };
  /** What is being typed: a new file or folder in `parent`, or a new name for `path`. */
  type Edit = { kind: 'file' | 'folder'; parent: string } | { kind: 'rename'; path: string; dir: boolean };

  let collapsed = $state<string[]>([]);
  /** The row last clicked: new files and folders go into it (a folder) or beside it (a file). */
  let selected = $state('');
  let edit = $state<Edit | null>(null);
  let draft = $state('');
  let error = $state<string | null>(null);

  const byName = (a: Node, b: Node) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  let tree = $derived.by(() => {
    const root: Node = { name: '', path: '', dir: true, children: [] };
    const folder = (path: string): Node => {
      if (!path) return root;
      const cut = path.lastIndexOf('/');
      const parent = folder(cut < 0 ? '' : path.slice(0, cut));
      let node = parent.children.find((c) => c.dir && c.path === path);
      if (!node) parent.children.push((node = { name: path.slice(cut + 1), path, dir: true, children: [] }));
      return node;
    };
    for (const f of lab.folders) folder(f);
    for (const f of [MAIN_FILE, ...lab.folderFiles]) {
      const cut = f.lastIndexOf('/');
      folder(cut < 0 ? '' : f.slice(0, cut)).children.push({ name: f.slice(cut + 1), path: f, dir: false, children: [] });
    }
    const sort = (n: Node) => {
      n.children.sort(byName);
      n.children.forEach(sort);
    };
    sort(root);
    return root;
  });

  /** The rows shown, folded folders' contents left out, with the row a new file or folder is typed in. */
  let rows = $derived.by(() => {
    const out: ({ node: Node; depth: number } | { input: true; depth: number; dir: boolean })[] = [];
    const walk = (n: Node, depth: number) => {
      if (edit && edit.kind !== 'rename' && edit.parent === n.path) out.push({ input: true, depth, dir: edit.kind === 'folder' });
      for (const c of n.children) {
        out.push({ node: c, depth });
        if (c.dir && !collapsed.includes(c.path)) walk(c, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  });

  const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  /** Where a new file or folder goes: the selected folder, or the selected file's. */
  const target = () => (lab.folders.includes(selected) ? selected : parentOf(selected));

  function click(n: Node) {
    selected = n.path;
    if (n.dir) collapsed = collapsed.includes(n.path) ? collapsed.filter((p) => p !== n.path) : [...collapsed, n.path];
    else lab.openFile(n.path);
  }

  function startNew(kind: 'file' | 'folder', parent = target()) {
    collapsed = collapsed.filter((p) => p !== parent);
    [edit, draft, error] = [{ kind, parent }, '', null];
  }

  function startRename(n: Node) {
    if (n.path === MAIN_FILE) return;
    selected = n.path;
    [edit, draft, error] = [{ kind: 'rename', path: n.path, dir: n.dir }, n.name, null];
  }

  function commit() {
    const e = edit;
    const name = draft.trim().replace(/^\/+|\/+$/g, '');
    if (!e || !name) return cancel();
    if (e.kind === 'rename') {
      const to = parentOf(e.path) ? `${parentOf(e.path)}/${name}` : name;
      if (to === e.path) return cancel();
      error = e.dir ? lab.renameFolder(e.path, to) : lab.renameFile(e.path, to);
      if (!error) selected = to;
    } else {
      const path = e.parent ? `${e.parent}/${name}` : name;
      error = e.kind === 'folder' ? lab.addFolder(path) : lab.addFile(path);
      if (!error) selected = path;
    }
    if (!error) cancel();
  }

  function cancel() {
    edit = null;
    draft = '';
  }

  function onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      cancel();
      error = null;
    }
  }

  function remove(n: Node) {
    const where = lab.mine?.folder;
    const count = n.dir ? lab.folderFiles.filter((f) => f.startsWith(`${n.path}/`)).length : 0;
    const what = n.dir ? `thư mục ${n.path}${count ? ` và ${count} file trong đó` : ''}` : `file ${n.path}`;
    if (!confirm(`Xoá ${what} khỏi ${where}? Không hoàn tác được trong lab (dùng git để lấy lại).`)) return;
    if (n.dir) lab.removeFolder(n.path);
    else lab.removeFile(n.path);
  }

  function onRowKey(e: KeyboardEvent, n: Node) {
    if (e.key === 'F2' || (e.key === 'Enter' && e.altKey)) startRename(n);
    else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && n.path !== MAIN_FILE) remove(n);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** A letter for the kind of source, coloured like VS Code's: C++ / C / header. */
  const kind = (name: string) => (/\.(h|hpp)$/.test(name) ? 'h' : /\.c$/.test(name) ? 'c' : 'cpp');
  const errorsIn = (path: string, dir: boolean) =>
    lab.build.errors.filter((e) => e.severity === 'error' && (dir ? (e.file ?? MAIN_FILE).startsWith(`${path}/`) : (e.file ?? MAIN_FILE) === path)).length;

  const focus = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };
</script>

<nav class="tree" aria-label="File của dự án">
  <div class="head">
    <span class="title" title={lab.mine?.folder}>{lab.mine?.folder?.split('/').pop()}</span>
    <button title="File mới (.h, .cpp…)" aria-label="File mới" onclick={() => startNew('file')}><Icon name="file-plus" size={14} /></button>
    <button title="Thư mục mới" aria-label="Thư mục mới" onclick={() => startNew('folder')}><Icon name="folder-plus" size={14} /></button>
    <button title="Thu gọn hết" aria-label="Thu gọn hết" onclick={() => (collapsed = [...lab.folders])}><Icon name="minus" size={14} /></button>
  </div>
  {#if error}<div class="error">{error}</div>{/if}
  <ul role="tree">
    {#each rows as r, i ('input' in r ? `input-${i}` : r.node.path)}
      {#if 'input' in r}
        <li class="row" style:--depth={r.depth}>
          <span class="twisty"></span>
          <Icon name={r.dir ? 'folder' : 'file'} size={14} />
          <input bind:value={draft} onkeydown={onKey} onblur={commit} use:focus placeholder={r.dir ? 'tên thư mục' : 'vd: wifi_conn.h'} spellcheck="false" aria-label={r.dir ? 'Tên thư mục mới' : 'Tên file mới'} />
        </li>
      {:else}
        {@const n = r.node}
        {@const open = n.dir && !collapsed.includes(n.path)}
        {@const errs = errorsIn(n.path, n.dir)}
        <li
          class="row"
          class:active={!n.dir && lab.activeFile === n.path}
          class:selected={selected === n.path}
          style:--depth={r.depth}
          role="treeitem"
          aria-selected={!n.dir && lab.activeFile === n.path}
          aria-expanded={n.dir ? open : undefined}
          tabindex="0"
          title={isSecretFile(n.path) ? `${n.path}: chứa mật khẩu, không gửi cho trợ lý AI` : n.path}
          onclick={() => click(n)}
          ondblclick={() => startRename(n)}
          onkeydown={(e) => (e.key === 'Enter' && !e.altKey ? click(n) : onRowKey(e, n))}
        >
          {#if edit?.kind === 'rename' && edit.path === n.path}
            <span class="twisty"></span>
            <Icon name={n.dir ? 'folder' : 'file'} size={14} />
            <input bind:value={draft} onkeydown={onKey} onblur={commit} onclick={(e) => e.stopPropagation()} use:focus spellcheck="false" aria-label="Tên mới" />
          {:else}
            <span class="twisty">{#if n.dir}<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />{/if}</span>
            {#if n.dir}
              <span class="ico folder"><Icon name={open ? 'folder-open' : 'folder'} size={14} /></span>
            {:else}
              <span class="ico badge {kind(n.name)}">{isSecretFile(n.path) ? '🔒' : kind(n.name) === 'h' ? 'H' : kind(n.name) === 'c' ? 'C' : 'C++'}</span>
            {/if}
            <span class="name" class:err={errs > 0}>{n.name}</span>
            {#if errs}<span class="count">{errs}</span>{/if}
            <span class="actions">
              {#if n.dir}
                <button title="File mới trong {n.path}" aria-label="File mới trong {n.path}" onclick={(e) => { e.stopPropagation(); selected = n.path; startNew('file', n.path); }}><Icon name="file-plus" size={12} /></button>
              {/if}
              {#if n.path !== MAIN_FILE}
                <button title="Đổi tên (F2)" aria-label="Đổi tên {n.path}" onclick={(e) => { e.stopPropagation(); startRename(n); }}><Icon name="edit" size={12} /></button>
                <button title="Xoá" aria-label="Xoá {n.path}" onclick={(e) => { e.stopPropagation(); remove(n); }}><Icon name="trash" size={12} /></button>
              {/if}
            </span>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
</nav>

<style>
  .tree { flex: 0 0 200px; min-width: 0; display: flex; flex-direction: column; background: var(--surface-2); border-right: 1px solid var(--line); font-size: 12.5px; user-select: none; }
  .head { display: flex; align-items: center; gap: 2px; padding: 4px 6px 4px 10px; border-bottom: 1px solid var(--line); }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 11px var(--font-mono); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-3); }
  .head button, .actions button { display: grid; place-items: center; padding: 2px; border: 1px solid transparent; background: transparent; color: var(--ink-3); cursor: pointer; }
  .head button:hover, .actions button:hover { color: var(--ink); border-color: var(--line); background: var(--surface); }
  .error { padding: 4px 10px; font-size: 11.5px; color: var(--error); background: var(--error-soft); border-bottom: 1px solid var(--error-line); }
  ul { flex: 1; margin: 0; padding: 2px 0; list-style: none; overflow: auto; }
  .row { display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px 0 calc(6px + var(--depth) * 12px); cursor: pointer; color: var(--ink-2); outline: none; }
  .row:hover { background: var(--surface-3); }
  .row.selected { background: var(--surface-3); }
  .row:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }
  .row.active { background: var(--surface); color: var(--ink); box-shadow: inset 2px 0 0 var(--accent); }
  .twisty { flex: 0 0 12px; display: grid; place-items: center; color: var(--ink-4); }
  .ico { flex: 0 0 auto; display: grid; place-items: center; }
  .folder { color: var(--ink-3); }
  .badge { min-width: 22px; font: 700 9px var(--font-mono); letter-spacing: -0.02em; }
  .badge.cpp { color: #2f6db5; }
  .badge.c { color: #5b6bb0; }
  .badge.h { color: #8a5ab8; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 12px; }
  .name.err { color: var(--error); }
  .count { padding: 0 5px; border-radius: 8px; background: var(--error); color: #fff; font: 700 10px var(--font-mono); }
  .actions { display: none; gap: 1px; }
  .row:hover .actions, .row:focus-within .actions { display: flex; }
  .row:hover .count { display: none; }
  input { flex: 1; min-width: 0; font: 12px var(--font-mono); padding: 1px 4px; border: 1px solid var(--accent); background: var(--surface); }
</style>
