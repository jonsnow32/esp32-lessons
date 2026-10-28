<script lang="ts">
  // Selected part: editable props from its manifest and live observables from the solver.
  import { PARTS } from '../lib/catalog';
  import { lab } from '../lib/lab.svelte';

  let part = $derived(lab.selection?.kind === 'part' ? lab.part(lab.selection.id) : undefined);
  let manifest = $derived(part ? PARTS[part.type]?.manifest : undefined);
  let obs = $derived(part ? lab.observables[part.id] ?? {} : {});

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
      <button onclick={() => lab.rotateSelected()}>Xoay (R)</button>
      <button onclick={() => lab.deleteSelected()}>Xoá (Del)</button>
    </div>
  </section>
{:else if lab.selection?.kind === 'wire'}
  <section><h2>Dây nối</h2><button onclick={() => lab.deleteSelected()}>Xoá dây (Del)</button></section>
{/if}

<style>
  section { padding: 10px 12px; border-bottom: 1px solid #e4e2dd; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  .type { font-weight: 400; color: #8b8d98; font-size: 12px; }
  label { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin: 4px 0; }
  .range { display: flex; align-items: center; gap: 6px; }
  .range input { width: 120px; }
  .range output { font-family: ui-monospace, monospace; font-size: 12px; min-width: 3.5em; text-align: right; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 12px; margin: 8px 0; }
  dt { color: #8b8d98; } dd { margin: 0; font-family: ui-monospace, monospace; }
  .bad { color: #e5484d; font-weight: 700; }
  .actions { display: flex; gap: 6px; }
  .learn { font-size: 12.5px; line-height: 1.5; background: #f6f8ff; border: 1px solid #dfe6ff; border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
  .learn p { margin: 0 0 6px; }
  .learn ul { margin: 2px 0 6px; padding-left: 18px; }
</style>
