import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { ldrResistance, type PhotoresistorProps } from './index';

const R_FIXED = 10_000;
const vout = (lux: number) => (3.3 * R_FIXED) / (ldrResistance(lux) + R_FIXED);

/** Log-spaced lux values for the curves. */
const LUX = Array.from({ length: 81 }, (_, i) => 10 ** (i / 20));

/** The cell from above: a zig-zag of CdS between two interleaved electrodes, light falling on it. */
function cell(lux: number): string {
  const rays = Math.round(Math.min(6, 1 + Math.log10(Math.max(1, lux)) * 1.4));
  let track = 'M110,62';
  for (let i = 0; i < 7; i++) track += ` H${i % 2 ? 110 : 230} v14`;
  return `
    <defs><clipPath id="ldr-disc"><circle cx="170" cy="112" r="66"/></clipPath></defs>
    <circle cx="170" cy="112" r="70" fill="#e9e2d0" stroke="#8a7f66" stroke-width="1.4"/>
    <g clip-path="url(#ldr-disc)">
      <rect x="100" y="40" width="140" height="150" fill="#c3c8ce"/>
      <path d="${track}" fill="none" stroke="#d2691e" stroke-width="7"/>
    </g>
    <circle cx="170" cy="112" r="66" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="3"/>
    <path d="M140,182 V214 M200,182 V214" stroke="#a7adb4" stroke-width="4"/>
    ${Array.from({ length: rays }, (_, i) => {
      const x = 52 + i * 12;
      return `<path d="M${x},${8 + i * 4} L${x + 34},${48 + i * 4}" stroke="#f5a524" stroke-width="2.4" stroke-linecap="round"/><path d="M${x + 34},${48 + i * 4} l-9,-2 l5,-6 Z" fill="#f5a524"/>`;
    }).join('')}
    ${sch.callout([170, 76], [262, 40], 'Lớp CdS (đổi điện trở theo ánh sáng)')}
    ${sch.callout([226, 140], [262, 150], 'Hai điện cực răng lược')}
    ${sch.callout([200, 206], [262, 206], 'Hai chân, không có chiều')}
    ${sch.text(14, 120, `${lux} lux`, { anchor: 'start', cls: 'sch-a', size: 13 })}
    ${sch.text(14, 138, sch.ohm(ldrResistance(lux)), { anchor: 'start', cls: 'sch-strong', size: 13 })}`;
}

export const doc: PartDoc<PhotoresistorProps> = {
  specs: (p) => [
    ['Ánh sáng đang chọn', `${p.light} lux`],
    ['Điện trở lúc này', sch.ohm(ldrResistance(p.light))],
    ['Ở 10 lux', '≈ 15 kΩ'],
    ['Trong tối', '≥ 1 MΩ'],
    ['Hệ số γ', '0,7'],
    ['Thời gian đáp ứng', '20–30 ms'],
  ],
  figures: (p) => {
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GPIO34', dy: 70 }, { name: 'GND', dy: 116 }], 134);
    return [
      { kind: 'svg', title: 'Cấu tạo', viewBox: '0 0 440 224', svg: cell(p.light), caption: 'Mặt trên quang trở là một dải cadmium sulfide (CdS) uốn khúc giữa hai điện cực. Ánh sáng chiếu vào giải phóng thêm điện tử trong CdS, nên càng sáng thì càng dẫn điện tốt, tức điện trở càng nhỏ.' },
      {
        kind: 'chart',
        title: 'Điện trở theo độ sáng',
        x: { label: 'Độ sáng (lux, thang log)', min: 1, max: 10_000, log: true },
        y: { label: 'Điện trở (Ω, thang log)', min: 100, max: 1e6, log: true },
        series: [{ points: LUX.map((l) => [l, ldrResistance(l)]), label: 'GL5528' }],
        marks: [
          ...(p.light > 0 ? [{ x: p.light, y: ldrResistance(p.light), label: `${p.light} lux → ${sch.ohm(ldrResistance(p.light))}` }] : []),
          { x: 10, label: 'Phòng tối', tone: 'signal' as const },
          { x: 300, label: 'Phòng sáng', tone: 'signal' as const },
        ],
        caption: 'Trên thang log hai chiều, đặc tuyến gần như một đường thẳng: độ sáng tăng 10 lần thì điện trở giảm khoảng 5 lần (10^0,7).',
      },
      {
        kind: 'chart',
        title: 'Điện áp đọc được qua cầu chia áp 10 kΩ',
        x: { label: 'Độ sáng (lux, thang log)', min: 1, max: 10_000, log: true },
        y: { label: 'Điện áp GPIO34 (V)', min: 0, max: 3.3 },
        series: [{ points: LUX.map((l) => [l, vout(l)]), label: 'Vout' }],
        marks: p.light > 0 ? [{ x: p.light, y: vout(p.light), label: `${sch.num(vout(p.light), 2)} V ≈ ${Math.round((vout(p.light) / 3.3) * 4095)}` }] : [],
        caption: 'Quang trở ở trên, 10 kΩ ở dưới: càng sáng, điện áp ở giữa càng cao. Vùng thay đổi nhiều nhất nằm quanh độ sáng làm quang trở ≈ 10 kΩ, đúng khoảng ánh sáng trong nhà.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 330 160',
        svg:
          esp.svg +
          sch.wire([esp.pin['3V3']!, [230, 34], [230, 40]]) +
          sch.variable([230, 40], [230, 80], 'light', 'LDR') +
          sch.resistor([230, 80], [230, 120], '10 kΩ') +
          sch.wire([[230, 120], [230, 126], esp.pin.GND!]) +
          sch.dot(230, 80) +
          sch.wire([esp.pin.GPIO34!, [230, 80]], 'sch-s'),
        caption: 'Đổi chỗ quang trở và điện trở 10 kΩ thì ngược lại: càng sáng, điện áp càng thấp. Chọn cách nào cũng được, chỉ cần code hiểu đúng chiều.',
      },
    ];
  },
};
