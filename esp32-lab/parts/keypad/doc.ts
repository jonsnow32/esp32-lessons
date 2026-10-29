import { sch, type PartDoc, type PartProps } from '@esp32lab/part-sdk';
import { KEYS } from './index';

/** The matrix: 4 row lines, 4 column lines, a switch at every crossing; key 5 is shown pressed. */
function matrix(): string {
  const x0 = 80, y0 = 30, step = 50;
  let svg = '';
  for (let r = 0; r < 4; r++) {
    svg += sch.wire([[40, y0 + r * step], [x0 + 3 * step + 30, y0 + r * step]]) + sch.text(34, y0 + r * step + 4, `R${r + 1}`, { anchor: 'end', cls: 'sch-a', size: 10 });
  }
  for (let c = 0; c < 4; c++) {
    svg += sch.wire([[x0 + c * step + 16, y0 - 14], [x0 + c * step + 16, y0 + 3 * step + 16]]) + sch.text(x0 + c * step + 16, y0 + 3 * step + 32, `C${c + 1}`, { cls: 'sch-s', size: 10 });
  }
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = x0 + c * step, y = y0 + r * step;
      const on = r === 1 && c === 1;
      svg += sch.dot(x, y) + `<path class="sch-w ${on ? 'sch-s' : ''}" d="M${x},${y} L${x + (on ? 16 : 13)},${y + (on ? 12 : 4)}"/>` + sch.dot(x + 16, y + 12) + sch.text(x + 4, y + 26, KEYS[r]![c]!, { size: 9.5, cls: on ? 'sch-strong' : 'sch-m' });
    }
  }
  return svg;
}

export const doc: PartDoc<PartProps> = {
  active: { pressed: '5', count: 1 },
  specs: () => [
    ['Số phím', '16 (4 hàng × 4 cột)'],
    ['Số dây', '8: R1–R4, C1–C4'],
    ['Điện trở khi nhấn', '≈ 100 Ω'],
    ['Điện áp / dòng tối đa', '24 V / 30 mA'],
    ['Độ bền', '≈ 1 triệu lần nhấn'],
  ],
  figures: () => {
    const scan: [number, 0 | 1][][] = [0, 1, 2, 3].map((r) => [[0, 1], [r * 10 + 1, 0], [r * 10 + 9, 1]]);
    return [
      { kind: 'svg', title: 'Ma trận bên trong', viewBox: '0 0 300 230', svg: matrix(), caption: 'Mỗi phím là một công tắc nối một dây hàng với một dây cột. Phím 5 đang được nhấn: nó nối R2 với C2. Nhờ vậy 16 phím chỉ cần 8 dây thay vì 17.' },
      {
        kind: 'timing',
        title: 'Quét tìm phím 5',
        end: 40,
        signals: [
          { name: 'R1', steps: scan[0]! },
          { name: 'R2', steps: scan[1]! },
          { name: 'R3', steps: scan[2]! },
          { name: 'R4', steps: scan[3]! },
          { name: 'C2', steps: [[0, 1], [11, 0], [19, 1]], color: 'var(--signal)' },
        ],
        spans: [{ row: 4, from: 11, to: 19, label: 'C2 LOW khi quét R2 → phím 5' }],
        caption: 'Code kéo lần lượt R1, R2, R3, R4 xuống LOW và đọc 4 cột (đặt INPUT_PULLUP). Chỉ khi R2 đang LOW thì C2 mới bị kéo xuống theo, qua phím 5 đang nhấn. Các cột khác vẫn HIGH. Thư viện Keypad quét như vậy hàng trăm lần mỗi giây.',
      },
    ];
  },
};
