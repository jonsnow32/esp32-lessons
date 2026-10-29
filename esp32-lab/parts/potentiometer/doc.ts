import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { PotentiometerProps } from './index';

/** Point on the knob's 270° sweep: position 0 by pin 1 (bottom left), 1 by pin 3. */
function onTrack(k: number, r: number): [number, number] {
  const a = ((225 - 270 * k) * Math.PI) / 180;
  return [150 + r * Math.cos(a), 100 - r * Math.sin(a)];
}

/** Arc along the track from position k0 to k1 (clockwise on screen). */
function arc(k0: number, k1: number, r: number): string {
  const [x0, y0] = onTrack(k0, r);
  const [x1, y1] = onTrack(k1, r);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${(k1 - k0) * 270 > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

/** Looking into the pot: carbon track, wiper, and the three pins under it. */
function inside(k: number, total: number): string {
  const [wx, wy] = onTrack(k, 58);
  const [ex0, ey0] = onTrack(0, 58);
  const [ex1, ey1] = onTrack(1, 58);
  return `
    <circle cx="150" cy="100" r="78" fill="#2f6fbf" fill-opacity="0.12" stroke="#2f6fbf" stroke-width="1.4"/>
    <path d="${arc(0, 1, 58)}" fill="none" stroke="#3a2a1e" stroke-width="13" stroke-linecap="butt"/>
    ${k > 0.005 ? `<path d="${arc(0, k, 58)}" fill="none" stroke="var(--accent-hi)" stroke-width="5"/>` : ''}
    ${k < 0.995 ? `<path d="${arc(k, 1, 58)}" fill="none" stroke="var(--signal)" stroke-width="5"/>` : ''}
    <path d="M${ex0.toFixed(1)},${ey0.toFixed(1)} L110,190 M${ex1.toFixed(1)},${ey1.toFixed(1)} L190,190" class="sch-w"/>
    <path d="M150,100 L150,190" class="sch-w"/>
    <path d="M150,100 L${wx.toFixed(1)},${wy.toFixed(1)}" stroke="#c3c8ce" stroke-width="7" stroke-linecap="round"/>
    <circle cx="${wx.toFixed(1)}" cy="${wy.toFixed(1)}" r="6" fill="#e8ebee" stroke="#6f767e"/>
    <circle cx="150" cy="100" r="16" fill="#c3c8ce" stroke="#6f767e"/>
    ${[110, 150, 190].map((x, i) => `<circle class="sch-b" cx="${x}" cy="196" r="6"/>${sch.text(x, 216, String(i + 1), { cls: 'sch-strong' })}`).join('')}
    ${sch.text(258, 60, 'Chân 1 → con chạy', { anchor: 'start', cls: 'sch-a', size: 10.5 })}
    ${sch.text(258, 75, sch.ohm(total * k), { anchor: 'start', cls: 'sch-strong' })}
    ${sch.text(258, 110, 'Con chạy → chân 3', { anchor: 'start', cls: 'sch-s', size: 10.5 })}
    ${sch.text(258, 125, sch.ohm(total * (1 - k)), { anchor: 'start', cls: 'sch-strong' })}
    ${sch.callout([150, 100], [258, 160], 'Trục xoay + con chạy')}
    ${sch.callout(onTrack(0.12, 58), [20, 40], 'Lớp than', 'start')}`;
}

export const doc: PartDoc<PotentiometerProps> = {
  specs: (p) => {
    const k = p.position / 100;
    return [
      ['Tổng trở (chân 1 – 3)', sch.ohm(p.resistance)],
      ['Góc xoay', '≈ 270°'],
      ['Chân giữa (1 = GND, 3 = 3V3)', `${sch.num(3.3 * k, 2)} V`],
      ['analogRead() 12 bit', `≈ ${Math.round(4095 * k)}`],
      ['Công suất tối đa', '0,125 W'],
    ];
  },
  figures: (p) => {
    const k = p.position / 100;
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GPIO34', dy: 64 }, { name: 'GND', dy: 104 }], 122);
    return [
      { kind: 'svg', title: 'Bên trong biến trở', viewBox: '0 0 400 228', svg: inside(k, p.resistance), caption: 'Con chạy trượt trên một dải than hình móng ngựa. Đoạn than từ chân 1 tới con chạy (cam) và từ con chạy tới chân 3 (xanh) luôn cộng lại bằng tổng trở; xoay núm chỉ đổi tỉ lệ giữa hai đoạn.' },
      {
        kind: 'chart',
        title: 'Điện áp chân giữa theo góc xoay',
        x: { label: 'Vị trí núm (%)', min: 0, max: 100 },
        y: { label: 'Điện áp chân giữa (V)', min: 0, max: 3.5 },
        series: [{ points: [[0, 0], [100, 3.3]], label: 'Biến trở tuyến tính (B)' }],
        marks: [{ x: p.position, y: 3.3 * k, label: `${p.position} % → ${sch.num(3.3 * k, 2)} V` }],
        caption: 'Biến trở loại B (tuyến tính): xoay được nửa vòng thì điện áp chân giữa cũng ở giữa. Giá trị tổng trở không đổi đường này, nó chỉ quyết định dòng điện chạy qua.',
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
          sch.text(160, 68, 'chân giữa', { cls: 'sch-s' }),
        caption: 'Hai chân ngoài nối 3V3 và GND, chân giữa vào một chân có ADC (GPIO32–39). analogRead() trả về 0 đến 4095 theo góc xoay.',
      },
    ];
  },
};
