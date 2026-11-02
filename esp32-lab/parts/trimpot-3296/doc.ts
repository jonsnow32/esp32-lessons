import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { Trimpot3296Props } from './index';

/** Screw turns from one end of the track to the other. */
export const TURNS = 25;

/** Value code printed on the body: 103 = 10 × 10³ Ω. */
export function valueCode(r: number): string {
  const exp = Math.max(0, Math.floor(Math.log10(r)) - 1);
  return `${Math.round(r / 10 ** exp)}${exp}`;
}

/** Top view, and the pins underneath: 1 and 3 in a row 2 holes apart, 2 between them a row below. */
function pinout(code: string): string {
  const px = (x: number) => 110 + x * 60;
  const py = (y: number) => 95 + y * 60;
  return `
    <rect x="40" y="55" width="225" height="114" rx="6" fill="#2f6fbf" fill-opacity="0.16" stroke="#2f6fbf" stroke-width="1.4"/>
    <circle cx="70" cy="122" r="24" fill="#c9a13e" stroke="#6b5216" stroke-width="1.2"/>
    <rect x="52" y="119" width="36" height="6" rx="2" fill="#5a4512"/>
    ${sch.text(196, 150, code, { cls: 'sch-strong', size: 14 })}
    ${[[0, 0, 1], [1, 1, 2], [2, 0, 3]].map(([x, y, n]) => `<circle class="sch-b" cx="${px(x!)}" cy="${py(y!)}" r="7"/>${sch.text(px(x!), py(y!) - 13, String(n), { cls: 'sch-strong' })}`).join('')}
    ${sch.callout([70, 122], [300, 40], 'Vít chỉnh (25 vòng)', 'start')}
    ${sch.callout([px(1), py(1)], [300, 190], 'Chân 2: con chạy', 'start')}
    ${sch.text(px(1), 210, '2,54 mm giữa các lỗ', { size: 10.5 })}`;
}

export const doc: PartDoc<Trimpot3296Props> = {
  specs: (p) => {
    const k = p.position / 100;
    return [
      ['Tổng trở (chân 1 – 3)', `${sch.ohm(p.resistance)} (mã ${valueCode(p.resistance)})`],
      ['Số vòng vít hết dải', `≈ ${TURNS} vòng`],
      ['Vị trí con chạy', `${sch.num(k * TURNS, 1)} / ${TURNS} vòng`],
      ['Chân giữa (1 = GND, 3 = 3V3)', `${sch.num(3.3 * k, 2)} V`],
      ['analogRead() 12 bit', `≈ ${Math.round(4095 * k)}`],
      ['Sai số tổng trở', '± 10 %'],
      ['Công suất tối đa', '0,5 W (ở 70 °C)'],
    ];
  },
  figures: (p) => {
    const k = p.position / 100;
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GPIO34', dy: 64 }, { name: 'GND', dy: 104 }], 122);
    return [
      { kind: 'svg', title: 'Nhìn từ trên xuống', viewBox: '0 0 440 228', svg: pinout(valueCode(p.resistance)), caption: 'Loại 3296W: chân 1 và chân 3 cùng hàng, cách nhau 2 lỗ; chân 2 (con chạy) nằm giữa, lệch xuống một hàng. Số in trên thân là tổng trở: hai chữ số đầu, rồi số chữ số 0 theo sau (103 = 10 000 Ω).' },
      {
        kind: 'chart',
        title: 'Điện áp chân giữa theo số vòng vít',
        x: { label: 'Số vòng đã vặn', min: 0, max: TURNS },
        y: { label: 'Điện áp chân giữa (V)', min: 0, max: 3.5 },
        series: [{ points: [[0, 0], [TURNS, 3.3]], label: 'Tuyến tính' }],
        marks: [{ x: k * TURNS, y: 3.3 * k, label: `${sch.num(k * TURNS, 1)} vòng → ${sch.num(3.3 * k, 2)} V` }],
        caption: `Mỗi vòng vít chỉ đổi khoảng ${sch.num(3.3 / TURNS * 1000, 0)} mV, vì vậy loại 25 vòng chỉnh mịn hơn nhiều so với biến trở núm xoay (cả dải chỉ trong chưa tới một vòng).`,
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 390 150',
        svg:
          esp.svg +
          sch.wire([esp.pin['3V3']!, [230, 34], [230, 40]]) +
          sch.resistor([230, 40], [230, 108], sch.ohm(p.resistance), 'chân 3 ↑ · chân 1 ↓') +
          sch.wire([[230, 108], [230, 114], esp.pin.GND!]) +
          sch.wire([esp.pin.GPIO34!, [218, 74]], 'sch-s') +
          `<path class="sch-b-ink" d="M224,74 l-9,-4.5 v9 Z"/>` +
          sch.text(160, 68, 'chân 2', { cls: 'sch-s' }),
        caption: 'Hai chân ngoài nối 3V3 và GND, chân 2 vào một chân có ADC (GPIO32–39). analogRead() trả về 0 đến 4095 theo vị trí vít.',
      },
    ];
  },
};
