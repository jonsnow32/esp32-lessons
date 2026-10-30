<script lang="ts">
  // The user's box of parts (in a DocSheet): what they have and where it is kept, a form to add
  // catalog parts, boards, breadboards or anything else, and each featured project held against
  // the stock: ready to build, or what is still missing.
  import type { StockItem } from '@esp32lab/inventory';
  import type { PartProps } from '@esp32lab/part-sdk';
  import { BOARDS, BREADBOARDS, CATEGORY, FEATURED, PARTS } from '../lib/catalog';
  import Icon from './Icon.svelte';
  import { inventory, itemName } from '../lib/inventory.svelte';
  import { lab } from '../lib/lab.svelte';
  import DocSheet from './DocSheet.svelte';

  /** The stock in groups: parts by category, then boards and breadboards, then the rest. */
  let groups = $derived.by(() => {
    const out = new Map<string, StockItem[]>();
    const push = (g: string, i: StockItem) => out.set(g, [...(out.get(g) ?? []), i]);
    for (const i of inventory.items) {
      if (i.kind === 'part') push(CATEGORY[PARTS[i.type!]?.manifest.category ?? ''] ?? 'Linh kiện', i);
      else if (i.kind === 'custom') push('Khác', i);
      else push('Board và breadboard', i);
    }
    for (const items of out.values()) items.sort((a, b) => itemName(a).localeCompare(itemName(b), 'vi'));
    return [...out].sort(([a], [b]) => Number(a === 'Khác') - Number(b === 'Khác'));
  });
  let total = $derived(inventory.items.reduce((n, i) => n + i.qty, 0));

  // The add form
  type Kind = StockItem['kind'];
  let kind = $state<Kind>('part');
  /** Defaults of the identifying props of a part. */
  const defaults = (t: string): PartProps => Object.fromEntries((PARTS[t]!.manifest.stock ?? []).map((k) => [k, PARTS[t]!.manifest.props[k]!.default]));
  const FIRST = Object.keys(PARTS)[0]!;
  let type = $state(FIRST);
  let props = $state<PartProps>(defaults(FIRST));
  let name = $state('');
  let qty = $state(1);
  const TYPES: Record<Exclude<Kind, 'custom'>, [string, string][]> = {
    part: Object.entries(PARTS).map(([t, m]) => [t, m.manifest.name]),
    board: Object.entries(BOARDS).map(([t, b]) => [t, b.name]),
    breadboard: Object.entries(BREADBOARDS).map(([t, b]) => [t, b.name]),
  };
  /** The identifying props of the picked part, each with its choices. */
  let fields = $derived(kind === 'part' ? (PARTS[type]?.manifest.stock ?? []).map((k) => ({ k, s: PARTS[type]!.manifest.props[k]! })) : []);
  function pickKind(k: Kind) {
    kind = k;
    if (k !== 'custom') pickType(TYPES[k][0]![0]);
  }
  function pickType(t: string) {
    type = t;
    props = kind === 'part' ? defaults(t) : {};
  }
  function add(e: SubmitEvent) {
    e.preventDefault();
    const n = Math.max(1, Math.round(qty) || 1);
    if (kind === 'custom') {
      if (!name.trim()) return;
      inventory.addCustom(name.trim(), n);
      name = '';
    } else inventory.add(kind, type, props, n);
    qty = 1;
  }

  // Featured projects against the stock, ready ones first
  let projects = $derived(
    FEATURED.map((f) => ({ f, c: inventory.featured.get(f.id)! })).sort((a, b) => Number(b.c.complete) - Number(a.c.complete) || b.c.haveCount / b.c.needCount - a.c.haveCount / a.c.needCount),
  );

  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([inventory.export()], { type: 'application/json' }));
    a.download = `kho-linh-kien-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  let file: HTMLInputElement;
  async function upload() {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    if (inventory.items.length && !confirm('Thay toàn bộ kho hiện tại bằng nội dung của tệp này?')) return;
    if (!inventory.import(await f.text())) alert('Tệp này không phải bản sao lưu kho linh kiện của ESP32 Lab.');
  }
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
</script>

<DocSheet title="Kho linh kiện" kind="Của tôi" siblings={[]}>
  <section class="intro">
    <h1>Kho linh kiện của tôi</h1>
    <p>Ghi lại linh kiện bạn đang có ngoài đời. Lab sẽ cho biết dự án nào bạn lắp được ngay và còn thiếu gì. Kho được lưu trên trình duyệt này; dùng Sao lưu để giữ hoặc chuyển sang máy khác.</p>
    <div class="row">
      <span class="count">{inventory.items.length} loại · {total} món</span>
      <span class="spacer"></span>
      <button onclick={download} disabled={!inventory.items.length}>⤓ Sao lưu (JSON)</button>
      <button onclick={() => file.click()}>⤒ Khôi phục…</button>
      <input bind:this={file} type="file" accept="application/json,.json" hidden onchange={upload} />
    </div>
  </section>

  <section>
    <h2>Thêm vào kho</h2>
    <form onsubmit={add}>
      <span class="seg">
        {#each [['part', 'Linh kiện'], ['board', 'Board'], ['breadboard', 'Breadboard'], ['custom', 'Món khác']] as [k, label]}
          <button type="button" class:on={kind === k} onclick={() => pickKind(k as Kind)}>{label}</button>
        {/each}
      </span>
      {#if kind === 'custom'}
        <input class="grow" placeholder="Tên, ví dụ: Bộ dây cắm đực-đực 40 sợi" bind:value={name} />
      {:else}
        <select value={type} onchange={(e) => pickType(e.currentTarget.value)}>
          {#each TYPES[kind] as [t, label] (t)}<option value={t}>{label}</option>{/each}
        </select>
        {#each fields as { k, s } (k)}
          {#if s.type === 'enum' || (s.type === 'number' && s.options)}
            <select title={k} value={String(props[k])} onchange={(e) => (props[k] = s.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value)}>
              {#each s.options ?? [] as o}<option value={String(o)}>{o}{s.type === 'number' ? (s.unit ?? '') : ''}</option>{/each}
            </select>
          {:else if s.type === 'number'}
            <label class="field">{k} <input type="number" min={s.min} max={s.max} value={Number(props[k])} oninput={(e) => (props[k] = Number(e.currentTarget.value))} /></label>
          {/if}
        {/each}
      {/if}
      <label class="field">SL <input class="qty" type="number" min="1" bind:value={qty} /></label>
      <button class="primary" type="submit" disabled={kind === 'custom' && !name.trim()}>+ Thêm</button>
    </form>
  </section>

  {#if groups.length}
    {#each groups as [group, items] (group)}
      <section>
        <h2>{group}</h2>
        <table>
          <thead><tr><th>Món</th><th class="n">Số lượng</th><th>Để ở đâu</th><th>Ghi chú</th><th class="n">Đơn giá (₫)</th><th></th></tr></thead>
          <tbody>
            {#each items as i (i.id)}
              <tr class:empty={!i.qty}>
                <td>
                  {#if i.kind === 'part'}<button class="link" onclick={() => (lab.docPage = i.type!)}>{itemName(i)}</button>
                  {:else if i.kind === 'board'}<button class="link" onclick={() => (lab.docPage = `board:${i.type}`)}>{itemName(i)}</button>
                  {:else if i.kind === 'breadboard'}<button class="link" onclick={() => (lab.docPage = `bb:${i.type}`)}>{itemName(i)}</button>
                  {:else}<input class="grow" value={i.name ?? ''} onchange={(e) => inventory.update(i.id, { name: e.currentTarget.value })} />{/if}
                </td>
                <td class="n qtycell">
                  <button title="Bớt một" disabled={!i.qty} onclick={() => inventory.update(i.id, { qty: i.qty - 1 })}>−</button>
                  <input class="qty" type="number" min="0" value={i.qty} onchange={(e) => inventory.update(i.id, { qty: Math.round(Number(e.currentTarget.value)) || 0 })} />
                  <button title="Thêm một" onclick={() => inventory.update(i.id, { qty: i.qty + 1 })}>+</button>
                </td>
                <td><input placeholder="Hộp A, ngăn 3" value={i.location ?? ''} onchange={(e) => inventory.update(i.id, { location: e.currentTarget.value || undefined })} /></td>
                <td><input value={i.note ?? ''} onchange={(e) => inventory.update(i.id, { note: e.currentTarget.value || undefined })} /></td>
                <td class="n"><input class="price" type="number" min="0" step="500" value={i.unitPrice ?? ''} onchange={(e) => inventory.update(i.id, { unitPrice: num(e.currentTarget.value) })} /></td>
                <td><button title="Xoá khỏi kho" onclick={() => confirm(`Xoá "${itemName(i)}" khỏi kho?`) && inventory.remove(i.id)} aria-label="Xoá khỏi kho"><Icon name="trash" size={14} /></button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/each}
  {:else}
    <section><p class="none">Kho đang trống. Thêm từng món ở trên, hoặc bấm "Tôi có bộ này" ở một dự án bên dưới để thêm cả bộ linh kiện của nó.</p></section>
  {/if}

  <section>
    <h2>Dự án mẫu với kho của bạn</h2>
    <div class="projects">
      {#each projects as { f, c } (f.id)}
        <div class="proj" class:ready={c.complete}>
          <div class="head">
            <b>{f.title}</b>
            <span class="badge">{c.complete ? 'Đủ linh kiện ✓' : `Có ${c.haveCount}/${c.needCount}`}</span>
          </div>
          {#if !c.complete}
            <ul>{#each c.lines.filter((l) => l.missing) as l (l.key)}<li>Thiếu {l.missing} × {itemName(l)}{l.have ? ` (có ${l.have})` : ''}</li>{/each}</ul>
          {/if}
          <div class="actions">
            <button onclick={() => lab.open(f.id)}>Mở dự án →</button>
            {#if !c.complete}<button title="Thêm mọi linh kiện của dự án này vào kho" onclick={() => inventory.addProject(f.project)}>Tôi có bộ này</button>{/if}
          </div>
        </div>
      {/each}
    </div>
  </section>
</DocSheet>

<style>
  .intro h1 { margin-bottom: 6px; }
  .intro p { margin: 0 0 12px; color: var(--ink-2); line-height: 1.6; font-size: 14px; max-width: 720px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .count { font: 600 13px var(--font-mono); color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .spacer { flex: 1; }
  form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .seg { display: flex; }
  .seg button { font: 12px var(--font-mono); padding: 3px 10px; margin-left: -1px; }
  .seg button.on { background: var(--accent); border-color: var(--accent); color: #fff; position: relative; }
  .field { display: inline-flex; align-items: center; gap: 5px; font: 12px var(--font-mono); color: var(--ink-3); }
  .grow { flex: 1; min-width: 220px; }
  .qty { width: 56px; }
  .price { width: 90px; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  /* Same columns in every group */
  th:nth-child(1) { width: 30%; } th:nth-child(2) { width: 130px; } th:nth-child(5) { width: 110px; } th:nth-child(6) { width: 44px; }
  th { text-align: left; font: 600 10.5px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 4px 6px; border-bottom: 1px solid var(--line); }
  td { padding: 4px 6px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
  td input:not(.qty):not(.price) { width: 100%; box-sizing: border-box; }
  .n { text-align: right; }
  .qtycell { white-space: nowrap; }
  .qtycell button { padding: 1px 8px; font-family: var(--font-mono); }
  tr.empty td:first-child { opacity: .55; }
  .link { background: none; border: none; padding: 0; color: var(--ink); font-weight: 600; text-align: left; cursor: pointer; }
  .link:hover { color: var(--accent); background: none; }
  .none { margin: 0; color: var(--ink-3); font-size: 13.5px; }
  .projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .proj { border: 1px solid var(--line); border-left: 4px solid var(--warn-dot); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .proj.ready { border-left-color: var(--ok-dot); }
  .head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .badge { font: 600 11px var(--font-mono); color: var(--ink-3); white-space: nowrap; }
  .ready .badge { color: var(--ok); }
  ul { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
  .actions { display: flex; gap: 6px; margin-top: auto; }
  .actions button { font-size: 12px; padding: 2px 8px; }
</style>
