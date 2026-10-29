<script lang="ts">
  // A breadboard's detail page (in a DocSheet), drawn from breadboard.json: the board, an
  // X-ray of the metal strips under the holes (touch a hole to see what it is joined to), a
  // cut-away of one strip, right and wrong ways to plug, and the sizes side by side.
  import { sch } from '@esp32lab/part-sdk';
  import { keyOf } from '@esp32lab/sim-core';
  import { BREADBOARDS, FEATURED, LESSONS } from '../lib/catalog';
  import { breadboard, breadboardBox } from '../lib/geometry';
  import { lab } from '../lib/lab.svelte';
  import { SCENE_DEFS } from '../lib/scene';
  import BreadboardView from './BreadboardView.svelte';
  import DocSheet from './DocSheet.svelte';

  /** App keys the page on it, so it is fixed for this instance. */
  const type = lab.docPage!.slice('bb:'.length);
  const bb = breadboard(type)!;
  const def = bb.def;
  const box = breadboardBox(type)!;
  const viewBox = `${box.x - 0.3} ${box.y - 0.3} ${box.w + 0.6} ${box.h + 0.6}`;
  const none = new Set<string>();

  const blockStrips = bb.strips.filter((s) => !def.rails.some((r) => s[0]!.startsWith(r.id)));
  const railStrips = bb.strips.filter((s) => def.rails.some((r) => s[0]!.startsWith(r.id)));
  const rows = def.blocks.flatMap((b) => b.rows);

  /** X-ray: each strip as a metal bar under its holes; the touched hole's strip lights up. */
  let xray = $state(true);
  let picked = $state<string | null>(blockStrips[2]?.[0] ?? null);
  let strip = $derived(picked ? bb.strips.find((s) => s.includes(picked!)) : undefined);
  let net = $derived(new Set((strip ?? []).map((h) => keyOf.hole('bb', h))));
  function bar(s: string[]) {
    const hs = s.map((n) => bb.holes.get(n)!);
    const x0 = Math.min(...hs.map((h) => h.x));
    const x1 = Math.max(...hs.map((h) => h.x));
    const y0 = Math.min(...hs.map((h) => h.y));
    const y1 = Math.max(...hs.map((h) => h.y));
    return { x: x0 - 0.36, y: y0 - 0.36, w: x1 - x0 + 0.72, h: y1 - y0 + 0.72 };
  }
  function pick(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    const h = bb.holeAt(Math.round(pt.x), Math.round(pt.y));
    if (h) picked = h.name;
  }
  let pickedLabel = $derived.by(() => {
    if (!picked || !strip) return '';
    const rail = def.rails.find((r) => picked!.startsWith(r.id));
    if (rail) return `Lỗ ${picked} thuộc thanh nguồn ${rail.polarity === '+' ? '+ (đỏ)' : '− (xanh)'}: cả ${strip.length} lỗ dọc theo vạch màu đều nối với nhau.`;
    return `Lỗ ${picked} nối với ${strip.filter((h) => h !== picked).join(', ')}: cùng cột ${picked.slice(1)}, cùng nửa breadboard.`;
  });

  /** Cut-away of one terminal strip: five holes, the spring clip under them, a leg pushed in. */
  const clip = `
    <rect x="20" y="20" width="360" height="40" fill="#f3efe6" stroke="#d3cdbf"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${52 + i * 64}" y="20" width="22" height="40" fill="#5f5a50"/>${sch.text(63 + i * 64, 14, rows[i] + '5', { size: 10, cls: 'sch-m' })}`).join('')}
    <rect x="20" y="60" width="360" height="56" fill="#ece7dc" stroke="#d3cdbf"/>
    <path d="M40,78 H360 V104 H40 Z" fill="#c9ccd1" stroke="#7d828a"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${54 + i * 64},64 L${58 + i * 64},96 M${72 + i * 64},64 L${68 + i * 64},96" stroke="#7d828a" stroke-width="3" fill="none"/>`).join('')}
    <path d="M127,-6 V92" stroke="#a7adb4" stroke-width="5"/><path d="M191,-6 V92" stroke="#a7adb4" stroke-width="5"/>
    ${sch.flow([135, 120], [185, 120], '', 'sch-s')}
    ${sch.callout([360, 92], [392, 92], 'Thanh đồng (1 dải)')}
    ${sch.callout([70, 70], [392, 40], 'Lá kẹp đàn hồi')}
    ${sch.callout([191, 2], [392, 6], 'Chân linh kiện')}
    ${sch.text(160, 140, 'dòng đi qua thanh đồng', { cls: 'sch-s', size: 10 })}`;

  /** A tiny breadboard patch: 6 columns, two blocks of 5 rows, with something plugged in. */
  function patch(ox: number, title: string, good: boolean, legs: [number, number][], body: string, joined: [number, number][]): string {
    const hx = (c: number) => ox + 16 + c * 16;
    const hy = (r: number) => 30 + (r < 5 ? r : r + 2) * 16;
    let s = `<rect x="${ox}" y="18" width="112" height="208" fill="#f6f3ec" stroke="#d3cdbf"/><rect x="${ox}" y="${hy(4) + 9}" width="112" height="16" fill="#e3ddcf"/>`;
    for (const [c, r0] of joined) s += `<rect x="${hx(c) - 6}" y="${hy(r0) - 6}" width="12" height="${16 * 4 + 12}" fill="var(--signal)" opacity="0.25"/>`;
    for (let c = 0; c < 6; c++) for (let r = 0; r < 10; r++) s += `<rect x="${hx(c) - 3}" y="${hy(r) - 3}" width="6" height="6" fill="#4a4740"/>`;
    s += body.replace(/\{(\d+),(\d+)\}/g, (_, c, r) => `${hx(+c)},${hy(+r)}`);
    for (const [c, r] of legs) s += `<circle cx="${hx(c)}" cy="${hy(r)}" r="4" fill="#a7adb4" stroke="#6f767e"/>`;
    s += `<circle cx="${ox + 56}" cy="248" r="11" fill="${good ? 'var(--ok-dot)' : 'var(--error)'}"/>${sch.text(ox + 56, 252, good ? '✓' : '✕', { size: 12, cls: 'sch-chip-t' })}`;
    s += sch.text(ox + 56, 276, title, { cls: 'sch-ui', size: 10.5 });
    return s;
  }
  const patches =
    patch(10, 'LED cắm ở hai cột', true, [[1, 2], [2, 2]], `<path d="M{1,2} L{1,1} M{2,2} L{2,1}" stroke="#a7adb4" stroke-width="2.5"/><path d="M{1,1} m-6,-2 a10,10 0 0 1 28,0 v4 h-28 z" fill="#e5484d" opacity="0.85"/>`, [[1, 0], [2, 0]]) +
    patch(140, 'Hai chân cùng cột: chập', false, [[2, 1], [2, 3]], `<path d="M{2,1} L{2,3}" stroke="#a7adb4" stroke-width="2.5"/><path d="M{2,2} m-7,-6 h14 v12 h-14 z" fill="#e5484d" opacity="0.85"/>`, [[2, 0]]) +
    patch(270, 'Nút nhấn vắt qua rãnh', true, [[1, 4], [3, 4], [1, 5], [3, 5]], `<path d="M{1,4} m-5,-5 h42 v58 h-42 z" fill="#2a2d31" opacity="0.9"/>`, [[1, 0], [3, 0], [1, 5], [3, 5]]);

  /** Every breadboard at the same scale. */
  const lineup = Object.keys(BREADBOARDS).map((id) => ({ id, bx: breadboardBox(id)!, ex: breadboard(id)! }));
  const stacked = lineup.map((l, i) => ({ ...l, y: lineup.slice(0, i).reduce((y, o) => y + o.bx.h + 2.2, 0) }));
  const ly = stacked.at(-1)!.y + stacked.at(-1)!.bx.h;
  const lineupW = Math.max(...lineup.map((l) => l.bx.w)) + 5;

  const uses = [
    ...LESSONS.filter((l) => l.template.breadboards.some((b) => b.type === type)).map((l) => ({ id: l.id, title: l.titleVi ?? l.title, kind: 'Bài học' })),
    ...FEATURED.filter((f) => f.project.breadboards.some((b) => b.type === type)).map((f) => ({ id: f.id, title: f.title, kind: 'Dự án mẫu' })),
  ];
  function openUse(id: string) {
    lab.docPage = null;
    lab.open(id);
  }
  const siblings = Object.entries(BREADBOARDS).map(([id, b]) => ({ page: `bb:${id}`, name: b.name }));
  const railHoles = railStrips.reduce((n, s) => n + s.length, 0);
</script>

<DocSheet title={def.name} kind="Breadboard" {siblings}>
  <svg width="0" height="0" style="position: absolute"><defs>{@html SCENE_DEFS}</defs></svg>
  <section class="hero">
    <div class="stage">
      <svg class="bb-hero" {viewBox}><BreadboardView id="hero" {bb} net={none} here={null} /></svg>
    </div>
    <div class="intro">
      <span class="cat">Breadboard</span>
      <h1>{def.name}</h1>
      {#if def.learn}<p>{def.learn.summary}</p>{/if}
    </div>
  </section>

  <section>
    <h2>Thông số</h2>
    <dl class="specs">
      <div><dt>Tổng số lỗ</dt><dd>{bb.holes.size}</dd></div>
      <div><dt>Cột × hàng</dt><dd>{def.columns} × {rows.length} ({rows[0]}–{rows.at(-1)})</dd></div>
      <div><dt>Dải 5 lỗ</dt><dd>{blockStrips.length} dải</dd></div>
      <div><dt>Thanh nguồn</dt><dd>{def.rails.length ? `${def.rails.length} thanh, ${railHoles} lỗ` : 'không có'}</dd></div>
      <div><dt>Khoảng cách lỗ</dt><dd>2,54 mm (0,1 inch)</dd></div>
      <div><dt>Kích thước</dt><dd>≈ {Math.round(box.w * 2.54)} × {Math.round(box.h * 2.54)} mm</dd></div>
      <div><dt>Cỡ dây / chân</dt><dd>0,3–0,8 mm (AWG 20–29)</dd></div>
    </dl>
  </section>

  <section>
    <h2>Bên trong: lỗ nào nối với lỗ nào?</h2>
    <div class="toolbar">
      <span class="seg"><button class:on={!xray} onclick={() => (xray = false)}>Mặt trên</button><button class:on={xray} onclick={() => (xray = true)}>Nhìn xuyên</button></span>
      <span class="hint">Chạm một lỗ bất kỳ để xem các lỗ nối với nó.</span>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg class="xray" {viewBox} onpointerdown={pick}>
      <BreadboardView id="bb" {bb} {net} here={picked} />
      {#if xray}
        <g class="strips">
          {#each blockStrips as s (s[0])}{@const r = bar(s)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="0.15" class="metal" class:lit={s === strip} />{/each}
          {#each railStrips as s (s[0])}{@const r = bar(s)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="0.15" class="metal rail" class:lit={s === strip} />{/each}
        </g>
      {/if}
    </svg>
    <p class="caption">{pickedLabel}</p>
    <div class="facts">
      <div><b>Hàng {def.blocks.map((b) => `${b.rows[0]}–${b.rows.at(-1)}`).join(' và ')}</b><span>Mỗi cột có một dải kim loại 5 lỗ chạy dọc: cắm hai chân vào cùng dải là chúng được nối với nhau.</span></div>
      {#if def.blocks.length > 1}<div><b>Rãnh giữa</b><span>Ngăn cách hai nửa: lỗ {def.blocks[0]!.rows.at(-1)}5 và {def.blocks[1]!.rows[0]}5 không nối với nhau. Nút nhấn và IC cắm vắt qua đây.</span></div>{/if}
      {#if def.rails.length}<div><b>Thanh nguồn + / −</b><span>Chạy dọc theo cạnh dài. Đưa 3V3 vào thanh + và GND vào thanh − để chia điện cho cả bàn.</span></div>{/if}
    </div>
  </section>

  <div class="figs">
    <section class="fig">
      <h2><span class="fig-n">Hình 1</span>Một dải kim loại, nhìn cắt ngang</h2>
      <svg class="drawing" viewBox="0 -14 520 166">{@html clip}</svg>
      <p class="caption">Dưới mỗi nhóm 5 lỗ là một lá đồng có 5 cặp lá kẹp. Chân linh kiện cắm xuống bị kẹp chặt, và dòng điện đi qua lá đồng sang các chân khác cùng dải.</p>
    </section>
    <section class="fig">
      <h2><span class="fig-n">Hình 2</span>Cắm đúng và cắm sai</h2>
      <svg class="drawing" viewBox="0 0 392 290">{@html patches}</svg>
      <p class="caption">Vùng xanh là các lỗ được nối với chân linh kiện. Hai chân của LED phải ở hai cột khác nhau, nếu không dòng điện đi tắt qua lá đồng mà không qua LED. Nút nhấn cắm vắt qua rãnh giữa để bốn chân nằm ở bốn dải riêng.</p>
    </section>
    <section class="fig wide">
      <h2><span class="fig-n">Hình 3</span>So sánh kích thước</h2>
      <svg class="drawing lineup" viewBox="-0.5 -0.5 {lineupW} {ly}">
        {#each stacked as l (l.id)}
          <g transform="translate({-l.bx.x} {l.y - l.bx.y})" opacity={l.id === type ? 1 : 0.5}>
            <BreadboardView id={l.id} bb={l.ex} net={none} here={null} />
          </g>
          {#if l.id === type}<rect x="-0.3" y={l.y - 0.3} width={l.bx.w + 0.6} height={l.bx.h + 0.6} fill="none" stroke="var(--accent-hi)" stroke-width="0.15" />{/if}
          <text x={l.bx.w + 0.6} y={l.y + l.bx.h / 2} class="lineup-t">{l.ex.holes.size} lỗ</text>
        {/each}
      </svg>
      <p class="caption">Vẽ cùng tỉ lệ. Lỗ cách đều 2,54 mm trên mọi loại, nên linh kiện và dây cắm được ở bất kỳ breadboard nào; chỉ khác số cột và có hay không có thanh nguồn.</p>
    </section>
  </div>

  {#if def.learn?.tips?.length}
    <section>
      <h2>Mẹo</h2>
      <ul class="tips">{#each def.learn.tips as t}<li>{t}</li>{/each}</ul>
    </section>
  {/if}

  {#if uses.length}
    <section>
      <h2>Dùng trong</h2>
      <div class="uses">{#each uses as u}<button onclick={() => openUse(u.id)}><span>{u.kind}</span>{u.title} →</button>{/each}</div>
    </section>
  {/if}
</DocSheet>

<style>
  .stage { flex-direction: column; }
  .bb-hero { width: 100%; max-height: 300px; filter: drop-shadow(0 3px 4px #0000002a); }
  .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .seg { display: flex; }
  .seg button { font: 11.5px var(--font-mono); padding: 3px 10px; margin-left: -1px; }
  .seg button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .hint { font-size: 12px; color: var(--ink-3); }
  .xray { width: 100%; height: auto; display: block; cursor: crosshair; background: var(--bg); border: 1px solid var(--line-soft); touch-action: none; }
  .strips { pointer-events: none; }
  .metal { fill: #9aa3ad; opacity: 0.6; stroke: #7d828a; stroke-width: 0.04; mix-blend-mode: multiply; }
  .metal.rail { fill: #d9b8b8; }
  .metal.lit { fill: var(--signal); opacity: 0.7; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; }
  .facts div { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--line-soft); font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
  .facts b { font: 600 11px var(--font-mono); text-transform: uppercase; letter-spacing: .05em; color: var(--ink); }
  .lineup { max-height: 460px; }
  .lineup-t { font: 600 0.8px var(--font-mono); fill: var(--ink-2); dominant-baseline: middle; }
</style>
