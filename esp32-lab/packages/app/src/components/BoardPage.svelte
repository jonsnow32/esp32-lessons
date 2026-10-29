<script lang="ts">
  // A board's detail page (in a DocSheet), drawn entirely from board.json and the ESP32 pad
  // table: the board, a pinout with every pin's functions, a pin table, the power path, the
  // circuits soldered on the board, and the boards side by side.
  import { sch } from '@esp32lab/part-sdk';
  import type { BoardDef, BoardNode, BoardPart } from '@esp32lab/project-model';
  import { BOARDS, FEATURED, LESSONS } from '../lib/catalog';
  import { lab } from '../lib/lab.svelte';
  import { CATEGORIES, pinInfo, type PinCategory, type Verdict } from '../lib/pinout';
  import { SCENE_DEFS } from '../lib/scene';
  import BoardView from './BoardView.svelte';
  import DocSheet from './DocSheet.svelte';

  /** App keys the page on it, so it is fixed for this instance. */
  const type = lab.docPage!.slice('board:'.length);
  const board = BOARDS[type]!;
  const look = { pcb: 'blue', module: 'ESP32-WROOM-32', usbChip: 'CP2102', ...board.look };
  const right = Math.max(...board.pins.map((p) => p.x));
  const rows = Math.max(...board.pins.map((p) => p.y)) + 1;
  const none = new Set<string>();
  const noop = () => {};
  /** The board's drawn extent in pitches (BoardView: PCB from −1.1, the module reaches −3.4). */
  const frame = { x: -1.6, y: -3.9, w: right + 3.2, h: board.height + 3.4 };

  const pins = board.pins.map((p) => pinInfo(board, p));
  const gpios = pins.filter((p) => p.gpio !== undefined);
  const usable = gpios.filter((p) => p.verdict !== 'avoid');
  const count = (cat: PinCategory) => pins.filter((p) => p.tags.some((t) => t.cat === cat)).length;
  const present = (Object.keys(CATEGORIES) as PinCategory[]).filter((c) => count(c) > 0);
  const name = (n: string) => n.replace(/\.[LR]\d*$/, '');
  const VERDICT: Record<Verdict, { mark: string; color: string; label: string }> = {
    ok: { mark: '✓', color: 'var(--ok-dot)', label: 'Dùng tự do' },
    care: { mark: '!', color: 'var(--warn-dot)', label: 'Dùng được, có lưu ý' },
    avoid: { mark: '✕', color: 'var(--error)', label: 'Tránh dùng' },
    supply: { mark: '⚡', color: 'var(--ink-3)', label: 'Nguồn / GND' },
  };

  /** Pinout: the board in the middle, each pin's tags fanned out on its own side. */
  let focus = $state<PinCategory | null>(null);
  const S = 26;
  const CH = 18;
  const chipW = (t: string) => t.length * 6.6 + 12;
  const sideW = (left: boolean) => Math.max(...pins.filter((p) => (p.pin.x < right / 2) === left).map((p) => p.tags.reduce((w, t) => w + chipW(t.text) + 4, 0)), 0) + 40;
  const LW = sideW(true);
  const RW = sideW(false);
  const BX = LW + 1.6 * S; // board x = 0 in pixels
  const BY = 3.9 * S;
  const pinout = pins.map((p) => {
    const left = p.pin.x < right / 2;
    const py = BY + p.pin.y * S;
    let x = left ? BX - 1.1 * S - 30 : BX + (right + 1.1) * S + 30;
    const chips = p.tags.map((t) => {
      const w = chipW(t.text);
      const cx = left ? x - w : x;
      x = left ? x - w - 4 : x + w + 4;
      return { ...t, x: cx, w };
    });
    return { ...p, left, py, px: BX + p.pin.x * S, mx: left ? BX - 1.1 * S - 15 : BX + (right + 1.1) * S + 15, chips };
  });
  const pinoutW = LW + RW + (right + 3.2) * S;
  const pinoutH = (board.height + 3.4) * S;

  // Power: USB 5 V → regulator → 3,3 V, with the header pins tapping each rail
  const usb = board.supplies.find((s) => s.net === '5V');
  const reg = board.supplies.find((s) => s.net === '3V3');
  const pin5 = name(board.pins.find((p) => 'net' in p.connect && p.connect.net === '5V')?.name ?? '5V');
  const power =
    sch.block(10, 46, 'USB', [{ name: '5V', dy: 30 }, { name: 'GND', dy: 84 }], { w: 64, h: 100 }).svg +
    sch.wire([[86, 76], [230, 76]]) +
    sch.dot(150, 76) + sch.wire([[150, 76], [150, 30]]) + `<rect class="sch-b" x="126" y="10" width="48" height="20"/>` + sch.text(150, 24, pin5, { cls: 'sch-a' }) +
    `<rect class="sch-b" x="230" y="56" width="90" height="44"/>` + sch.text(275, 74, reg?.name.split('-')[0] ?? 'LDO', { cls: 'sch-strong', size: 10 }) + sch.text(275, 90, '5 V → 3,3 V', { cls: 'sch-m', size: 9.5 }) +
    sch.wire([[275, 100], [275, 130]]) + sch.gnd(275, 130) +
    sch.wire([[320, 76], [450, 76]]) +
    sch.dot(380, 76) + sch.wire([[380, 76], [380, 30]]) + `<rect class="sch-b" x="356" y="10" width="48" height="20"/>` + sch.text(380, 24, '3V3', { cls: 'sch-a' }) +
    sch.block(450, 46, 'ESP32', [], { chip: true, w: 70, h: 64 }).svg + sch.text(485, 92, '~80–240 mA', { cls: 'sch-chip-t', size: 9 }) +
    sch.wire([[86, 130], [86, 130]]) + sch.gnd(98, 130) + sch.wire([[86, 130], [98, 130]]) +
    sch.text(118, 100, usb ? `≤ ${usb.currentMax * 1000} mA` : '', { cls: 'sch-m', size: 10 }) +
    sch.text(350, 100, reg ? `≤ ${reg.currentMax * 1000} mA` : '', { cls: 'sch-m', size: 10 });

  /** One column per soldered button or LED: what it hangs off and where it goes. */
  function endLabel(n: BoardNode): string {
    return 'pad' in n ? n.pad : 'net' in n ? n.net : n.node;
  }
  function onboardCircuit(b: BoardDef): { svg: string; w: number } {
    const cols: string[] = [];
    const resistors = b.onboard.filter((o) => o.type === 'resistor');
    for (const op of b.onboard.filter((o) => o.x !== undefined)) {
      const x = 60 + cols.length * 150;
      if (op.type === 'pushbutton') {
        const pad = endLabel(op.connect.a1!);
        const pull = resistors.find((r) => Object.values(r.connect).some((c) => 'pad' in c && c.pad === pad));
        cols.push(
          sch.supply(x, 40, '3V3') +
            sch.resistor([x, 40], [x, 96], pull ? sch.ohm(Number(pull.props?.resistance)) : '', 'kéo lên') +
            sch.dot(x, 96) + sch.wire([[x, 96], [x + 50, 96]], 'sch-s') + sch.text(x + 54, 100, pad, { anchor: 'start', cls: 'sch-s', size: 10 }) +
            sch.switchSym([x, 96], [x, 150], false, op.label?.split(' ')[0]) +
            sch.gnd(x, 150),
        );
      } else if (op.type === 'led') {
        const anode = endLabel(op.connect.anode!);
        const r = resistors.find((o) => Object.values(o.connect).some((c) => 'node' in c && c.node === anode)) as BoardPart | undefined;
        const from = r && Object.values(r.connect).find((c) => !('node' in c && c.node === anode));
        const src = from ? endLabel(from) : '3V3';
        const color = { blue: '#3e63dd', red: '#e5484d', green: '#30a46c' }[String(op.props?.color)] ?? '#3e63dd';
        cols.push(
          (src === '3V3' ? sch.supply(x, 40, '3V3') : sch.wire([[x + 50, 40], [x, 40]], 'sch-s') + sch.text(x + 54, 44, src, { anchor: 'start', cls: 'sch-s', size: 10 })) +
            sch.resistor([x, 40], [x, 96], r ? sch.ohm(Number(r.props?.resistance)) : '') +
            sch.diode([x, 96], [x, 150], { led: true, color }) +
            sch.text(x + 32, 127, op.label?.replace(/ \(.*/, '') ?? 'LED', { anchor: 'start' }) +
            sch.gnd(x, 150),
        );
      }
    }
    return { svg: cols.join(''), w: 60 + cols.length * 150 };
  }
  const onboard = onboardCircuit(board);

  /** Every board at the same scale, for the size comparison. */
  const lineup = Object.entries(BOARDS).map(([id, b]) => ({ id, b, w: Math.max(...b.pins.map((p) => p.x)) + 3.2 }));
  const placed = lineup.map((l, i) => ({ ...l, x: lineup.slice(0, i).reduce((x, o) => x + o.w + 2, 0) }));
  const lineupX = placed.at(-1)!.x + placed.at(-1)!.w;
  const lineupH = Math.max(...lineup.map((l) => l.b.height)) + 3.4 + 2.2;

  const uses = [
    ...LESSONS.filter((l) => l.template.board.type === type).map((l) => ({ id: l.id, title: l.titleVi ?? l.title, kind: 'Bài học' })),
    ...FEATURED.filter((f) => f.project.board.type === type).map((f) => ({ id: f.id, title: f.title, kind: 'Dự án mẫu' })),
  ];
  function openUse(id: string) {
    lab.docPage = null;
    lab.open(id);
  }
  const siblings = Object.entries(BOARDS).map(([id, b]) => ({ page: `board:${id}`, name: b.name }));
  const mm = (pitches: number) => Math.round(pitches * 2.54);
</script>

<DocSheet title={board.name} kind="Board" {siblings}>
  <svg width="0" height="0" style="position: absolute"><defs>{@html SCENE_DEFS}</defs></svg>
  <section class="hero">
    <div class="stage">
      <figure class="board-fig">
        <svg viewBox="{frame.x} {frame.y} {frame.w} {frame.h}">
          <BoardView {board} net={none} observables={{}} pinFill={() => 'url(#gold)'} pinHint={(p) => p} onpress={noop} onrelease={noop} />
        </svg>
      </figure>
    </div>
    <div class="intro">
      <span class="cat">Board ESP32</span>
      <h1>{board.name}</h1>
      {#if board.learn}<p>{board.learn.summary}</p>{/if}
      <div class="chips">
        <span>{board.pins.length} chân</span><span>{look.module}</span><span>USB: {look.usbChip}</span><span>PCB {look.pcb === 'black' ? 'đen' : 'xanh'}</span>
      </div>
      <div class="buttons">
        {#if lab.route !== 'home' && !lab.lesson}<button class="primary" disabled={lab.project.board.type === type} onclick={() => { lab.setBoard(type); lab.docPage = null; }}>{lab.project.board.type === type ? 'Đang dùng board này' : 'Dùng board này trên bàn'}</button>{/if}
      </div>
    </div>
  </section>

  <section>
    <h2>Thông số</h2>
    <dl class="specs">
      <div><dt>Vi điều khiển</dt><dd>ESP32 lõi kép 240 MHz</dd></div>
      <div><dt>Module</dt><dd>{look.module}</dd></div>
      <div><dt>Bộ nhớ</dt><dd>520 KB RAM · 4 MB flash</dd></div>
      <div><dt>Không dây</dt><dd>Wi-Fi 2,4 GHz · Bluetooth</dd></div>
      <div><dt>Số chân</dt><dd>{board.pins.length} ({gpios.length} GPIO)</dd></div>
      <div><dt>GPIO dùng thoải mái</dt><dd>{usable.filter((p) => p.verdict === 'ok').length} chân</dd></div>
      <div><dt>Đọc analog (ADC)</dt><dd>{count('adc1') + count('adc2')} chân ({count('adc1')} ADC1)</dd></div>
      <div><dt>Cảm ứng chạm</dt><dd>{count('touch')} chân</dd></div>
      <div><dt>Mức logic</dt><dd>3,3 V (không chịu 5 V)</dd></div>
      <div><dt>Kích thước</dt><dd>≈ {mm(right + 2.2)} × {mm(board.height + 0.6)} mm</dd></div>
    </dl>
  </section>

  <section>
    <h2>Sơ đồ chân</h2>
    <div class="legend">
      {#each present as c}
        {@const k = CATEGORIES[c]}
        <button class:on={focus === c} title={k.hint} onclick={() => (focus = focus === c ? null : c)}>
          <i style="background: {k.bg}; color: {k.fg}; border-color: {k.fg === '#fff' ? k.bg : 'var(--line-strong)'}">{k.label}</i>{count(c)}
        </button>
      {/each}
      <span class="legend-hint">Bấm một nhóm để làm nổi các chân của nó.</span>
    </div>
    <svg class="pinout" viewBox="0 0 {pinoutW} {pinoutH}">
      <g transform="translate({BX} {BY}) scale({S})">
        <BoardView {board} net={none} observables={{}} pinFill={() => 'url(#gold)'} pinHint={(p) => p} onpress={noop} onrelease={noop} />
      </g>
      {#each pinout as p (p.pin.name)}
        {@const dim = focus !== null && !p.tags.some((t) => t.cat === focus)}
        {@const v = VERDICT[p.verdict]}
        <g class="row" opacity={dim ? 0.15 : 1}>
          <title>{name(p.pin.name)}: {p.note}</title>
          <line x1={p.px} x2={p.left ? p.mx + 7 : p.mx - 7} y1={p.py} y2={p.py} class="lead" />
          <circle cx={p.mx} cy={p.py} r="7" fill={v.color} />
          <text x={p.mx} y={p.py + 3.5} class="mark">{v.mark}</text>
          {#each p.chips as c}
            {@const k = CATEGORIES[c.cat]}
            <rect x={c.x} y={p.py - CH / 2} width={c.w} height={CH} fill={k.bg} stroke={k.fg === '#fff' ? k.bg : '#aeb6bc'} />
            <text x={c.x + c.w / 2} y={p.py + 3.8} fill={k.fg} class="chip">{c.text}</text>
          {/each}
        </g>
      {/each}
    </svg>
    <div class="verdicts">
      {#each Object.values(VERDICT) as v}<span><i style="background: {v.color}">{v.mark}</i>{v.label}</span>{/each}
    </div>
  </section>

  <section>
    <h2>Bảng chân</h2>
    <table class="pins">
      <thead><tr><th>Chân</th><th>Trong code</th><th>Chức năng</th><th>Ghi chú</th></tr></thead>
      <tbody>
        {#each [...pins].sort((a, b) => (a.gpio ?? -1) - (b.gpio ?? -1)) as p (p.pin.name)}
          {@const dim = focus !== null && !p.tags.some((t) => t.cat === focus)}
          <tr class:dim>
            <td><i class="v" style="background: {VERDICT[p.verdict].color}">{VERDICT[p.verdict].mark}</i><b>{name(p.pin.name)}</b></td>
            <td><code>{p.gpio ?? '—'}</code></td>
            <td class="tags">{#each p.tags.filter((t) => t.cat !== 'gpio') as t}{@const k = CATEGORIES[t.cat]}<span style="background: {k.bg}; color: {k.fg}; border-color: {k.fg === '#fff' ? k.bg : 'var(--line-strong)'}">{t.text}</span>{/each}</td>
            <td class="note-cell">{p.note}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <div class="figs">
    <section class="fig wide">
      <h2><span class="fig-n">Hình 1</span>Đường nguồn trên board</h2>
      <svg class="drawing" viewBox="0 0 540 160">{@html power}</svg>
      <p class="caption">Cắm USB, 5 V đi thẳng ra chân {pin5} và vào ổn áp {reg?.name ?? ''}, ổn áp hạ xuống 3,3 V để nuôi chip ESP32 và ra chân 3V3. Mọi chân GPIO làm việc ở 3,3 V: đưa 5 V vào chân GPIO có thể làm hỏng chip.</p>
    </section>
    {#if onboard.svg}
      <section class="fig">
        <h2><span class="fig-n">Hình 2</span>Mạch có sẵn trên board</h2>
        <svg class="drawing" viewBox="0 0 {Math.max(onboard.w, 320)} 180">{@html onboard.svg}</svg>
        <p class="caption">Nút EN kéo chân bật chip xuống GND để reset; nút BOOT kéo GPIO0 xuống để vào chế độ nạp. Cả hai có điện trở kéo lên nên bình thường ở HIGH. {#if board.onboard.some((o) => o.type === 'led' && o.label?.includes('GPIO'))} LED trên board nối GPIO2 qua điện trở, nên digitalWrite(2, HIGH) là sáng.{/if}</p>
      </section>
    {/if}
    <section class="fig">
      <h2><span class="fig-n">Hình 3</span>Giới hạn dòng điện</h2>
      {#each board.supplies as s}
        <div class="limit">
          <div class="limit-head"><span>{s.name} ({s.net})</span><b>tối đa {s.currentMax * 1000} mA</b></div>
          <div class="meter"><span class="ok" style="width: 70%"></span><span class="over" style="width: 30%"></span></div>
        </div>
      {/each}
      <div class="limit">
        <div class="limit-head"><span>Mỗi chân GPIO</span><b>nên ≤ 20 mA · tối đa 40 mA</b></div>
        <div class="meter"><span class="ok" style="width: 40%"></span><span class="over" style="width: 40%"></span><span class="burn" style="width: 20%"></span></div>
        <div class="scale"><span>0</span><span style="left: 40%">20 mA</span><span style="left: 80%">40 mA</span></div>
      </div>
      <div class="key"><span><i class="ok"></i>An toàn</span><span><i class="over"></i>Gần giới hạn</span><span><i class="burn"></i>Hỏng chân</span></div>
      <p class="caption">Một LED với điện trở 220 Ω chỉ lấy ~7 mA. Còi, động cơ hay dải LED lớn cần lấy điện từ nguồn riêng hoặc qua transistor, không lấy thẳng từ chân GPIO.</p>
    </section>
    <section class="fig wide">
      <h2><span class="fig-n">Hình 4</span>So sánh kích thước các board</h2>
      <svg class="drawing lineup" viewBox="-1 -1 {lineupX} {lineupH}">
        {#each placed as l (l.id)}
          <g transform="translate({l.x + 1.6} 3.9)" opacity={l.id === type ? 1 : 0.75}>
            <BoardView board={l.b} net={none} observables={{}} pinFill={() => 'url(#gold)'} pinHint={(p) => p} onpress={noop} onrelease={noop} />
          </g>
          {#if l.id === type}<rect x={l.x} y="-0.5" width={l.w} height={l.b.height + 3.6} fill="none" stroke="var(--accent-hi)" stroke-width="0.12" />{/if}
          <text x={l.x + l.w / 2} y={l.b.height + 4.6} class="lineup-t">{l.b.name.replace(/ \(.*/, '')} · {l.b.pins.length} chân</text>
        {/each}
      </svg>
      <p class="caption">Vẽ cùng tỉ lệ. Hai hàng chân luôn cách nhau 10 lỗ (25,4 mm); board 38 chân dài hơn và lộ thêm các chân flash (SD0–SD3, CLK, CMD) không được dùng.</p>
    </section>
  </div>

  {#if board.learn?.tips?.length}
    <section>
      <h2>Mẹo</h2>
      <ul class="tips">{#each board.learn.tips as t}<li>{t}</li>{/each}</ul>
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
  .board-fig { max-width: 340px; }
  .board-fig svg { height: 340px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chips span { font: 11px var(--font-mono); color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); padding: 1px 7px; }
  .buttons { margin-top: 6px; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .primary:disabled { background: var(--surface-3); border-color: var(--line); color: var(--ink-3); }

  .legend { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .legend button { display: inline-flex; align-items: center; gap: 6px; font: 11px var(--font-mono); padding: 2px 8px 2px 3px; color: var(--ink-3); }
  .legend button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); color: var(--ink); }
  .legend i, .tags span { font: 600 10.5px var(--font-mono); font-style: normal; padding: 1px 6px; border: 1px solid; }
  .legend-hint { font-size: 11.5px; color: var(--ink-4); }
  .pinout { width: 100%; height: auto; display: block; background: var(--surface-2); border: 1px solid var(--line-soft); }
  .row { transition: opacity .15s; }
  .lead { stroke: var(--line-strong); stroke-width: 1; }
  .mark { font: 700 9px var(--font-ui); fill: #fff; text-anchor: middle; }
  .chip { font: 600 10.5px var(--font-mono); text-anchor: middle; }
  .verdicts { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: var(--ink-3); margin-top: 8px; }
  .verdicts span { display: inline-flex; gap: 6px; align-items: center; }
  .verdicts i, .v { width: 16px; height: 16px; border-radius: 50%; color: #fff; font: 700 9.5px var(--font-ui); font-style: normal; display: inline-flex; align-items: center; justify-content: center; }

  .pins { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .pins th { text-align: left; font: 600 10.5px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 6px 8px; border-bottom: 1px solid var(--line-strong); }
  .pins td { padding: 5px 8px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
  .pins td:first-child { white-space: nowrap; }
  .pins td:first-child b { font: 600 12px var(--font-mono); margin-left: 6px; }
  .pins code { font: 600 12px var(--font-mono); color: var(--signal); }
  .pins .tags { display: flex; flex-wrap: wrap; gap: 3px; }
  .note-cell { color: var(--ink-2); line-height: 1.45; }
  .pins tr.dim { opacity: .3; }
  .lineup { max-height: 360px; }
  .lineup-t { font: 600 0.75px var(--font-mono); fill: var(--ink-2); text-anchor: middle; }
</style>
