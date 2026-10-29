import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { TiltSwitchProps } from './index';

/** The can in section, upright and tilted: the balls bridge the two contacts only when upright. */
function inside(): string {
  const can = (cx: number, angle: number, closed: boolean) => `
    <g transform="rotate(${angle} ${cx} 150)">
      <rect x="${cx - 34}" y="40" width="68" height="110" rx="6" fill="#c3c8ce" fill-opacity="0.35" stroke="#6f767e" stroke-width="1.6"/>
      <rect x="${cx - 38}" y="146" width="76" height="12" fill="#2a2d31"/>
      <path d="M${cx - 14},158 V136 M${cx + 14},158 V136" stroke="#6f767e" stroke-width="5"/>
      ${closed
        ? `<circle cx="${cx - 12}" cy="122" r="13" fill="#e8ebee" stroke="#6f767e"/><circle cx="${cx + 12}" cy="122" r="13" fill="#e8ebee" stroke="#6f767e"/>
           <path d="M${cx - 14},134 H${cx + 14}" stroke="var(--accent-hi)" stroke-width="4"/>`
        : `<circle cx="${cx - 12}" cy="56" r="13" fill="#e8ebee" stroke="#6f767e"/><circle cx="${cx + 12}" cy="56" r="13" fill="#e8ebee" stroke="#6f767e"/>`}
      <path d="M${cx - 14},158 V196 M${cx + 14},158 V196" stroke="#a7adb4" stroke-width="3"/>
    </g>`;
  return `${can(100, 0, true)}${can(270, 50, false)}
    ${sch.text(100, 216, 'Đứng thẳng: ĐÓNG', { cls: 'sch-a' })}
    ${sch.text(290, 216, 'Nghiêng > 45°: HỞ', { cls: 'sch-m' })}
    ${sch.callout([108, 112], [140, 22], 'Hai viên bi kim loại')}`;
}

export const doc: PartDoc<TiltSwitchProps> = {
  specs: (p) => [
    ['Trạng thái', p.tilted ? 'Nghiêng: hở mạch' : 'Đứng thẳng: đóng mạch'],
    ['Góc chuyển mạch', '≈ 45°'],
    ['Điện trở khi đóng', '< 10 Ω'],
    ['Dòng tối đa', '20 mA'],
    ['Đọc với INPUT_PULLUP', 'thẳng = LOW, nghiêng = HIGH'],
  ],
  figures: (p) => {
    const esp = sch.esp32(14, 20, [{ name: 'GPIO21', dy: 40 }, { name: 'GND', dy: 100 }], 120);
    return [
      { kind: 'svg', title: 'Bên trong ống SW-520D', viewBox: '0 0 400 226', svg: inside(), caption: 'Trọng lực làm hai viên bi luôn lăn xuống chỗ thấp nhất. Đứng thẳng, bi nằm đè lên hai tiếp điểm ở đáy nên mạch thông; nghiêng nhiều, bi lăn về phía nắp và mạch hở.' },
      {
        kind: 'svg',
        title: 'Nối với ESP32 (INPUT_PULLUP)',
        viewBox: '0 0 340 160',
        svg:
          esp.svg +
          sch.wire([esp.pin.GPIO21!, [200, 60]], 'sch-s') +
          sch.switchSym([200, 60], [200, 120], !p.tilted, 'SW-520D', p.tilted ? 'nghiêng: hở' : 'thẳng: đóng') +
          sch.wire([[200, 120], esp.pin.GND!]) +
          sch.text(150, 54, p.tilted ? 'đọc HIGH' : 'đọc LOW', { cls: 'sch-s' }),
        caption: 'Giống nút nhấn: một chân vào GPIO, chân kia xuống GND, bật điện trở kéo lên trong chip. Công tắc không có chiều.',
      },
      {
        kind: 'timing',
        title: 'Tín hiệu khi nghiêng rồi dựng lại',
        end: 100,
        signals: [
          { name: 'Góc nghiêng', steps: [[0, 0], [25, 1], [70, 0]], color: 'var(--ink-3)' },
          { name: 'GPIO21', steps: [[0, 0], [25, 1], [27, 0], [28, 1], [30, 0], [31.5, 1], [70, 0], [71.5, 1], [72.5, 0], [74, 1], [75, 0]] },
        ],
        spans: [{ row: 1, from: 25, to: 31.5, label: 'bi lăn lạch cạch' }],
        caption: 'Bi lăn và nảy nên tín hiệu cũng bị dội như nút nhấn. Chống dội trong code (chờ tín hiệu ổn định vài chục ms) trước khi kết luận là đã bị nghiêng.',
      },
    ];
  },
};
