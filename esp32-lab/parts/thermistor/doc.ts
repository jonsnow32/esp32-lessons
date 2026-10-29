import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { ntcResistance, type ThermistorProps } from './index';

const R_FIXED = 10_000;
const vout = (c: number) => (3.3 * R_FIXED) / (ntcResistance(c) + R_FIXED);
const TEMPS = Array.from({ length: 121 }, (_, i) => -20 + i);

/** A thermometer scale beside the bead: the bead's colour and resistance at the chosen temperature. */
function scale(c: number): string {
  const y = (t: number) => 196 - ((t + 20) / 120) * 172;
  const hot = Math.max(0, Math.min(1, (c - 25) / 60));
  const cold = Math.max(0, Math.min(1, (25 - c) / 40));
  const tint = hot ? `rgba(229,72,77,${0.25 + hot * 0.6})` : `rgba(62,99,221,${cold * 0.6})`;
  const ticks = [-20, 0, 25, 50, 75, 100]
    .map((t) => `<path class="sch-w" d="M92,${y(t)} h8"/>${sch.text(86, y(t) + 4, `${t}°`, { anchor: 'end', cls: 'sch-m', size: 10 })}${sch.text(150, y(t) + 4, sch.ohm(ntcResistance(t)), { anchor: 'start', size: 10 })}`)
    .join('');
  return `
    <rect x="100" y="20" width="20" height="180" rx="10" fill="var(--surface-3)" stroke="var(--line-strong)"/>
    <rect x="104" y="${y(c)}" width="12" height="${196 - y(c)}" rx="6" fill="#e5484d"/>
    ${ticks}
    <path class="sch-lead" d="M140,${y(c)} H${146}"/>
    <g transform="translate(300 110)">
      <path d="M-8,20 V80 M8,20 V80" stroke="#a7adb4" stroke-width="3"/>
      <ellipse cx="0" cy="0" rx="26" ry="30" fill="#2a2d31"/>
      <ellipse cx="0" cy="0" rx="26" ry="30" fill="${tint}"/>
      <ellipse cx="-8" cy="-12" rx="7" ry="9" fill="#fff" opacity="0.25"/>
    </g>
    ${sch.text(300, 40, `${c} °C`, { cls: 'sch-a', size: 14 })}
    ${sch.text(300, 58, sch.ohm(ntcResistance(c)), { cls: 'sch-strong', size: 14 })}
    ${sch.text(160, 14, 'Điện trở', { anchor: 'start', cls: 'sch-m', size: 10 })}`;
}

export const doc: PartDoc<ThermistorProps> = {
  specs: (p) => [
    ['Nhiệt độ đang chọn', `${p.temperature} °C`],
    ['Điện trở lúc này', sch.ohm(ntcResistance(p.temperature))],
    ['R25 (ở 25 °C)', '10 kΩ ± 1 %'],
    ['Hệ số Beta (B25/50)', '3950 K'],
    ['Dải đo', '−40 … 125 °C'],
    ['Công suất tối đa', '50 mW'],
  ],
  figures: (p) => {
    const c = p.temperature;
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GPIO34', dy: 70 }, { name: 'GND', dy: 116 }], 134);
    return [
      { kind: 'svg', title: 'Nóng lên, điện trở giảm', viewBox: '0 0 380 214', svg: scale(c), caption: 'NTC (Negative Temperature Coefficient) là một hạt gốm bán dẫn bọc epoxy. Càng nóng, càng nhiều hạt mang điện được giải phóng nên điện trở giảm mạnh: từ ~33 kΩ ở 0 °C xuống ~0,7 kΩ ở 100 °C.' },
      {
        kind: 'chart',
        title: 'Điện trở theo nhiệt độ (phương trình Beta)',
        x: { label: 'Nhiệt độ (°C)', min: -20, max: 100 },
        y: { label: 'Điện trở (Ω, thang log)', min: 300, max: 100_000, log: true },
        series: [{ points: TEMPS.map((t) => [t, ntcResistance(t)]), label: 'NTC 10k B3950' }],
        marks: [{ x: c, y: ntcResistance(c), label: `${c} °C → ${sch.ohm(ntcResistance(c))}` }],
        caption: 'R = R25 · e^(B·(1/T − 1/T25)), T tính bằng kelvin. Code đi ngược lại: đo điện trở, rồi dùng công thức này để ra nhiệt độ.',
      },
      {
        kind: 'chart',
        title: 'Điện áp GPIO34 theo nhiệt độ',
        x: { label: 'Nhiệt độ (°C)', min: -20, max: 100 },
        y: { label: 'Điện áp (V)', min: 0, max: 3.3 },
        series: [{ points: TEMPS.map((t) => [t, vout(t)]), label: 'Vout' }],
        marks: [{ x: c, y: vout(c), label: `${sch.num(vout(c), 2)} V` }],
        caption: 'Với NTC ở trên và 10 kΩ ở dưới, điện áp tăng khi nóng lên. Đoạn dốc nhất nằm quanh 25 °C (khi NTC ≈ 10 kΩ), nơi phép đo nhạy nhất.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 330 160',
        svg:
          esp.svg +
          sch.wire([esp.pin['3V3']!, [230, 34], [230, 40]]) +
          sch.variable([230, 40], [230, 80], 'heat', 'NTC 10k') +
          sch.resistor([230, 80], [230, 120], '10 kΩ') +
          sch.wire([[230, 120], [230, 126], esp.pin.GND!]) +
          sch.dot(230, 80) +
          sch.wire([esp.pin.GPIO34!, [230, 80]], 'sch-s'),
        caption: 'Giống dự án mẫu "Nhiệt kế": 3,3 V → NTC → GPIO34 → 10 kΩ → GND. Dùng chân ADC1 (GPIO32–39) để vẫn đọc được khi bật Wi-Fi.',
      },
    ];
  },
};
