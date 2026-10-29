import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { PushbuttonProps } from './index';

/** Bottom view of the 6×6 mm button: legs joined in pairs, the dome joining the pairs when pressed. */
function inside(): string {
  const box = (x: number, pressed: boolean) => `
    <rect x="${x}" y="30" width="120" height="120" fill="#2a2d31" stroke="#111" stroke-width="1.2"/>
    <path d="M${x + 20},40 V140" stroke="#c3c8ce" stroke-width="8"/><path d="M${x + 100},40 V140" stroke="#c3c8ce" stroke-width="8"/>
    ${[40, 140].map((y) => `<circle cx="${x + 20}" cy="${y}" r="7" fill="#a7adb4"/><circle cx="${x + 100}" cy="${y}" r="7" fill="#a7adb4"/>`).join('')}
    <circle cx="${x + 60}" cy="90" r="26" fill="${pressed ? 'var(--accent-hi)' : '#3a3e44'}" fill-opacity="${pressed ? 0.85 : 1}" stroke="#6f767e"/>
    ${pressed ? `<path d="M${x + 24},90 H${x + 96}" stroke="var(--accent-hi)" stroke-width="6"/>` : ''}
    ${sch.text(x + 20, 26, 'a1', { size: 10 })}${sch.text(x + 100, 26, 'b1', { size: 10 })}
    ${sch.text(x + 20, 164, 'a2', { size: 10 })}${sch.text(x + 100, 164, 'b2', { size: 10 })}
    ${sch.text(x + 60, 186, pressed ? 'Đang nhấn: a nối b' : 'Thả ra: a và b hở', { cls: pressed ? 'sch-a' : 'sch-m', size: 11 })}`;
  return `${box(30, false)}${box(250, true)}`;
}

export const doc: PartDoc<PushbuttonProps> = {
  active: { pressed: true },
  specs: (p) => [
    ['Kích thước', '6 × 6 mm, 4 chân'],
    ['Kiểu tiếp điểm', 'Thường hở (NO), tự nhả'],
    ['Thời gian dội phím', p.bounce ? '≈ 1–5 ms (đang bật)' : 'tắt (tiếp điểm lý tưởng)'],
    ['Đọc với INPUT_PULLUP', 'nhả = HIGH, nhấn = LOW'],
    ['Dòng tối đa', '50 mA ở 12 V'],
  ],
  figures: (p) => {
    const esp = sch.esp32(14, 20, [{ name: 'GPIO4', dy: 40 }, { name: 'GND', dy: 100 }], 120);
    const bouncy: [number, 0 | 1][] = p.bounce
      ? [[0, 1], [20, 0], [22, 1], [25, 0], [26.5, 1], [28, 0], [60, 0], [62, 1], [63.5, 0], [65, 1], [66, 0], [67.5, 1]]
      : [[0, 1], [20, 0], [62, 1]];
    return [
      { kind: 'svg', title: 'Bên trong nút nhấn (nhìn từ dưới)', viewBox: '0 0 400 196', svg: inside(), caption: 'Mỗi phía có hai chân đã nối sẵn bằng một lá kim loại (a1–a2, b1–b2). Nhấn nút, mái vòm kim loại ép xuống nối hai lá lại. Vì vậy hãy cắm nút vắt qua rãnh giữa breadboard và dùng hai chân chéo nhau.' },
      {
        kind: 'svg',
        title: 'Nối với ESP32 (INPUT_PULLUP)',
        viewBox: '0 0 340 160',
        svg:
          esp.svg +
          sch.wire([esp.pin.GPIO4!, [200, 60]], 'sch-s') +
          sch.switchSym([200, 60], [200, 120], false, 'Nút nhấn') +
          sch.wire([[200, 120], esp.pin.GND!]) +
          sch.text(106, 52, 'kéo lên ~45 kΩ bên trong chip', { anchor: 'start', cls: 'sch-m', size: 9.5 }),
        caption: 'Bật điện trở kéo lên có sẵn trong chip bằng pinMode(4, INPUT_PULLUP): chân ở HIGH khi nút nhả; nhấn nút nối chân xuống GND nên đọc được LOW. Không cần thêm điện trở ngoài.',
      },
      {
        kind: 'timing',
        title: 'Dội phím: tín hiệu khi nhấn rồi nhả',
        end: 90,
        signals: [
          { name: 'Ngón tay', steps: [[0, 0], [20, 1], [60, 0]], color: 'var(--ink-3)' },
          { name: 'GPIO4', steps: bouncy },
          { name: 'Sau chống dội', steps: [[0, 1], [20, 0], [62, 1]], color: 'var(--ok)' },
        ],
        spans: p.bounce
          ? [
              { row: 1, from: 20, to: 28, label: 'dội 1–5 ms' },
              { row: 1, from: 60, to: 67.5, label: 'dội khi nhả' },
              { row: 2, from: 20, to: 40, label: 'chờ ~20 ms rồi mới tin' },
            ]
          : [],
        caption: p.bounce
          ? 'Tiếp điểm kim loại nảy lên xuống vài lần trước khi nằm yên, nên một lần nhấn có thể bị đếm thành nhiều lần. Chống dội: chỉ chấp nhận mức mới khi nó giữ nguyên khoảng 20 ms.'
          : 'Đang tắt dội phím: tiếp điểm đóng mở gọn gàng. Bật "bounce" để thấy tín hiệu thật trông thế nào.',
      },
    ];
  },
};
