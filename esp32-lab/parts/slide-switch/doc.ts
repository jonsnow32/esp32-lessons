import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { SlideSwitchProps } from './index';

/** Cut-away: the slider's metal bridge joins the middle pin to the pin on its side. */
function inside(toB: boolean): string {
  const bx = toB ? 170 : 110;
  const kx = toB ? 196 : 124;
  return `
    <rect x="${kx}" y="12" width="40" height="34" fill="#2a2d31" stroke="#111"/>
    <rect x="60" y="40" width="240" height="72" fill="#c3c8ce" fill-opacity="0.35" stroke="#6f767e" stroke-width="1.4"/>
    ${[120, 180, 240].map((x) => `<rect x="${x - 12}" y="92" width="24" height="10" fill="#c3c8ce" stroke="#6f767e"/><path d="M${x},102 V170" stroke="#a7adb4" stroke-width="5"/>`).join('')}
    <path d="M${bx},86 H${bx + 80}" stroke="var(--accent-hi)" stroke-width="7" stroke-linecap="round"/>
    <path d="M${kx + 20},46 V82" stroke="#6f767e" stroke-width="3"/>
    ${sch.text(120, 188, 'a (trái)', { cls: toB ? 'sch-m' : 'sch-a' })}
    ${sch.text(180, 188, 'chung', { cls: 'sch-a' })}
    ${sch.text(240, 188, 'b (phải)', { cls: toB ? 'sch-a' : 'sch-m' })}
    ${sch.callout([kx + 40, 24], [316, 24], 'Cần gạt')}
    ${sch.callout([bx + 70, 86], [316, 72], 'Lá đồng nối 2 chân')}`;
}

export const doc: PartDoc<SlideSwitchProps> = {
  specs: (p) => [
    ['Kiểu', 'SPDT: 1 cực, 2 vị trí'],
    ['Đang nối', p.position === 'a' ? 'chung ↔ a (trái)' : 'chung ↔ b (phải)'],
    ['Dòng tối đa', '0,5 A ở 50 V'],
    ['Điện trở tiếp điểm', '≈ 50 mΩ'],
    ['Đọc trong mạch mẫu', p.position === 'a' ? 'LOW (0)' : 'HIGH (1)'],
  ],
  figures: (p) => {
    const toB = p.position === 'b';
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GPIO23', dy: 70 }, { name: 'GND', dy: 116 }], 134);
    const tip: [number, number] = toB ? [258, 50] : [258, 110];
    return [
      { kind: 'svg', title: 'Bên trong công tắc', viewBox: '0 0 440 198', svg: inside(toB), caption: 'Cần gạt kéo theo một lá đồng nằm dưới vỏ. Ở mỗi vị trí, lá đồng chạm chân giữa và đúng một chân ngoài, nên chân giữa luôn nối với chân phía cần gạt đang đứng.' },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 340 160',
        svg:
          esp.svg +
          sch.wire([esp.pin['3V3']!, [270, 34], [270, 50]]) +
          sch.wire([esp.pin.GND!, [270, 126], [270, 110]]) +
          sch.wire([esp.pin.GPIO23!, [210, 80]], 'sch-s') +
          `<circle class="sch-b" cx="212" cy="80" r="3"/><circle class="sch-b" cx="265" cy="50" r="3"/><circle class="sch-b" cx="265" cy="110" r="3"/>` +
          `<path class="sch-w" d="M214,80 L${tip[0]},${tip[1]}"/>` +
          sch.wire([[268, 50], [270, 50]]) +
          sch.wire([[268, 110], [270, 110]]) +
          sch.text(290, 54, 'b', { anchor: 'start', cls: toB ? 'sch-a' : 'sch-m' }) +
          sch.text(290, 114, 'a', { anchor: 'start', cls: toB ? 'sch-m' : 'sch-a' }) +
          sch.text(150, 74, toB ? 'đọc HIGH' : 'đọc LOW', { cls: 'sch-s' }),
        caption: 'Chân giữa vào GPIO, hai chân ngoài nối GND và 3V3: gạt về a thì chân GPIO ở 0 V (LOW), gạt về b thì ở 3,3 V (HIGH). Không cần điện trở kéo vì chân luôn được nối vào một mức rõ ràng.',
      },
    ];
  },
};
