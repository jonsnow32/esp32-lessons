import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { barColors, FORWARD_VOLTAGE, type LedBarProps } from './index';

const vi = sch.num;
const INK = { red: '#e5484d', green: '#30a46c', blue: '#3e63dd', yellow: '#d4a106' } as const;

export const doc: PartDoc<LedBarProps> = {
  active: Object.fromEntries([...Array.from({ length: 10 }, (_, i) => [`bar${i}`, i < 7 ? 1 : 0]), ['lit', 7]]),
  specs: (p) => {
    const vfs = [...new Set(barColors(p.color).map((c) => FORWARD_VOLTAGE[c]))];
    return [
      ['Số vạch', '10 LED độc lập, 20 chân (DIP-20)'],
      ['Điện áp mỗi vạch', `${vfs.map((v) => vi(v)).join(' / ')} V ở 10 mA`],
      ['Dòng mỗi vạch', '5–20 mA (tối đa 25 mA)'],
      ['Điện trở mỗi vạch ở 3,3 V', '220–330 Ω'],
    ];
  },
  figures: (p) => {
    const colors = barColors(p.color);
    const esp = sch.esp32(14, 10, [{ name: 'GPIO13', dy: 40 }, { name: 'GPIO12', dy: 80 }, { name: 'GND', dy: 130 }], 146);
    return [
      {
        kind: 'svg',
        title: 'Thanh mức: số vạch sáng theo giá trị',
        viewBox: '0 0 380 120',
        svg: [3, 7, 10]
          .map((n, row) =>
            colors.map((c, i) => `<rect x="${70 + i * 28}" y="${12 + row * 36}" width="20" height="26" rx="2" fill="${i < n ? INK[c] : 'var(--line-strong)'}"/>`).join('') +
            sch.text(56, 30 + row * 36, `${n * 10} %`, { anchor: 'end', cls: 'sch-strong', size: 10.5 }),
          )
          .join(''),
        caption: 'Đọc một giá trị (biến trở, cảm biến), đổi ra số vạch rồi bật từ vạch đầu tới vạch đó: n = map(giá trị, 0, 4095, 0, 10).',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32 (2 trong 10 vạch)',
        viewBox: '0 0 360 160',
        svg:
          esp.svg +
          sch.resistor(esp.pin.GPIO13!, [196, 50], '220 Ω') +
          sch.diode([196, 50], [276, 50], { led: true, color: INK[colors[0]!], label: 'vạch 1' }) +
          sch.resistor(esp.pin.GPIO12!, [196, 90], '220 Ω') +
          sch.diode([196, 90], [276, 90], { led: true, color: INK[colors[1]!], label: 'vạch 2' }) +
          sch.wire([[276, 50], [310, 50], [310, 140], esp.pin.GND!]) +
          sch.wire([[276, 90], [310, 90]]) +
          sch.dot(310, 90),
        caption: 'Mỗi vạch là một LED bình thường: chân + qua điện trở vào GPIO, chân − về GND. Cả 10 vạch cần 10 chân GPIO; muốn tiết kiệm chân thì dùng IC 74HC595.',
      },
    ];
  },
};
