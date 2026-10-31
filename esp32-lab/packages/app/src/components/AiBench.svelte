<script lang="ts">
  // A new bench from a description (lib/design.svelte.ts), inside the new-bench dialog: what to
  // build, then the bench Claude designed, checked part by part and held against the box of parts,
  // with what is missing to mark as stocked, swap for what is there, or leave to buy.
  import { ai, cli, MODELS, type ModelId, type Source } from '../lib/ai.svelte';
  import { BOARDS, BREADBOARDS } from '../lib/catalog';
  import { designer } from '../lib/design.svelte';
  import { inventory, itemName } from '../lib/inventory.svelte';
  import CircuitThumb from './CircuitThumb.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const EXAMPLES = ['Tưới cây tự động khi đất khô, có đèn báo', 'Đo nhiệt độ, độ ẩm và hiện lên màn hình', 'Đèn ngủ tự bật khi trời tối', 'Còi báo khi có người đi qua'];

  let text = $state('');
  let change = $state('');
  let key = $state('');
  let title = $state('');
  let creating = $state(false);
  /** Another way in or model, for this and the assistant alike; the API key stays as it is. */
  function use(source: Source, model: ModelId = ai.model) {
    if (designer.busy) return;
    if (source !== ai.source) designer.reset();
    ai.configure(ai.apiKey, model, source);
  }

  let plan = $derived(designer.plan);
  let stock = $derived(designer.stock);
  let stocked = $derived(inventory.items.filter((i) => i.qty > 0 && i.kind !== 'custom').length);
  let errors = $derived(plan?.check.filter((f) => f.level === 'error') ?? []);
  let missing = $derived(stock?.lines.filter((l) => l.missing) ?? []);

  // A new design brings its own name
  $effect(() => {
    title = plan?.design.title ?? '';
  });

  function start() {
    if (!text.trim()) return;
    designer.reset();
    void designer.ask(text);
  }

  function revise() {
    if (!change.trim()) return;
    void designer.ask(change);
    change = '';
  }

  async function create() {
    if (creating) return;
    creating = true;
    onclose();
    await designer.create(title);
  }

  const name = (type: string, list: Record<string, { name: string }>) => list[type]?.name.replace(/ \(.*/, '') ?? type;
</script>

<div class="body">
  {#if !ai.ready}
    <p class="lead">Thiết kế bàn bằng AI dùng Claude của Anthropic với API key của bạn (giống Trợ lý AI trên bàn làm việc). Tạo key tại <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>; key chỉ lưu trong trình duyệt này.</p>
    <form class="key" onsubmit={(e) => { e.preventDefault(); ai.configure(key, ai.model, ai.source); }}>
      <input type="password" bind:value={key} placeholder="sk-ant-…" autocomplete="off" spellcheck="false" aria-label="API key" onkeydown={(e) => e.stopPropagation()} />
      <button type="submit" class="primary" disabled={!key.trim()}>Lưu key</button>
    </form>
    {#if cli.available}
      <p class="lead">Hoặc dùng Claude Code trên máy này, tính vào gói Claude của bạn:</p>
      <div><button onclick={() => use('cli')}>Dùng Claude Code</button></div>
    {/if}
  {:else if !plan && !designer.busy}
    <p class="lead">Tả điều bạn muốn làm. Claude chọn board, linh kiện, nối dây và viết code; lab ráp thử, kiểm tra từng linh kiện và đối chiếu với kho của bạn trước khi bạn tạo bàn.</p>
    <textarea rows="4" bind:value={text} placeholder="Vd: tưới cây tự động khi đất khô, bơm 5 V, có đèn báo khi đang tưới" aria-label="Mô tả dự án" onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}></textarea>
    <div class="chips">{#each EXAMPLES as ex}<button onclick={() => (text = ex)}>{ex}</button>{/each}</div>
    <div class="stockopt">
      <label class="check"><input type="checkbox" bind:checked={designer.stockOnly} disabled={!stocked} /> Chỉ dùng linh kiện có trong kho</label>
      <span class="meta">{stocked ? `Kho có ${stocked} loại món` : 'Kho trống: Claude chọn tự do, bạn xem cần mua gì ở bước sau'}</span>
    </div>
    {#if designer.error}<p class="err"><Icon name="error" size={14} />{designer.error}</p>{/if}
    {#if designer.note}<p class="note">{designer.note}</p>{/if}
  {:else if designer.busy}
    <p class="lead">{designer.asked.at(-1)}</p>
    <ol class="log" aria-live="polite">
      {#each designer.log as l, i}<li class:now={i === designer.log.length - 1}>{l}</li>{/each}
    </ol>
  {:else if plan && stock}
    <div class="plan">
      <div class="left">
        <span class="thumb"><CircuitThumb project={plan.project} /></span>
        <p class="summary">{plan.design.summary}</p>
        {#if designer.note}<p class="note">{designer.note}</p>{/if}
        <p class="meta">{name(plan.design.board, BOARDS)} · {plan.design.breadboard ? name(plan.design.breadboard, BREADBOARDS) : 'không breadboard'} · {plan.project.parts.length} linh kiện · {plan.project.wires.length} dây{plan.design.code ? ' · có code' : ''}</p>
        {#if plan.check.length}
          <h3>Kiểm tra mạch</h3>
          <ul class="findings">
            {#each plan.check as f}<li class={f.level}><Icon name={f.level === 'error' ? 'error' : 'warn'} size={13} />{f.text}</li>{/each}
          </ul>
        {:else}
          <p class="ok"><Icon name="check" size={13} />Kiểm tra từng linh kiện: không thấy lỗi.</p>
        {/if}
        <details>
          <summary>Lab đã ráp những gì</summary>
          <ul class="report">{#each plan.report as l}<li>{l}</li>{/each}</ul>
        </details>
        {#if plan.design.code}
          <details>
            <summary>main.cpp</summary>
            <pre>{plan.design.code}</pre>
          </details>
        {/if}
      </div>

      <div class="right">
        <h3>Đối chiếu kho <span class="tally" class:full={stock.complete}>{stock.haveCount}/{stock.needCount} đủ</span></h3>
        <table>
          <thead><tr><th>Món</th><th>Cần</th><th>Có</th><th></th></tr></thead>
          <tbody>
            {#each stock.lines as l (l.key)}
              <tr class:short={l.missing > 0}>
                <td>{itemName(l)}</td>
                <td>{l.qty}</td>
                <td>{l.have}</td>
                <td class="state">
                  {#if l.missing}
                    <button class="small" title="Bạn có món này rồi: thêm {l.missing} vào kho" onclick={() => inventory.add(l.kind, l.type, l.props, l.missing)}><Icon name="plus" size={11} />Có rồi</button>
                  {:else}<Icon name="check" size={13} label="Đủ" />{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if stock.complete}
          <p class="ok"><Icon name="check" size={13} />Kho có đủ mọi món, lắp được ngay ngoài đời.</p>
        {:else}
          <p class="meta">Thiếu {missing.length} món. Bấm "Có rồi" nếu kho chưa ghi, nhờ Claude thay bằng đồ có sẵn, hoặc cứ tạo bàn và mua sau.</p>
          <div class="row">
            {#if missing.length > 1}<button class="small" onclick={() => designer.stockMissing()}>Có hết rồi</button>{/if}
            {#if stocked}<button class="small" onclick={() => designer.useStock()}>Thay bằng đồ có sẵn</button>{/if}
          </div>
        {/if}
      </div>
    </div>
    {#if designer.error}<p class="err"><Icon name="error" size={14} />{designer.error}</p>{/if}
    <div class="revise">
      <input bind:value={change} placeholder="Muốn sửa gì? Vd: dùng relay thay MOSFET, thêm nút nhấn" aria-label="Sửa bàn" onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') revise(); }} />
      <button onclick={revise} disabled={!change.trim()}>Sửa</button>
    </div>
    <label class="title">Tên dự án <input bind:value={title} maxlength="80" onkeydown={(e) => e.stopPropagation()} /></label>
  {/if}
</div>

<footer>
  <span class="summary-line">
    {#if ai.ready}
      {#if cli.available}
        <select aria-label="Nguồn" value={ai.source} disabled={designer.busy} onchange={(e) => use(e.currentTarget.value as Source)}>
          <option value="cli">Claude Code</option>
          <option value="api" disabled={!ai.apiKey}>API key</option>
        </select>
      {/if}
      <select aria-label="Model" value={ai.model} disabled={designer.busy} onchange={(e) => use(ai.source, e.currentTarget.value as ModelId)}>
        {#each MODELS as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
    {/if}
    {designer.stockOnly ? 'chỉ đồ trong kho' : ''}
  </span>
  {#if designer.busy}
    <button onclick={() => designer.stop()}>Dừng</button>
  {:else if plan}
    <button onclick={() => designer.reset()}><Icon name="chevron-left" size={12} />Tả lại</button>
    <button class="primary" disabled={creating} title={errors.length ? 'Mạch còn lỗi, bạn có thể sửa sau trên bàn' : ''} onclick={create}>Tạo bàn{missing.length ? ` (thiếu ${missing.length} món)` : ''}</button>
  {:else if ai.ready}
    <button class="primary" disabled={!text.trim()} onclick={start}>Thiết kế<Icon name="chevron-right" size={12} /></button>
  {/if}
</footer>

<style>
  .body { flex: 1; overflow-y: auto; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
  .lead { margin: 0; color: var(--ink-3); font-size: var(--fs-md); }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { font-size: var(--fs-xs); padding: 3px 8px; }
  .stockopt { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md); }
  .meta { font: var(--fs-xs) var(--font-mono); color: var(--ink-3); margin: 0; }
  .note { margin: 0; font-size: var(--fs-md); white-space: pre-wrap; }
  .err { display: flex; gap: 6px; align-items: flex-start; margin: 0; color: var(--error); background: var(--error-soft); border: 1px solid var(--error-line); padding: 6px 8px; }
  .ok { display: flex; gap: 6px; align-items: center; margin: 0; color: var(--ok); font-size: var(--fs-md); }
  .key { display: flex; gap: 8px; }
  .key input { flex: 1; max-width: 360px; }
  .log { margin: 0; padding-left: 20px; font: var(--fs-xs) var(--font-mono); color: var(--ink-3); display: flex; flex-direction: column; gap: 3px; }
  .log .now { color: var(--accent); }
  .log .now::after { content: ' …'; }
  .plan { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .left, .right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .thumb { display: block; height: 160px; background: var(--bg); border: 1px solid var(--line-soft); }
  .summary { margin: 0; font-weight: 600; }
  h3 { display: flex; align-items: center; gap: 8px; font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 4px 0 0; }
  .tally { padding: 1px 6px; color: var(--warn); background: var(--warn-soft); letter-spacing: 0; }
  .tally.full { color: var(--ok); background: var(--ok-soft); }
  .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); }
  .findings li { display: flex; gap: 6px; align-items: flex-start; }
  .findings .error { color: var(--error); }
  .findings .warn { color: var(--warn); }
  details summary { cursor: pointer; font-size: var(--fs-xs); color: var(--ink-3); }
  .report { margin: 4px 0 0; padding-left: 18px; font-size: var(--fs-xs); color: var(--ink-3); }
  pre { max-height: 220px; overflow: auto; margin: 4px 0 0; padding: 8px; background: var(--surface-2); border: 1px solid var(--line-soft); font: var(--fs-xs) var(--font-mono); }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-xs); }
  th { text-align: left; font: 600 var(--fs-label) var(--font-mono); color: var(--ink-3); border-bottom: 1px solid var(--line); padding: 4px; }
  td { padding: 4px; border-bottom: 1px solid var(--line-soft); }
  td:nth-child(2), td:nth-child(3), th:nth-child(2), th:nth-child(3) { text-align: right; font-family: var(--font-mono); width: 36px; }
  tr.short td:nth-child(3) { color: var(--error); font-weight: 700; }
  .state { text-align: right; color: var(--ok); width: 72px; }
  .small { display: inline-flex; align-items: center; gap: 3px; font-size: var(--fs-xs); padding: 2px 6px; min-height: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .revise { display: flex; gap: 8px; border-top: 1px solid var(--line-soft); padding-top: 10px; }
  .revise input { flex: 1; }
  .title { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: var(--fs-md); }
  .title input { flex: 1; max-width: 360px; }
  footer { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--line); background: var(--surface-2); }
  footer button { display: inline-flex; align-items: center; gap: 4px; }
  .summary-line { display: flex; align-items: center; gap: 6px; margin-right: auto; font: var(--fs-xs) var(--font-mono); color: var(--ink-3); }
  .summary-line select { font-size: var(--fs-xs); padding: 2px 4px; min-height: 0; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .primary:hover:not(:disabled) { background-color: var(--accent-hi); }
  .primary:disabled { background: var(--surface-3); border-color: var(--line); color: var(--ink-3); }
  @media (max-width: 640px) { .plan { grid-template-columns: 1fr; } }
</style>
