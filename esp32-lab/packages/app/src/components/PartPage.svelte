<script lang="ts">
  // A part's detail page (in a DocSheet): the part large at rest and at work, its
  // pinout, safe limits, and the drawings from its doc (inside view, wiring, curves, timing).
  // Props picked here only change the drawings, never the bench.
  import type { PartProps, Ratings } from '@esp32lab/part-sdk';
  import { FEATURED, LESSONS, PARTS } from '../lib/catalog';
  import { lab } from '../lib/lab.svelte';
  import { SCENE_DEFS } from '../lib/scene';
  import DocChart from './DocChart.svelte';
  import DocSheet from './DocSheet.svelte';
  import DocTiming from './DocTiming.svelte';

  /** App keys the page on the part type, so it is fixed for this instance. */
  const type = lab.docPage!;

  const m = PARTS[type]!;
  const manifest = m.manifest;
  const CATEGORY: Record<string, string> = { passive: 'Linh kiện thụ động', output: 'Đầu ra', input: 'Đầu vào', sensor: 'Cảm biến', display: 'Hiển thị', power: 'Nguồn', mcu: 'Vi điều khiển', instrument: 'Thiết bị đo' };

  let props = $state<PartProps>(Object.fromEntries(Object.entries(manifest.props).map(([k, s]) => [k, s.default])));
  let specs = $derived(m.doc?.specs(props as never) ?? []);
  let figures = $derived(m.doc?.figures(props as never) ?? []);

  /**
   * The part's drawn extent at rest (the library icon frame is cropped tight on purpose), measured
   * once it is on screen and again whenever the props change its shape.
   */
  const [ix, iy, iw, ih] = (m.icon ?? '-1 -3 6 6.5').split(' ').map(Number) as [number, number, number, number];
  let box = $state({ x: ix, y: iy, w: iw, h: ih });
  function measure(g: SVGGElement, _props: unknown) {
    const fit = () => {
      const b = g.getBBox();
      if (b.width && b.height) box = { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    fit();
    return { update: fit };
  }
  let pad = $derived(Math.max(box.w, box.h) * 0.12);
  let heroBox = $derived(`${box.x - pad} ${box.y - pad} ${box.w + 2 * pad} ${box.h + 2 * pad}`);

  /** Pinout: a numbered tag per leg, above the part for legs on its top row, below otherwise. */
  const top = Math.min(...manifest.terminals.map((t) => t.dy));
  const bottom = Math.max(...manifest.terminals.map((t) => t.dy));
  let pins = $derived(
    manifest.terminals.map((t, i) => {
      const up = t.dy === top && top !== bottom;
      return { ...t, n: i + 1, ty: up ? box.y - 0.75 : box.y + box.h + 0.75, up };
    }),
  );
  let anyUp = $derived(pins.some((p) => p.up));
  let pinBox = $derived(`${box.x - 0.5} ${box.y - (anyUp ? 1.4 : 0.4)} ${box.w + 1} ${box.h + (anyUp ? 1.4 : 0.4) + 1.4}`);

  /** Rating bars: the working range, the overstressed range, and instant destruction. */
  function limits(r: Ratings | undefined) {
    if (!r) return [];
    const out: { label: string; ok: number; over?: number; end: number; unit: string }[] = [];
    if (r.currentMax !== undefined) out.push({ label: 'Dòng điện', ok: r.currentMax, over: r.currentAbsMax, end: (r.currentAbsMax ?? r.currentMax) * 1.25, unit: 'A' });
    if (r.powerMax !== undefined) out.push({ label: 'Công suất', ok: r.powerMax, end: r.powerMax * 1.6, unit: 'W' });
    if (r.reverseVoltageMax !== undefined) out.push({ label: 'Điện áp ngược', ok: r.reverseVoltageMax, end: r.reverseVoltageMax * 1.6, unit: 'V' });
    return out;
  }
  const bars = limits(manifest.ratings);
  const si = (v: number, unit: string) => (v < 1 ? `${+(v * 1000).toPrecision(3)} m${unit}` : `${+v.toPrecision(3)} ${unit}`).replace('.', ',');
  const overstress = manifest.ratings?.overstressTime;
  const survive = overstress === undefined ? '' : overstress >= 1e9 ? `${+(overstress / 1e9).toPrecision(2)} giây` : `${+(overstress / 1e6).toPrecision(2)} ms`;

  const uses = [
    ...LESSONS.filter((l) => JSON.stringify(l).includes(`"type":"${type}"`)).map((l) => ({ id: l.id, title: l.titleVi ?? l.title, kind: 'Bài học' })),
    ...FEATURED.filter((f) => f.project.parts.some((p) => p.type === type)).map((f) => ({ id: f.id, title: f.title, kind: 'Dự án mẫu' })),
  ];

  function openUse(id: string) {
    lab.docPage = null;
    lab.open(id);
  }
  const siblings = Object.entries(PARTS).map(([t, p]) => ({ page: t, name: p.manifest.name }));
</script>

<DocSheet title={manifest.name} kind="Linh kiện" {siblings}>
  <section class="hero">
    <div class="stage">
      <figure>
        <svg viewBox={heroBox}><defs>{@html SCENE_DEFS}</defs><g use:measure={{ ...props }}>{@html m.view?.(props as never, {}) ?? ''}</g></svg>
        <figcaption>Lúc nghỉ</figcaption>
      </figure>
      {#if m.doc?.active}
        <span class="arrow">→</span>
        <figure class="on">
          <svg viewBox={heroBox} overflow="visible">{@html m.view?.(props as never, m.doc.active) ?? ''}</svg>
          <figcaption>Đang hoạt động</figcaption>
        </figure>
      {/if}
    </div>
    <div class="intro">
      <span class="cat">{CATEGORY[manifest.category] ?? manifest.category}</span>
      <h1>{manifest.name}</h1>
      {#if manifest.learn}<p>{manifest.learn.summary}</p>{/if}
      {#if manifest.tags?.length}<div class="tags">{#each manifest.tags as t}<span>{t}</span>{/each}</div>{/if}
      {#if Object.keys(manifest.props).length}
        <div class="props">
          <b>Thử thay đổi</b>
          {#each Object.entries(manifest.props) as [key, schema] (key)}
            <label>
              <span>{key}</span>
              {#if schema.type === 'enum'}
                <span class="seg">{#each schema.options as o}<button class:on={props[key] === o} onclick={() => (props[key] = o)}>{o}</button>{/each}</span>
              {:else if schema.type === 'number' && schema.options}
                <span class="seg">{#each schema.options as o}<button class:on={props[key] === o} onclick={() => (props[key] = o)}>{o >= 1000 ? `${o / 1000}k` : o}{schema.unit ?? ''}</button>{/each}</span>
              {:else if schema.type === 'number'}
                <span class="range">
                  <input type="range" min={schema.min ?? 0} max={schema.max ?? 100} value={Number(props[key])} oninput={(e) => (props[key] = Number(e.currentTarget.value))} />
                  <output>{props[key]}{schema.unit ?? ''}</output>
                </span>
              {:else}
                <span class="seg"><button class:on={!props[key]} onclick={() => (props[key] = false)}>không</button><button class:on={!!props[key]} onclick={() => (props[key] = true)}>có</button></span>
              {/if}
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  {#if specs.length}
    <section>
      <h2>Thông số</h2>
      <dl class="specs">{#each specs as [k, v]}<div><dt>{k}</dt><dd>{v}</dd></div>{/each}</dl>
    </section>
  {/if}

  <div class="two">
    <section>
      <h2>Sơ đồ chân</h2>
      <div class="pinout">
        <svg viewBox={pinBox}>
          {@html m.view?.(props as never, {}) ?? ''}
          {#each pins as p}
            <line class="lead" x1={p.dx} y1={p.dy} x2={p.dx} y2={p.ty + (p.up ? 0.32 : -0.32)} />
            <circle class="leg" cx={p.dx} cy={p.dy} r="0.2" />
            <circle class="tag" cx={p.dx} cy={p.ty} r="0.32" />
            <text class="tag-n" x={p.dx} y={p.ty + 0.13}>{p.n}</text>
          {/each}
        </svg>
        <ol>
          {#each pins as p}<li><span class="n">{p.n}</span><code>{p.name}</code>{#if p.label}<span>{p.label}</span>{/if}</li>{/each}
        </ol>
      </div>
      <p class="note">Các chân cách nhau 2,54 mm, đúng bằng khoảng cách hai lỗ breadboard.</p>
    </section>

    <section>
      <h2>Giới hạn an toàn</h2>
      {#if bars.length}
        {#each bars as b}
          <div class="limit">
            <div class="limit-head"><span>{b.label}</span><b>tối đa {si(b.ok, b.unit)}{#if b.over} · cháy ngay ở {si(b.over, b.unit)}{/if}</b></div>
            <div class="meter">
              <span class="ok" style="width: {(b.ok / b.end) * 100}%"></span>
              <span class="over" style="width: {(((b.over ?? b.end) - b.ok) / b.end) * 100}%"></span>
              {#if b.over}<span class="burn" style="width: {((b.end - b.over) / b.end) * 100}%"></span>{/if}
            </div>
            <div class="scale"><span>0</span><span style="left: {(b.ok / b.end) * 100}%">{si(b.ok, b.unit)}</span>{#if b.over}<span style="left: {(b.over / b.end) * 100}%">{si(b.over, b.unit)}</span>{/if}</div>
          </div>
        {/each}
        <div class="key"><span><i class="ok"></i>Hoạt động bình thường</span><span><i class="over"></i>Quá tải{#if survive}: hỏng sau ~{survive}{/if}</span>{#if bars.some((b) => b.over)}<span><i class="burn"></i>Hỏng ngay</span>{/if}</div>
      {:else}
        <p class="note">Linh kiện này không bị hỏng trong phòng thí nghiệm ảo, nhưng ngoài đời vẫn cần cấp đúng điện áp và đúng chân.</p>
      {/if}
    </section>
  </div>

  {#if figures.length}
    <div class="figs">
      {#each figures as fig, i (fig.title)}
        <section class="fig" class:wide={fig.kind === 'timing'}>
          <h2><span class="fig-n">Hình {i + 1}</span>{fig.title}</h2>
          {#if fig.kind === 'svg'}
            <svg class="drawing" viewBox={fig.viewBox}>{@html fig.svg}</svg>
          {:else if fig.kind === 'chart'}
            <DocChart x={fig.x} y={fig.y} series={fig.series} marks={fig.marks} />
          {:else}
            <DocTiming end={fig.end} signals={fig.signals} spans={fig.spans} />
          {/if}
          {#if fig.caption}<p class="caption">{fig.caption}</p>{/if}
        </section>
      {/each}
    </div>
  {/if}

  {#if manifest.learn}
    <div class="two">
      <section>
        <h2>Cách cắm</h2>
        <ol class="steps">{#each manifest.learn.howToPlug as t}<li>{t}</li>{/each}</ol>
      </section>
      {#if manifest.learn.tips?.length}
        <section>
          <h2>Mẹo</h2>
          <ul class="tips">{#each manifest.learn.tips as t}<li>{t}</li>{/each}</ul>
        </section>
      {/if}
    </div>
  {/if}

  {#if uses.length}
    <section>
      <h2>Dùng trong</h2>
      <div class="uses">{#each uses as u}<button onclick={() => openUse(u.id)}><span>{u.kind}</span>{u.title} →</button>{/each}</div>
    </section>
  {/if}
</DocSheet>

<style>
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tags span { font: 10.5px var(--font-mono); color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); padding: 0 6px; }
  .props { margin-top: 4px; padding: 10px 12px; background: var(--surface-2); border: 1px dashed var(--line-strong); display: flex; flex-direction: column; gap: 6px; }
  .props b { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-2); }
  .props label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font: 12px var(--font-mono); color: var(--ink-2); }
  .seg { display: flex; flex-wrap: wrap; justify-content: flex-end; }
  .seg button { font: 11.5px var(--font-mono); padding: 2px 8px; margin-left: -1px; }
  .seg button.on { background: var(--accent); border-color: var(--accent); color: #fff; position: relative; }
  .range { display: flex; align-items: center; gap: 8px; }
  .range input { width: 150px; padding: 0; }
  .range output { min-width: 4.5em; text-align: right; font-variant-numeric: tabular-nums; color: var(--ink); }
  .pinout { display: flex; gap: 16px; align-items: center; }
  .pinout svg { flex: 0 0 46%; max-height: 260px; background: var(--surface-2); border: 1px solid var(--line-soft); }
  .lead { stroke: var(--signal); stroke-width: 0.04; stroke-dasharray: 0.1 0.08; }
  .leg { fill: none; stroke: var(--signal); stroke-width: 0.06; }
  .tag { fill: var(--signal); }
  .tag-n { fill: #fff; font: 700 0.36px var(--font-mono); text-anchor: middle; }
  .pinout ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .pinout li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .n { width: 20px; height: 20px; border-radius: 50%; background: var(--signal); color: #fff; font: 700 11px var(--font-mono); display: inline-flex; align-items: center; justify-content: center; }
  code { font: 600 12px var(--font-mono); background: var(--signal-soft); color: var(--signal); padding: 0 5px; }
  @media (max-width: 860px) {
    .pinout { flex-direction: column; align-items: stretch; }
  }
</style>
