import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { channel, MODELS, type MosfetModel, type MosfetProps } from './index';

type Pt = [number, number];

const COLOR: Record<MosfetModel, string> = { IRLZ44N: 'var(--accent-hi)', IRF520: 'var(--info)' };
/** The load in the curves: 5 V through 25 Ω, about what the mini water pump draws. */
const V_LOAD = 5;
const R_LOAD = 25;

/** Current through the 25 Ω load with `vgs` on the gate: where the load line meets the channel. */
function loadCurrent(model: MosfetModel, vgs: number): number {
  let [lo, hi] = [0, V_LOAD];
  for (let k = 0; k < 60; k++) {
    const vds = (lo + hi) / 2;
    if ((V_LOAD - vds) / R_LOAD > channel(vgs, vds, MODELS[model]).id) lo = vds;
    else hi = vds;
  }
  return (V_LOAD - lo) / R_LOAD;
}

/** N-channel enhancement MOSFET symbol, gate on the left: its pins' ends. */
function symbol(x: number, y: number): { svg: string; g: Pt; d: Pt; s: Pt } {
  const svg = `
    <path class="sch-w" d="M${x - 30},${y} H${x - 8} M${x - 8},${y - 16} V${y + 16}"/>
    <path class="sch-w" d="M${x - 2},${y - 18} V${y - 10} M${x - 2},${y - 4} V${y + 4} M${x - 2},${y + 10} V${y + 18}"/>
    <path class="sch-w" d="M${x - 2},${y - 14} H${x + 12} V${y - 34} M${x - 2},${y + 14} H${x + 12} V${y + 34} M${x - 2},${y} H${x + 12} V${y + 14}"/>
    <path class="sch-b-ink" d="M${x - 1},${y} l8,-4 v8 Z"/>`;
  return { svg, g: [x - 30, y], d: [x + 12, y - 34], s: [x + 12, y + 34] };
}

/** The TO-220 seen from the front next to its symbol, legs G D S lined up with the pins. */
function pinout(model: MosfetModel): string {
  const legs = [0, 1, 2].map((k) => `<path d="M${60 + k * 30},120 V160" stroke="#a7adb4" stroke-width="5"/>`).join('');
  const sym = symbol(290, 90);
  return `
    <rect x="40" y="16" width="100" height="44" rx="4" fill="#b8bec6"/>
    <circle cx="90" cy="36" r="12" fill="var(--bg, #1b1d20)"/>
    <rect x="40" y="58" width="100" height="62" rx="3" fill="url(#mosfet-body)"/>
    ${sch.text(90, 90, model, { size: 12, cls: 'sch-chip-t' })}
    ${legs}
    ${['G', 'D', 'S'].map((t, k) => sch.text(60 + k * 30, 176, t, { cls: 'sch-a' })).join('')}
    ${sch.text(90, 194, 'nhìn mặt có chữ', { cls: 'sch-m', size: 10 })}
    ${sym.svg}
    ${sch.text(sym.g[0] - 4, sym.g[1] + 4, 'G', { anchor: 'end', cls: 'sch-a' })}
    ${sch.text(sym.d[0] + 8, sym.d[1] + 4, 'D (máng)', { anchor: 'start', cls: 'sch-a' })}
    ${sch.text(sym.s[0] + 8, sym.s[1] + 4, 'S (nguồn)', { anchor: 'start', cls: 'sch-a' })}
    ${sch.text(sym.g[0] - 4, sym.g[1] + 20, 'cổng', { anchor: 'end', cls: 'sch-m', size: 10 })}`;
}

/** Low-side switch for the pump: 5 V → pump → D, S → GND, GPIO23 → 220 Ω → G, 10 kΩ G → GND. */
function wiring(): string {
  const esp = sch.esp32(14, 20, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO23', dy: 110 }, { name: 'GND', dy: 160 }], 176);
  const q = symbol(290, 130);
  const top = esp.pin['VIN 5V']!;
  const gate = esp.pin.GPIO23!;
  const gnd = esp.pin.GND!;
  const pd = q.g[0] - 20;
  return `
    ${esp.svg}
    ${sch.wire([top, [410, top[1]], [410, 58]])}
    <circle class="sch-b" cx="410" cy="72" r="13"/>${sch.text(410, 76, 'M', { size: 12 })}
    ${sch.text(430, 76, 'bơm', { anchor: 'start', cls: 'sch-m', size: 10 })}
    ${sch.wire([[410, 85], [410, q.d[1]], q.d])}
    ${sch.diode([340, q.d[1]], [340, top[1]], { label: '1N4007' })}
    ${sch.dot(340, top[1])}${sch.dot(340, q.d[1])}
    ${sch.resistor(gate, [pd, gate[1]], '220 Ω')}
    ${sch.wire([[pd, gate[1]], q.g], 'sch-s')}
    ${sch.dot(pd, q.g[1])}
    ${sch.resistor([pd, q.g[1]], [pd, gnd[1]], '10 kΩ')}
    ${q.svg}
    ${sch.wire([gnd, [q.s[0], gnd[1]], q.s])}
    ${sch.dot(pd, gnd[1])}
    ${sch.text(q.d[0] - 8, q.d[1] + 4, 'D', { anchor: 'end', size: 10, cls: 'sch-a' })}
    ${sch.text(q.s[0] + 8, q.s[1] + 4, 'S', { anchor: 'start', size: 10, cls: 'sch-a' })}
    ${sch.text(q.g[0] + 4, q.g[1] - 8, 'G', { anchor: 'start', size: 10, cls: 'sch-a' })}`;
}

export const doc: PartDoc<MosfetProps> = {
  active: { on: true, current: 0.18 },
  specs: (p) => {
    const m = MODELS[p.model];
    const at33 = loadCurrent(p.model, 3.3);
    return [
      ['Loại', p.model === 'IRLZ44N' ? 'Kênh N, logic-level: mở hết với 3,3–5 V' : 'Kênh N, chuẩn: cần ≈ 10 V ở cổng'],
      ['Ngưỡng mở Vgs(th)', `≈ ${sch.num(m.vth, 1)} V`],
      ['Rds(on)', `${sch.num(m.rdsOn[0] * 1000, 0)} mΩ ở Vgs = ${m.rdsOn[1]} V`],
      ['Với GPIO 3,3 V, tải 5 V / 25 Ω', `${sch.num(at33 * 1000, 0)} mA (đủ tải: ${sch.num((V_LOAD / R_LOAD) * 1000, 0)} mA)`],
      ['Dòng D tối đa', `${m.currentMax} A (cần tản nhiệt)`],
      ['Vds / Vgs tối đa', `${m.vdsMax} V / ±${m.vgsMax} V`],
      ['Công suất không tản nhiệt', `≈ ${sch.num(m.powerMax, 1)} W`],
    ];
  },
  figures: (p) => {
    const vgs = Array.from({ length: 101 }, (_, k) => k * 0.06);
    const full = (V_LOAD / R_LOAD) * 1000;
    const at33 = loadCurrent(p.model, 3.3) * 1000;
    return [
      { kind: 'svg', title: 'Chân và ký hiệu', viewBox: '0 0 420 204', svg: pinout(p.model), caption: 'Cổng G cách điện với phần còn lại: không có dòng đi vào G, chỉ điện áp G so với S quyết định đường D–S mở hay đóng. Mũi tên trong ký hiệu chỉ vào kênh: đây là MOSFET kênh N.' },
      {
        kind: 'chart',
        title: 'Dòng qua tải theo điện áp cổng',
        x: { label: 'Điện áp G − S (V)', min: 0, max: 6 },
        y: { label: 'Dòng qua tải 5 V / 25 Ω (mA)', min: 0, max: 220 },
        series: (Object.keys(MODELS) as MosfetModel[]).map((m) => ({ points: vgs.map((v) => [v, loadCurrent(m, v) * 1000] as [number, number]), label: m, color: COLOR[m], muted: m !== p.model })),
        marks: [{ x: 3.3, label: 'GPIO 3,3 V', tone: 'signal' }, { x: 3.3, y: at33, label: `${sch.num(at33, 0)} mA` }, { y: full, label: `Tải chạy hết sức ${sch.num(full, 0)} mA`, tone: 'accent' }],
        caption:
          p.model === 'IRLZ44N'
            ? 'IRLZ44N mở hết từ khoảng 2,5 V: với 3,3 V của GPIO, tải đã nhận đủ dòng và MOSFET chỉ "ăn" vài mV. IRF520 (đường mờ) với 3,3 V gần như chưa mở.'
            : 'IRF520 cần điện áp cổng cao hơn nhiều: với 3,3 V nó chỉ mở hé, tải chạy yếu, phần điện áp còn lại rơi trên MOSFET làm nó nóng. Muốn dùng IRF520 với ESP32 phải có thêm tầng kích (transistor nâng cổng lên 10–12 V).',
      },
      {
        kind: 'svg',
        title: 'Bật tắt máy bơm',
        viewBox: '0 0 470 210',
        svg: wiring(),
        caption: 'GPIO23 HIGH: cổng lên 3,3 V, D–S dẫn, dòng ≈ 180 mA đi từ VIN 5 V qua bơm xuống GND. LOW: D–S ngắt, bơm dừng. Điện trở 10 kΩ giữ cổng ở 0 V khi ESP32 đang khởi động. Diode 1N4007 dập xung điện áp ngược của động cơ khi ngắt.',
      },
    ];
  },
};
