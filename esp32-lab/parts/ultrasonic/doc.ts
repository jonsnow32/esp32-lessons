import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { echoWidth, type UltrasonicProps } from './index';

const ms = (ns: number) => ns / 1e6;
const duration = (ns: number) => (ns >= 1e6 ? `${sch.num(ns / 1e6, 2)} ms` : `${sch.num(ns / 1e3, 0)} µs`);

/** The module firing a burst at a wall and hearing it come back. */
function echo(cm: number): string {
  const wall = 160 + Math.sqrt(Math.min(1, cm / 450)) * 220;
  const out = [0, 1, 2, 3].map((i) => {
    const x = 104 + ((wall - 104) * (i + 1)) / 5;
    return `<path d="M${x},62 a14,22 0 0 1 0,36" fill="none" stroke="var(--accent-hi)" stroke-width="2" opacity="${0.4 + i * 0.15}"/>`;
  });
  const back = [0, 1, 2].map((i) => {
    const x = wall - ((wall - 104) * (i + 1)) / 4;
    return `<path d="M${x},112 a14,22 0 0 0 0,36" fill="none" stroke="var(--signal)" stroke-width="2" opacity="${0.9 - i * 0.2}"/>`;
  });
  return `
    <rect x="16" y="50" width="78" height="110" fill="#1f5fa8" stroke="#123e70"/>
    <circle cx="55" cy="80" r="22" fill="#c3c8ce" stroke="#6f767e" stroke-width="2"/><circle cx="55" cy="80" r="12" fill="#2a2d31"/>
    <circle cx="55" cy="130" r="22" fill="#c3c8ce" stroke="#6f767e" stroke-width="2"/><circle cx="55" cy="130" r="12" fill="#2a2d31"/>
    ${sch.text(55, 44, 'HC-SR04', { cls: 'sch-strong', size: 10 })}
    ${sch.text(55, 176, 'T: phát · R: thu', { cls: 'sch-m', size: 9.5 })}
    ${out.join('')}${back.join('')}
    <rect x="${wall}" y="30" width="14" height="150" fill="#8b8d98"/>
    <path d="M${wall},30 l14,0 M${wall},60 l14,-12 M${wall},90 l14,-12 M${wall},120 l14,-12 M${wall},150 l14,-12" stroke="#5f646b"/>
    <path class="sch-lead" d="M94,196 H${wall}" stroke-dasharray="0"/><path class="sch-w" d="M94,190 v12 M${wall},190 v12"/>
    ${sch.text((94 + wall) / 2, 214, `${cm} cm`, { cls: 'sch-a', size: 12 })}
    ${sch.text((104 + wall) / 2, 50, '40 kHz đi →', { cls: 'sch-a', size: 10 })}
    ${sch.text((104 + wall) / 2, 168, '← tiếng vọng về', { cls: 'sch-s', size: 10 })}`;
}

export const doc: PartDoc<UltrasonicProps> = {
  active: { measuring: true },
  specs: (p) => [
    ['Điện áp nguồn', '5 V, ~15 mA'],
    ['Tầm đo', '2 cm – 4 m, góc ~15°'],
    ['Độ phân giải', '≈ 3 mm'],
    ['Xung Trig', '≥ 10 µs mức HIGH'],
    ['Echo ở khoảng cách đã chọn', duration(echoWidth(p.distance))],
    ['Đổi ra cm', 'thời gian Echo (µs) ÷ 58'],
  ],
  figures: (p) => {
    const w = echoWidth(p.distance);
    const esp = sch.esp32(14, 10, [{ name: '5V', dy: 26 }, { name: 'GPIO5', dy: 60 }, { name: 'GPIO18', dy: 98 }, { name: 'GND', dy: 140 }], 156);
    const mod = sch.block(282, 10, 'HC-SR04', [{ name: 'VCC', dy: 26 }, { name: 'Trig', dy: 60 }, { name: 'Echo', dy: 98 }, { name: 'GND', dy: 140 }], { side: 'left', w: 70, h: 156 });
    // Timing in display units: the echo's length is squeezed to fit next to a 10 µs trigger
    const echoLen = 24 + Math.min(1, ms(w) / 26) * 40;
    const burst: [number, 0 | 1][] = [[0, 0]];
    for (let i = 0; i < 8; i++) burst.push([16 + i * 1.6, 1], [16.8 + i * 1.6, 0]);
    return [
      { kind: 'svg', title: 'Đo bằng tiếng vang', viewBox: '0 0 410 222', svg: echo(p.distance), caption: 'Loa T phát một chuỗi 8 xung siêu âm 40 kHz (tai người không nghe được). Âm thanh đi tới vật, dội lại và được micro R thu. Âm thanh đi khoảng 343 m/s, tức 29 µs mỗi cm; vì phải đi cả đi lẫn về nên mỗi cm khoảng cách ứng với ~58 µs.' },
      {
        kind: 'timing',
        title: 'Giản đồ thời gian một lần đo',
        end: 30 + echoLen + 6,
        signals: [
          { name: 'Trig', steps: [[0, 0], [4, 1], [10, 0]] },
          { name: 'Siêu âm', steps: burst, color: 'var(--accent-hi)' },
          { name: 'Echo', steps: [[0, 0], [30, 1], [30 + echoLen, 0]], color: 'var(--info)' },
        ],
        spans: [
          { row: 0, from: 4, to: 10, label: '10 µs' },
          { row: 1, from: 16, to: 28.8, label: '8 × 40 kHz' },
          { row: 2, from: 30, to: 30 + echoLen, label: `${duration(w)} → ${p.distance} cm` },
        ],
        caption: 'ESP32 kéo Trig lên HIGH 10 µs. Module phát xung rồi nâng Echo lên HIGH đúng bằng thời gian âm thanh đi và về. Trong code: pulseIn(ECHO, HIGH) trả về số µs đó, chia 58 ra cm.',
      },
      {
        kind: 'chart',
        title: 'Độ dài xung Echo theo khoảng cách',
        x: { label: 'Khoảng cách (cm)', min: 0, max: 450 },
        y: { label: 'Echo HIGH (ms)', min: 0, max: 28 },
        series: [{ points: [[2, ms(echoWidth(2))], [400, ms(echoWidth(400))]], label: 'Echo' }],
        marks: [
          { x: p.distance, y: Math.min(28, ms(w)), label: p.distance > 400 ? 'Ngoài tầm: hết giờ 38 ms' : `${p.distance} cm → ${duration(w)}` },
          { x: 400, label: 'Tối đa 4 m', tone: 'error' },
        ],
        caption: 'Quan hệ tuyến tính: xa gấp đôi thì Echo dài gấp đôi. Quá 4 m (hoặc vật hút âm, đặt nghiêng) thì không có tiếng vọng và Echo chỉ hạ xuống sau ~38 ms.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 370 180',
        svg:
          esp.svg +
          mod.svg +
          sch.wire([esp.pin['5V']!, mod.pin.VCC!]) +
          sch.wire([esp.pin.GPIO5!, mod.pin.Trig!], 'sch-s') +
          sch.resistor(mod.pin.Echo!, [190, 108], '1 kΩ') +
          sch.wire([[190, 108], esp.pin.GPIO18!], 'sch-s') +
          sch.dot(190, 108) +
          sch.resistor([190, 108], [190, 150], '2 kΩ') +
          sch.dot(190, 150) +
          sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Module chạy 5 V và chân Echo cũng ra 5 V, cao hơn mức chân GPIO chịu được. Cầu chia 1 kΩ / 2 kΩ hạ nó xuống ≈ 3,3 V. Trig thì nối thẳng: 3,3 V của ESP32 đã đủ để module hiểu là HIGH.',
      },
    ];
  },
};
