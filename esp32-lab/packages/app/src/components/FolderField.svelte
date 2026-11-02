<script lang="ts">
  // Where a new project is kept: in the browser, or in a folder of the repo (a linked folder, see
  // lab.svelte.ts MyProject.folder), checked by the lab's server as the path is typed.
  import { lab } from '../lib/lab.svelte';

  let { folder = $bindable(), valid = $bindable(true) }: { folder?: string; valid?: boolean } = $props();

  let use = $state(false);
  let path = $state('');
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let seq = 0;

  $effect(() => {
    const p = path.trim();
    folder = use && p ? p : undefined;
    if (!use) {
      valid = true;
      status = null;
      return;
    }
    valid = false;
    if (!p) {
      status = null;
      return;
    }
    const n = ++seq;
    const timer = setTimeout(async () => {
      const c = await lab.checkFolder(p);
      if (n !== seq) return;
      valid = c.ok;
      status = c.ok
        ? { ok: true, text: c.hasCode ? `Đã có ${c.path}/main.cpp: dự án dùng code đó.` : c.exists ? `Thêm main.cpp vào thư mục ${c.path}.` : `Tạo thư mục mới ${c.path}.` }
        : { ok: false, text: c.error };
    }, 250);
    return () => clearTimeout(timer);
  });
</script>

<div class="folder">
  <label class="check"><input type="checkbox" bind:checked={use} /> Lưu vào một thư mục trong repo</label>
  {#if use}
    <input bind:value={path} placeholder="vd: home-server/esp32-cua (tính từ thư mục gốc của repo)" spellcheck="false" aria-label="Đường dẫn thư mục" onkeydown={(e) => e.stopPropagation()} />
    <span class="hint" class:bad={status && !status.ok}>
      {status?.text ?? 'main.cpp và mạch (esp32-lab.json) nằm trong thư mục này, sửa được bằng VS Code / PlatformIO, và commit vào git được.'}
    </span>
  {/if}
</div>

<style>
  .folder { display: flex; flex-direction: column; gap: 6px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md); }
  input:not([type]) { max-width: 460px; font-family: var(--font-mono); }
  .hint { font: var(--fs-xs) var(--font-mono); color: var(--ink-3); }
  .hint.bad { color: var(--error); }
</style>
