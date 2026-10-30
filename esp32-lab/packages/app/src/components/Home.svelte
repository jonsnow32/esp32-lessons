<script lang="ts">
  // Home: the lessons, the stock and the parts library in the header's menu, then the user's
  // projects (last edited first) and the featured projects. Each keeps its own bench and code, so
  // a card resumes where you left off.
  import { BOARDS, BREADBOARDS, FEATURED, LESSONS, PARTS } from '../lib/catalog';
  import { breadboard, breadboardBox } from '../lib/geometry';
  import BoardView from './BoardView.svelte';
  import BreadboardView from './BreadboardView.svelte';
  import CircuitThumb from './CircuitThumb.svelte';
  import Icon from './Icon.svelte';
  import TitleInput from './TitleInput.svelte';
  import { SCENE_DEFS } from '../lib/scene';
  import { lab, loadWorkspace } from '../lib/lab.svelte';
  import { inventory, itemName } from '../lib/inventory.svelte';

  const cards = LESSONS.map((l) => {
    const ws = loadWorkspace(l.id);
    const total = l.steps.length + (l.exercises?.length ?? 0);
    const done = ws ? ws.passed.filter((id) => [...l.steps, ...(l.exercises ?? [])].some((s) => s.id === id)).length : 0;
    return { lesson: l, done, total };
  });

  /** Each featured project's parts, once per type, for the chips under its title. */
  const featured = FEATURED.map((f) => {
    const seen = new Set<string>();
    const parts = f.project.parts.filter((p) => !seen.has(p.type) && seen.add(p.type));
    return { f, parts };
  });

  /** The project whose name is being edited on its card. */
  let renaming = $state<string | null>(null);

  let stocked = $derived(inventory.items.filter((i) => i.qty > 0));

  /** The user's projects with their saved bench, for the thumbnails. */
  let mine = $derived(lab.myProjects.map((p) => ({ p, ws: loadWorkspace(p.id), from: FEATURED.find((f) => f.id === p.from) })));

  /** Each part at rest, for the component cards. */
  const parts = Object.entries(PARTS).map(([type, m]) => {
    const props = Object.fromEntries(Object.entries(m.manifest.props).map(([k, s]) => [k, s.default]));
    return { type, m, svg: m.view?.(props as never, m.doc?.active ?? {}) ?? '' };
  });

  const when = (t: number) => new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

  /** The header menu's open dropdown. */
  let menu = $state<'lessons' | 'library' | null>(null);
  const toggle = (m: 'lessons' | 'library') => (menu = menu === m ? null : m);
  /** Open a detail page over home, closing the menu it was picked from. */
  const doc = (page: string) => {
    menu = null;
    lab.docPage = page;
  };
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (menu = null)} onpointerdown={(e) => !(e.target as Element).closest?.('.nav') && (menu = null)} />

<main>
  <header>
    <div class="brand">
      <h1>ESP32 Lab</h1>
      <p>Cắm linh kiện, viết code Arduino, chạy trên board giả lập.</p>
    </div>
    <nav class="nav">
      <div class="drop">
        <button onclick={() => toggle('lessons')} aria-haspopup="menu" aria-expanded={menu === 'lessons'}>Bài học <span class="meta">{LESSONS.length}</span> <Icon name="chevron-down" size={12} /></button>
        {#if menu === 'lessons'}
          <div class="panel lessons-panel" role="menu">
            <ol class="lessons">
              {#each cards as c (c.lesson.id)}
                <li>
                  <button role="menuitem" onclick={() => lab.open(c.lesson.id)}>
                    <span class="num">{c.lesson.id.slice(0, 2)}</span>
                    <span class="text">
                      <span class="title">{c.lesson.titleVi ?? c.lesson.title}</span>
                      <span class="summary">{c.lesson.summary ?? ''}</span>
                    </span>
                    <span class="progress">
                      <span class="bar"><span style="width: {(c.done / Math.max(1, c.total)) * 100}%"></span></span>
                      {c.done}/{c.total}
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
          </div>
        {/if}
      </div>
      <button onclick={() => doc('inventory')} title={stocked.length ? `Lắp được ngay ${[...inventory.featured.values()].filter((c) => c.complete).length}/${FEATURED.length} dự án mẫu` : 'Ghi lại linh kiện bạn có ngoài đời'}>
        Kho {#if stocked.length}<span class="meta">{stocked.length} loại · {stocked.reduce((n, i) => n + i.qty, 0)} món</span>{/if}
      </button>
      <div class="drop">
        <button onclick={() => toggle('library')} aria-haspopup="menu" aria-expanded={menu === 'library'}>Thư viện <Icon name="chevron-down" size={12} /></button>
        {#if menu === 'library'}
          <div class="panel library-panel" role="menu">
            <h3>Linh kiện</h3>
            <div class="parts">
              {#each parts as { type, m, svg } (type)}
                <button class="part" role="menuitem" onclick={() => doc(type)}>
                  <svg viewBox={m.icon ?? '-1 -3 6 6.5'}>{@html svg}</svg>
                  <span>{m.manifest.name}</span>
                </button>
              {/each}
            </div>
            <h3>Board và breadboard</h3>
            <div class="parts">
              {#each Object.entries(BOARDS) as [type, b] (type)}
                {@const right = Math.max(...b.pins.map((p) => p.x))}
                <button class="part" role="menuitem" onclick={() => doc(`board:${type}`)}>
                  <svg viewBox="-1.6 -3.9 {right + 3.2} {b.height + 3.4}"><BoardView board={b} net={new Set()} observables={{}} pinFill={() => 'url(#gold)'} pinHint={() => ''} onpress={() => {}} onrelease={() => {}} /></svg>
                  <span>{b.name.replace(/ \(.*/, '')}</span>
                </button>
              {/each}
              {#each Object.entries(BREADBOARDS) as [type, d] (type)}
                {@const bx = breadboardBox(type)!}
                <button class="part" role="menuitem" onclick={() => doc(`bb:${type}`)}>
                  <svg viewBox="{bx.x - 0.3} {bx.y - 0.3} {bx.w + 0.6} {bx.h + 0.6}"><BreadboardView id={type} bb={breadboard(type)!} net={new Set()} here={null} /></svg>
                  <span>{d.name}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </nav>
  </header>
  <svg width="0" height="0" style="position: absolute"><defs>{@html SCENE_DEFS}</defs></svg>

  <h2>Dự án của tôi</h2>
  <div class="row">
    {#each mine as { p, ws, from } (p.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="card project trace" role="button" tabindex="0" onclick={() => renaming !== p.id && lab.open(p.id)} onkeydown={(e) => e.key === 'Enter' && renaming !== p.id && lab.open(p.id)}>
        <span class="thumb">{#if ws}<CircuitThumb project={ws.project} />{/if}</span>
        {#if renaming === p.id}
          <span class="title"><TitleInput value={p.title} onsave={(t) => lab.renameMyProject(p.id, t)} ondone={() => (renaming = null)} /></span>
        {:else}
          <span class="title">{p.title}</span>
        {/if}
        <span class="summary">{from ? `Từ "${from.title}". ` : ''}Sửa lần cuối {when(p.updated)}.</span>
        <span class="actions">
          <button title="Đổi tên" onclick={(e) => { e.stopPropagation(); renaming = p.id; }} ><Icon name="edit" size={14} />Đổi tên</button>
          <button title="Xoá dự án" onclick={(e) => { e.stopPropagation(); if (confirm(`Xoá "${p.title}"? Mạch và code của dự án này sẽ mất.`)) lab.deleteMyProject(p.id); }} class="danger"><Icon name="trash" size={14} />Xoá</button>
        </span>
      </div>
    {/each}
    <button class="card free" onclick={() => lab.newMyProject()}>
      <span class="thumb blank"><Icon name="bench" size={44} /></span>
      <span class="title">Tạo bàn làm việc mới</span>
    </button>
  </div>

  <h2>Dự án mẫu</h2>

  <div class="grid">
    {#each featured as { f, parts } (f.id)}
      {@const c = inventory.featured.get(f.id)!}
      <button class="card project" onclick={() => lab.open(f.id)}>
        <span class="thumb"><CircuitThumb project={f.project} /></span>
        <span class="title">{f.title}</span>
        <span class="summary">{f.summary}</span>
        <span class="chips">{#each parts as p (p.id)}<span>{PARTS[p.type]!.manifest.name.replace(/ \(.*\)$/, '')}</span>{/each}</span>
        {#if inventory.items.length}
          <span class="have" class:ready={c.complete} title={c.lines.filter((l) => l.missing).map((l) => `Thiếu ${l.missing} × ${itemName(l)}`).join('\n')}>
            {c.complete ? 'Đủ linh kiện trong kho ✓' : `Kho có ${c.haveCount}/${c.needCount} loại cần dùng`}
          </span>
        {/if}
      </button>
    {/each}
  </div>

</main>

<style>
  main { max-width: 1120px; margin: 0 auto; padding: 40px 24px; }
  /* Title block, like the corner of a schematic sheet */
  header { display: flex; align-items: center; justify-content: space-between; gap: 10px 24px; flex-wrap: wrap; margin-bottom: 24px; }
  .brand { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; border-left: 4px solid var(--accent); padding: 2px 0 2px 14px; }
  header h1 { font-size: 22px; font-weight: 700; letter-spacing: -.01em; margin: 0; }
  header p { color: var(--ink-3); margin: 0; font-size: 13.5px; }
  h2 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); padding-bottom: 7px; border-bottom: 1px solid var(--line); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; text-align: left; padding: 16px 18px; border-radius: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; min-height: 190px; }
  .card:hover { background-color: var(--surface); }
  .num { font: 700 12px var(--font-mono); color: var(--accent); background: var(--accent-soft); border: 1px solid #f1c7a6; border-radius: 0; padding: 1px 7px; letter-spacing: .04em; }
  .title { font-size: 16.5px; font-weight: 700; line-height: 1.3; }
  .summary { font-size: 13.5px; color: var(--ink-3); line-height: 1.5; flex: 1; }
  .progress { display: flex; align-items: center; gap: 8px; font: 11.5px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-3); width: 100%; }
  /* Bar graph: lit segments over a dark track */
  .bar { flex: 1; height: 6px; border-radius: 0; background: var(--surface-3); box-shadow: inset 0 0 0 1px var(--line-soft); overflow: hidden; }
  .bar span { display: block; height: 100%; background: repeating-linear-gradient(90deg, var(--ok-dot) 0 7px, transparent 7px 9px); }
  h2:not(:first-of-type) { margin-top: 36px; }
  .project { padding: 0 0 16px; overflow: hidden; }
  .project > :not(.thumb) { margin: 0 18px; }
  .thumb { display: block; width: 100%; height: 150px; padding: 8px; box-sizing: border-box; background-color: var(--bg); background-image: linear-gradient(#0000000a 1px, transparent 1px), linear-gradient(90deg, #0000000a 1px, transparent 1px); background-size: 12px 12px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  /* Card actions sit on a strip along the bottom edge, like the controls under an instrument display */
  .project:has(> .actions) { padding-bottom: 0; }
  .project > .actions { display: flex; align-items: stretch; gap: 0; width: 100%; margin: 4px 0 0; border-top: 1px solid var(--line-soft); }
  .actions button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 8px; border: none; font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); background: transparent; }
  .actions button + button { border-left: 1px solid var(--line-soft); }
  .actions button:hover { color: var(--ink); background-color: var(--surface-2); }
  .actions .danger:hover { --trace: var(--error); color: var(--error); background-color: var(--error-soft); }
  /* New bench: an empty bench where the thumbnail would be, the copper + says it is to be made */
  .free { padding: 0 0 16px; }
  .free > .title { margin: 0 18px; }
  .thumb.blank { display: flex; align-items: center; justify-content: center; color: var(--ink-4); background-color: var(--surface-2); outline: 1px dashed var(--line-strong); outline-offset: -9px; }
  .free:hover .thumb.blank { color: var(--signal); outline-color: var(--signal); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chips span { font: 10.5px var(--font-mono); color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); border-radius: 0; padding: 0 5px; }
  .parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .part { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px; border: 1px solid var(--line); background: var(--surface); text-align: center; }
  .part svg { width: 100%; height: 76px; background-color: var(--bg); background-image: linear-gradient(#0000000a 1px, transparent 1px), linear-gradient(90deg, #0000000a 1px, transparent 1px); background-size: 8px 8px; border: 1px solid var(--line-soft); }
  .part span { font-size: 12px; font-weight: 600; line-height: 1.3; }
  .part:hover { border-color: var(--accent); background-color: var(--surface); }
  .meta { font: 11.5px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-3); white-space: nowrap; }
  .row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
  .row > .card { flex: 0 0 220px; min-height: 0; }
  .row .thumb { height: 110px; }
  /* Header menu: lessons and the library drop down, the stock opens its page */
  .nav { display: flex; gap: 6px; }
  .drop { position: relative; }
  .nav button[aria-expanded='true'] { border-color: var(--accent); }
  .nav .meta { margin-left: 4px; }
  .panel { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; background: var(--surface); border: 1px solid var(--line-strong); border-top: 2px solid var(--accent); box-shadow: var(--shadow-float); max-height: 75vh; overflow-y: auto; }
  .lessons-panel { width: min(560px, calc(100vw - 48px)); }
  .library-panel { width: min(720px, calc(100vw - 48px)); padding: 4px 12px 12px; }
  .panel h3 { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 10px 0 8px; }
  .library-panel .parts { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
  .library-panel .part svg { height: 56px; }
  .lessons { list-style: none; margin: 0; padding: 0; }
  .lessons button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 14px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; color: var(--ink); text-align: left; cursor: pointer; }
  .lessons li:last-child button { border-bottom: 0; }
  .lessons button:hover { background: var(--surface-2); }
  .lessons .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .lessons .title { font-size: 14.5px; }
  .lessons .summary { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lessons .progress { width: 100px; flex: none; }
  @media (max-width: 760px) {
    .lessons .progress { display: none; }
  }
  .have { font: 600 11.5px var(--font-mono); color: var(--warn); }
  .have.ready { color: var(--ok); }
</style>
