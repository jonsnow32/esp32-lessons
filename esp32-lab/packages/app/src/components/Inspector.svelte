<script lang="ts">
  // Selected part: editable props from its manifest and live observables from the solver.
  // Selected breadboard or board: what it is, and what can be done with it.
  // Several things selected: how many of what, and what can be done with them all.
  import { BOARDS, PARTS } from '../lib/catalog';
  import { breadboard } from '../lib/geometry';
  import { lab } from '../lib/lab.svelte';

  let part = $derived(lab.selection?.kind === 'part' ? lab.part(lab.selection.id) : undefined);
  let manifest = $derived(part ? PARTS[part.type]?.manifest : undefined);
  let obs = $derived(part ? lab.observables[part.id] ?? {} : {});
  let bbInst = $derived(lab.selection?.kind === 'breadboard' ? lab.project.breadboards.find((b) => b.id === (lab.selection as { id: string }).id) : undefined);
  let bb = $derived(bbInst && breadboard(bbInst.type));
  let plugged = $derived(bbInst ? lab.project.parts.filter((p) => p.placement?.bb === bbInst!.id).length : 0);

  function fmt(key: string, v: unknown): string {
    if (typeof v !== 'number') return String(v);
    if (key === 'current') return `${(v * 1000).toFixed(2)} mA`;
    if (key === 'power') return `${(v * 1000).toFixed(1)} mW`;
    if (key === 'resistance') return v >= 1000 ? `${(v / 1000).toFixed(2)} kΩ` : `${v.toFixed(0)} Ω`;
    if (key === 'brightness' || key === 'red' || key === 'green' || key === 'blue' || key === 'loudness') return `${Math.round(v * 100)} %`;
    return v.toFixed(3);
  }
</script>

{#if part && manifest}
  <section>
    <h2>{part.id} <span class="type">{manifest.name}</span></h2>
    {#each Object.entries(manifest.props) as [key, schema] (key)}
      <label>
        <span>{key}</span>
        {#if schema.type === 'enum'}
          <select value={part.props?.[key] ?? schema.default} onchange={(e) => lab.setProp(part.id, key, e.currentTarget.value)}>
            {#each schema.options as o}<option value={o}>{o}</option>{/each}
          </select>
        {:else if schema.type === 'number' && schema.options}
          <select value={String(part.props?.[key] ?? schema.default)} onchange={(e) => lab.setProp(part.id, key, Number(e.currentTarget.value))}>
            {#each schema.options as o}<option value={String(o)}>{o >= 1000 ? `${o / 1000}k` : o} {schema.unit ?? ''}</option>{/each}
          </select>
        {:else if schema.type === 'number'}
          <span class="range">
            <input type="range" min={schema.min ?? 0} max={schema.max ?? 100} step="1" value={Number(part.props?.[key] ?? schema.default)}
              oninput={(e) => lab.setProp(part.id, key, Number(e.currentTarget.value), true)} />
            <output>{part.props?.[key] ?? schema.default}{schema.unit ?? ''}</output>
          </span>
        {:else if schema.type === 'boolean'}
          <input type="checkbox" checked={Boolean(part.props?.[key] ?? schema.default)} onchange={(e) => lab.setProp(part.id, key, e.currentTarget.checked)} />
        {/if}
      </label>
    {/each}
    <dl>
      {#each Object.entries(obs) as [k, v] (k)}
        <dt>{k}</dt><dd class:bad={k === 'damaged' && v === true}>{fmt(k, v)}</dd>
      {/each}
    </dl>
    {#if manifest.learn}
      <div class="learn">
        <p>{manifest.learn.summary}</p>
        <b>Cách cắm</b>
        <ul>{#each manifest.learn.howToPlug as t}<li>{t}</li>{/each}</ul>
        {#if manifest.learn.tips?.length}
          <b>Mẹo</b>
          <ul>{#each manifest.learn.tips as t}<li>{t}</li>{/each}</ul>
        {/if}
      </div>
    {/if}
    <div class="actions">
      {#if manifest.plug}<button onclick={() => lab.autoPlug(part.id)} title="Cắm lên breadboard và nối dây tới board theo cách cắm mẫu">Cắm tự động</button>{/if}
      <button onclick={() => (lab.docPage = part.type)}>Trang chi tiết</button>
      <button onclick={() => lab.rotateSelected()}>Xoay (R)</button>
      <button onclick={() => lab.deleteSelected()}>Xoá (Del)</button>
    </div>
  </section>
{:else if lab.selection?.kind === 'wire'}
  {@const wire = lab.project.wires.find((w) => w.id === (lab.selection as { id: string }).id)}
  <section>
    <h2>Dây nối</h2>
    <p class="note">Kéo một đoạn dây để dời nó; dây luôn gấp vuông góc.</p>
    <div class="actions">
      {#if wire?.points}<button onclick={() => lab.unbendWire(wire.id)}>Gấp tự động</button>{/if}
      <button onclick={() => lab.deleteSelected()}>Xoá dây (Del)</button>
    </div>
  </section>
{:else if bbInst && bb}
  <section>
    <h2>{bbInst.id} <span class="type">{bb.def.name}</span></h2>
    <p class="note">{bb.holes.size} lỗ · kéo để di chuyển.{#if plugged} Xoá breadboard thì {plugged} linh kiện đang cắm trên nó vẫn ở lại trên bàn, nối dây trực tiếp như các thanh nối của breadboard.{/if}</p>
    <div class="actions">
      <button onclick={() => (lab.docPage = `bb:${bbInst.type}`)}>Trang chi tiết</button>
      <button onclick={() => lab.deleteSelected()}>Xoá breadboard (Del)</button>
    </div>
  </section>
{:else if lab.selection?.kind === 'group'}
  {@const items = lab.selection.items}
  {@const count = (kind: string) => items.filter((i) => i.kind === kind).length}
  <section>
    <h2>Đã chọn {items.length} mục</h2>
    <p class="note">
      {[count('part') && `${count('part')} linh kiện`, count('wire') && `${count('wire')} dây`, count('breadboard') && `${count('breadboard')} breadboard`, count('board') && 'board']
        .filter(Boolean).join(' · ')}.
      Kéo một mục để dời cả nhóm (phím mũi tên dời từng ô). Shift + bấm để thêm / bỏ, Shift + kéo chỗ trống để quét vùng.
    </p>
    <div class="actions">
      {#if count('part')}<button onclick={() => lab.rotateSelected()}>Xoay từng linh kiện (R)</button>{/if}
      {#if count('part') || count('breadboard')}<button onclick={() => lab.duplicateSelected()}>Nhân bản (Ctrl+D)</button>{/if}
      <button onclick={() => lab.deleteSelected()}>Xoá cả nhóm (Del)</button>
      <button onclick={() => (lab.selection = null)}>Bỏ chọn (Esc)</button>
    </div>
  </section>
{:else if lab.selection?.kind === 'board'}
  <section>
    <h2>Board <span class="type">{BOARDS[lab.project.board.type]?.name}</span></h2>
    <p class="note">Kéo để di chuyển. Đổi board ở mục Board bên trái: dây nối giữ nguyên theo chân GPIO.</p>
    <button onclick={() => (lab.docPage = `board:${lab.project.board.type}`)}>Sơ đồ chân và trang chi tiết</button>
  </section>
{/if}

<style>
  section { padding: 10px 12px; border-bottom: 1px solid var(--line); }
  h2 { font: 700 13px var(--font-mono); margin: 0 0 10px; display: flex; align-items: baseline; gap: 2px; flex-wrap: wrap; }
  .type { font: 400 12px var(--font-ui); color: var(--ink-3); margin-left: 6px; }
  label { display: flex; justify-content: space-between; align-items: center; font: 12px var(--font-mono); color: var(--ink-2); margin: 0; padding: 4px 0; border-bottom: 1px dotted var(--line); }
  .range { display: flex; align-items: center; gap: 6px; }
  .range input { width: 120px; }
  .range output { font: 12px var(--font-mono); font-variant-numeric: tabular-nums; min-width: 3.5em; text-align: right; color: var(--ink); }
  /* Live readings in a meter window */
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 12px; margin: 10px 0; padding: 7px 10px; background: var(--surface-2); border: 1px solid var(--line); }
  dl:empty { display: none; }
  dt { color: var(--ink-3); font-family: var(--font-mono); }
  dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; color: var(--ink); }
  .bad { color: var(--error); font-weight: 700; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .note { font-size: 12.5px; color: var(--ink-3); margin: 0 0 8px; line-height: 1.5; }
  .learn { font-size: 12.5px; line-height: 1.5; background: var(--info-soft); border: 1px solid var(--info-line); box-shadow: inset 3px 0 0 var(--info); border-radius: 0; padding: 8px 10px 8px 13px; margin: 8px 0; }
  .learn p { margin: 0 0 6px; }
  .learn b { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--info); }
  .learn ul { margin: 2px 0 6px; padding-left: 18px; }
</style>
