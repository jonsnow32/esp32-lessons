<script lang="ts">
  // The real board on USB: pick its port, flash the editor's code to it, or flash it with the
  // probe and let the bench follow the board (live mode, see lib/live.ts).
  import { lab } from '../lib/lab.svelte';
  import Icon from './Icon.svelte';

  let open = $state(false);
  let d = $derived(lab.device);
  // Connecting never blocks: flashing (or stopping) takes the port back
  let busy = $derived(d.status === 'uploading' || lab.build.status === 'building');
  let logEl = $state<HTMLPreElement>();

  $effect(() => {
    void d.log;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  function toggle() {
    open = !open;
    if (open && d.status === 'idle') void lab.refreshPorts();
  }
</script>

{#if d.available}
  <div class="device">
    <button class="usb" class:live={d.status === 'live'} onclick={toggle} aria-haspopup="dialog" aria-expanded={open}
      title={d.status === 'live' ? `Đang theo dõi board thật trên ${d.port}` : 'Board thật qua USB: nạp code, theo dõi trên bàn'}>
      <Icon name="usb" />{#if d.status === 'live'}<span class="dot"></span>Board thật{:else if d.status === 'uploading'}Đang nạp…{/if}
    </button>
    {#if open}
      <div class="panel" role="dialog" aria-label="Board thật">
        <div class="head">Board thật qua USB</div>
        <div class="row">
          <select bind:value={lab.device.port} disabled={busy || d.status === 'live'} aria-label="Cổng USB">
            {#if !d.ports.length}<option value="">Không thấy cổng nào</option>{/if}
            {#each d.ports as p}<option value={p.port}>{p.port}{p.likely ? '' : ' (?)'}</option>{/each}
          </select>
          <button onclick={() => lab.refreshPorts()} disabled={busy} title="Tìm lại các cổng USB" aria-label="Làm mới"><Icon name="reset" size={14} /></button>
        </div>
        {#if d.status === 'connecting'}
          <p class="hint">Đang mở cổng {d.port}…</p>
          <div class="actions">
            <button class="primary" onclick={() => lab.uploadToBoard(true)}><Icon name="play" size={14} />Nạp & theo dõi</button>
            <button class="stop" onclick={() => lab.stopLive()}>Huỷ</button>
          </div>
        {:else if d.status === 'live'}
          <p class="hint">{d.probe ? 'Bàn mạch đang chạy theo board thật: LED, PWM, relay… sáng như trên board. Nút bấm ảo trên bàn không tới được chip thật.' : 'Đang chờ board gửi trạng thái chân…'}</p>
          <div class="actions">
            <button onclick={() => fetch('/api/device/serial/reset', { method: 'POST' })} title="Khởi động lại chip (như nhấn EN)"><Icon name="reset" size={14} />Reset board</button>
            <button class="stop" onclick={() => lab.stopLive()}>Dừng theo dõi</button>
          </div>
        {:else}
          <div class="actions">
            <button class="primary" onclick={() => lab.uploadToBoard(true)} disabled={busy}
              title="Build code trong editor kèm probe, nạp vào board, rồi cho bàn mạch chạy theo board thật"><Icon name="play" size={14} />Nạp & theo dõi</button>
            <button onclick={() => lab.uploadToBoard(false)} disabled={busy} title="Chỉ build và nạp code trong editor vào board (không kèm probe)">Chỉ nạp</button>
            <button onclick={() => lab.startLive()} disabled={busy} title="Board đã có bản nạp kèm probe: chỉ kết nối lại">Kết nối</button>
          </div>
          <p class="hint">Lần nạp đầu mất 1–2 phút để biên dịch. "Nạp & theo dõi" thêm một probe nhỏ báo trạng thái chân qua Serial 115200.</p>
        {/if}
        {#if d.error}<p class="error" role="alert">{d.error}</p>{/if}
        {#if d.log && d.status !== 'live'}<pre bind:this={logEl}>{d.log}</pre>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .device { position: relative; }
  .usb { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
  .usb.live { color: #7ee2a0; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #3fd07a; box-shadow: 0 0 6px #3fd07a; }
  .panel { position: absolute; left: 50%; transform: translateX(-50%); top: calc(100% + 6px); z-index: 30; width: 360px; background: var(--surface); color: var(--ink); color-scheme: light; border: 1px solid var(--line-strong); border-top: 2px solid var(--accent); box-shadow: var(--shadow-float); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .head { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12px; }
  .panel button { color: var(--ink); background: var(--surface-2, transparent); border: 1px solid var(--line-strong); display: inline-flex; align-items: center; gap: 6px; }
  .panel button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .panel button.stop { border-color: #b8232b; color: #b8232b; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .hint { margin: 0; font-size: 12px; color: var(--ink-3); line-height: 1.4; }
  .error { margin: 0; font-size: 12px; color: #b8232b; line-height: 1.4; }
  pre { margin: 0; max-height: 180px; overflow: auto; padding: 6px 8px; background: var(--term); color: #b9f0c6; font: 11px/1.4 var(--font-mono); white-space: pre-wrap; }
</style>
