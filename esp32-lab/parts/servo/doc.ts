import { sch, type PartDoc, type PartProps } from '@esp32lab/part-sdk';
import { angleFor } from './index';

export const doc: PartDoc<PartProps> = {
  active: { angle: 135, moving: true },
  specs: () => [
    ['Góc quay', '0–180°'],
    ['Xung điều khiển', '50 Hz (20 ms), rộng 0,5–2,5 ms'],
    ['Nguồn', '4,8–6 V; ~250 mA khi quay, ~6 mA khi đứng'],
    ['Tốc độ', '0,1 s / 60° ở 4,8 V'],
    ['Lực giữ', '≈ 1,8 kg·cm'],
    ['ledcWrite ở 16 bit, 50 Hz', 'giá trị = xung (µs) × 65536 ÷ 20000'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO18', dy: 64 }, { name: 'GND', dy: 102 }], 118);
    const mod = sch.block(256, 10, 'Servo', [{ name: 'V+ (đỏ)', dy: 26 }, { name: 'Tín hiệu (cam)', dy: 64 }, { name: 'GND (nâu)', dy: 102 }], { side: 'left', w: 96, h: 118 });
    const pts: [number, number][] = [[300, 0], [500, 0], [2500, 180], [3000, 180]];
    return [
      {
        kind: 'timing',
        title: 'Xung điều khiển',
        end: 60,
        signals: [
          { name: '0°', steps: [[0, 0], [2, 1], [3, 0], [22, 1], [23, 0], [42, 1], [43, 0]] },
          { name: '90°', steps: [[0, 0], [2, 1], [5, 0], [22, 1], [25, 0], [42, 1], [45, 0]] },
          { name: '180°', steps: [[0, 0], [2, 1], [7, 0], [22, 1], [27, 0], [42, 1], [47, 0]] },
        ],
        spans: [
          { row: 0, from: 2, to: 22, label: 'chu kỳ 20 ms' },
          { row: 1, from: 2, to: 5, label: '1,5 ms' },
          { row: 2, from: 2, to: 7, label: '2,5 ms' },
        ],
        caption: 'Tần số luôn là 50 Hz; chỉ độ rộng của xung HIGH đổi theo góc. Mạch trong servo so độ rộng xung với vị trí trục (đo bằng một biến trở gắn trên trục) rồi quay động cơ cho tới khi hai cái khớp nhau.',
      },
      {
        kind: 'chart',
        title: 'Góc theo độ rộng xung',
        x: { label: 'Độ rộng xung (µs)', min: 300, max: 3000 },
        y: { label: 'Góc (°)', min: 0, max: 180, ticks: [0, 45, 90, 135, 180] },
        series: [{ points: pts.map(([us]) => [us, angleFor(us * 1000)]), label: 'Góc' }],
        marks: [{ x: 1500, y: 90, label: '1,5 ms → 90°' }],
        caption: 'Tuyến tính giữa 0,5 ms và 2,5 ms; ngoài khoảng đó servo đứng ở đầu mút. Mỗi con servo lệch một chút: nếu nó kêu rè ở 0° hay 180°, thu hẹp khoảng xung lại (ví dụ 0,6–2,4 ms).',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 370 140',
        svg: esp.svg + mod.svg + sch.wire([esp.pin['VIN 5V']!, mod.pin['V+ (đỏ)']!]) + sch.wire([esp.pin.GPIO18!, mod.pin['Tín hiệu (cam)']!], 'sch-s') + sch.wire([esp.pin.GND!, mod.pin['GND (nâu)']!]),
        caption: 'Nguồn 5 V lấy từ VIN (cổng USB), không lấy từ 3V3. Dây tín hiệu chỉ cần 3,3 V của GPIO là đủ để servo hiểu là HIGH.',
      },
    ];
  },
};
