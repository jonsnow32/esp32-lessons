import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { DIGITS, FORWARD_VOLTAGE, type Segment, type SevenSegmentProps } from './index';

const vi = sch.num;
const INK = { red: '#e5484d', green: '#30a46c', blue: '#3e63dd', yellow: '#d4a106' } as const;

/** One digit drawn at (x, y), 40 px wide: the segments it lights in colour, the rest grey. */
function digit(x: number, y: number, lit: Segment[], color: string, letters = false): string {
  const on = new Set(lit);
  const t = 7;
  const bars: Record<Exclude<Segment, 'dp'>, [number, number, number, number]> = {
    a: [x + t, y, 26, t], g: [x + t, y + 33, 26, t], d: [x + t, y + 66, 26, t],
    f: [x, y + t, t, 26], b: [x + 33, y + t, t, 26], e: [x, y + 40, t, 26], c: [x + 33, y + 40, t, 26],
  };
  let svg = '';
  for (const [s, [bx, by, w, h]] of Object.entries(bars)) {
    svg += `<rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="2" fill="${on.has(s as Segment) ? color : 'var(--line-strong)'}"/>`;
    if (letters) svg += sch.text(bx + w / 2, by + h / 2 + 4, s, { size: 10, cls: on.has(s as Segment) ? 'sch-strong' : 'sch-m' });
  }
  svg += `<circle cx="${x + 47}" cy="${y + 70}" r="4" fill="${on.has('dp') ? color : 'var(--line-strong)'}"/>`;
  if (letters) svg += sch.text(x + 47, y + 86, 'dp', { size: 9.5, cls: 'sch-m' });
  return svg;
}

export const doc: PartDoc<SevenSegmentProps> = {
  active: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, dp: 1, digit: 8 },
  specs: (p) => {
    const vf = FORWARD_VOLTAGE[p.color];
    return [
      ['Kiểu', p.common === 'cathode' ? 'Chung cathode (CC): chân chung nối GND' : 'Chung anode (CA): chân chung nối 3V3'],
      ['Thanh sáng khi GPIO', p.common === 'cathode' ? 'HIGH' : 'LOW'],
      ['Điện áp mỗi thanh', `${vi(vf)} V ở 10 mA`],
      ['Dòng mỗi thanh', '5–20 mA (tối đa 25 mA)'],
      ['Điện trở mỗi thanh ở 3,3 V', `${Math.ceil((3.3 - vf) / 0.01)} Ω cho 10 mA (dùng 220 Ω)`],
      ['Số chân', '10: 8 thanh + 2 chân chung (nối sẵn bên trong)'],
    ];
  },
  figures: (p) => {
    const color = INK[p.color];
    const cc = p.common === 'cathode';
    const table = Array.from({ length: 10 }, (_, d) => digit(14 + d * 58, 30, DIGITS[d]!, color) + sch.text(34 + d * 58, 124, String(d), { cls: 'sch-strong' })).join('');
    const esp = sch.esp32(14, 10, [{ name: 'GPIO26', dy: 40 }, { name: 'GPIO27', dy: 80 }, { name: cc ? 'GND' : '3V3', dy: 140 }], 156);
    const vf = FORWARD_VOLTAGE[p.color];
    return [
      {
        kind: 'svg',
        title: 'Tên các thanh và chân',
        viewBox: '0 0 380 190',
        svg:
          digit(40, 40, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'], color, true) +
          `<rect x="190" y="20" width="150" height="150" fill="none" class="sch-b"/>` +
          ['g', 'f', 'chung', 'a', 'b'].map((n, i) => sch.text(206 + i * 30, 14, n, { size: 10, cls: n === 'chung' ? 'sch-a' : '' })).join('') +
          ['e', 'd', 'chung', 'c', 'dp'].map((n, i) => sch.text(206 + i * 30, 186, n, { size: 10, cls: n === 'chung' ? 'sch-a' : '' })).join('') +
          [0, 1, 2, 3, 4].map((i) => `<circle class="sch-b" cx="${206 + i * 30}" cy="26" r="3"/><circle class="sch-b" cx="${206 + i * 30}" cy="164" r="3"/>`).join('') +
          sch.text(265, 100, 'nhìn từ trên', { cls: 'sch-m', size: 10 }),
        caption: 'Bảy thanh được đặt tên a đến g theo chiều kim đồng hồ từ thanh trên cùng, g là thanh giữa, dp là dấu chấm. Hai chân giữa của hai hàng là chân chung, đã nối với nhau bên trong.',
      },
      { kind: 'svg', title: 'Các thanh cần bật cho từng số', viewBox: '0 0 594 136', svg: table, caption: 'Đây chính là bảng mà code phải lưu: mỗi số là một tổ hợp 7 bit (mỗi bit một thanh). Ví dụ số 7 chỉ cần a, b, c.' },
      {
        kind: 'svg',
        title: 'Nối với ESP32 (2 trong 8 thanh)',
        viewBox: '0 0 380 170',
        svg:
          esp.svg +
          sch.resistor(esp.pin.GPIO26!, [196, 50], '220 Ω') +
          (cc ? sch.diode([196, 50], [276, 50], { led: true, color, label: 'a' }) : sch.diode([276, 50], [196, 50], { led: true, color, label: 'a' })) +
          sch.resistor(esp.pin.GPIO27!, [196, 90], '220 Ω') +
          (cc ? sch.diode([196, 90], [276, 90], { led: true, color, label: 'b' }) : sch.diode([276, 90], [196, 90], { led: true, color, label: 'b' })) +
          sch.wire([[276, 50], [310, 50], [310, 150], esp.pin[cc ? 'GND' : '3V3']!]) +
          sch.wire([[276, 90], [310, 90]]) +
          sch.dot(310, 90) +
          sch.text(318, 120, 'chân chung', { anchor: 'start', cls: 'sch-a', size: 10 }),
        caption: cc
          ? `Chung cathode: chân chung về GND, mỗi thanh một GPIO qua điện trở riêng. digitalWrite(pin, HIGH) là thanh sáng, dòng ≈ (3,3 − ${vi(vf)}) ÷ 220 ≈ ${vi(((3.3 - vf) / 220) * 1000)} mA.`
          : `Chung anode: chân chung lên 3V3, đèn quay ngược lại. digitalWrite(pin, LOW) là thanh sáng: dòng đi từ 3V3 qua thanh và điện trở vào chân GPIO đang ở 0 V.`,
      },
    ];
  },
};
