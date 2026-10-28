<script lang="ts">
  import { lab } from '../lib/lab.svelte';

  let pre: HTMLPreElement;
  let line = $state('');

  $effect(() => {
    void lab.serial;
    if (pre) pre.scrollTop = pre.scrollHeight;
  });
</script>

<section>
  <h2>Serial Monitor <span>115200 baud · UART0</span></h2>
  <pre bind:this={pre}>{lab.serial || '(chưa có dữ liệu)'}</pre>
  <form onsubmit={(e) => { e.preventDefault(); lab.send({ type: 'serial-in', text: line + '\n' }); line = ''; }}>
    <input bind:value={line} placeholder="Gửi tới board…" />
  </form>
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 10px 12px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6f6e77; margin: 0 0 6px; }
  h2 span { text-transform: none; letter-spacing: 0; font-weight: 400; }
  pre { flex: 1; min-height: 120px; margin: 0; padding: 8px; background: #111316; color: #d7f5dd; font: 12px/1.45 ui-monospace, 'JetBrains Mono', monospace; border-radius: 6px; overflow: auto; white-space: pre-wrap; }
  input { width: 100%; margin-top: 6px; box-sizing: border-box; }
</style>
