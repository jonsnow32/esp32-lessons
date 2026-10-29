import { sch, type PartDoc } from '@esp32lab/part-sdk';
import manifest from './part.json';
import { bands, type ResistorProps } from './index';

const COLOR_NAME = ['đen', 'nâu', 'đỏ', 'cam', 'vàng', 'lục', 'lam', 'tím', 'xám', 'trắng'];

/** The resistor large, each band called out with what it stands for. */
function colorCode(r: number): string {
  const exp = Math.max(0, Math.floor(Math.log10(r)) - 1);
  const digits = Math.round(r / 10 ** exp);
  const [b1, b2, b3, b4] = bands(r) as [string, string, string, string];
  const cols = [
    { x: 148, c: b1, name: 'Vạch 1', value: String(Math.floor(digits / 10)), color: COLOR_NAME[Math.floor(digits / 10)]! },
    { x: 182, c: b2, name: 'Vạch 2', value: String(digits % 10), color: COLOR_NAME[digits % 10]! },
    { x: 216, c: b3, name: 'Hệ số', value: `× ${10 ** exp}`, color: COLOR_NAME[exp]! },
    { x: 288, c: b4, name: 'Sai số', value: '± 5 %', color: 'nhũ vàng' },
  ];
  return `
    <path d="M30,60 H390" stroke="#a7adb4" stroke-width="5" stroke-linecap="round"/>
    <rect x="110" y="34" width="200" height="52" rx="22" fill="#dfc08b" stroke="#7a5f3c" stroke-width="1.4"/>
    ${cols.map((k) => `<rect x="${k.x - 8}" y="34.7" width="16" height="50.6" fill="${k.c}" stroke="#00000030"/>`).join('')}
    <rect x="110" y="34" width="200" height="18" rx="9" fill="#fff" opacity="0.25"/>
    ${cols
      .map(
        (k, i) => `
      <path class="sch-lead" d="M${k.x},88 V${104} H${70 + i * 94} V112"/>
      ${sch.text(70 + i * 94, 128, k.name, { cls: 'sch-m', size: 10 })}
      ${sch.text(70 + i * 94, 148, k.value, { cls: 'sch-strong', size: 15 })}
      <rect x="${48 + i * 94}" y="158" width="10" height="10" fill="${k.c}" stroke="#0004"/>
      ${sch.text(62 + i * 94, 167, k.color, { anchor: 'start', cls: 'sch-ui', size: 10.5 })}`,
      )
      .join('')}
    ${sch.text(210, 198, `${Math.floor(digits / 10)}${digits % 10} × ${10 ** exp} = ${sch.ohm(r)}`, { cls: 'sch-a', size: 13 })}`;
}

export const doc: PartDoc<ResistorProps> = {
  specs: (p) => [
    ['Giá trị', sch.ohm(p.resistance)],
    ['Sai số', '± 5 % (vạch nhũ vàng)'],
    ['Công suất tối đa', '0,25 W (1/4 W)'],
    ['Dòng ở 3,3 V', `${sch.num((3.3 / p.resistance) * 1000, 2)} mA`],
    ['Điện áp tối đa an toàn', `${sch.num(Math.sqrt(manifest.ratings.powerMax * p.resistance), 1)} V`],
  ],
  figures: (p) => {
    const r = p.resistance;
    const iMax = Math.max(0.5, (5 / r) * 1000 * 1.15);
    const vout = (3.3 * 10_000) / (r + 10_000);
    return [
      { kind: 'svg', title: 'Đọc mã màu', viewBox: '0 0 420 210', svg: colorCode(r), caption: 'Đọc từ phía vạch nằm sát đầu (xa vạch nhũ vàng/bạc): hai vạch đầu là hai chữ số, vạch thứ ba là số chữ số 0 thêm vào, vạch cuối là sai số.' },
      {
        kind: 'chart',
        title: 'Định luật Ohm: I = U ÷ R',
        x: { label: 'Điện áp hai đầu U (V)', min: 0, max: 5 },
        y: { label: 'Dòng điện I (mA)', min: 0, max: +iMax.toPrecision(2) },
        series: (manifest.props.resistance.options as number[]).map((o) => ({ points: [[0, 0], [5, (5 / o) * 1000]] as [number, number][], label: sch.ohm(o), muted: o !== r })),
        marks: [{ x: 3.3, y: (3.3 / r) * 1000, label: `3,3 V → ${sch.num((3.3 / r) * 1000, 2)} mA` }],
        caption: 'Mỗi điện trở là một đường thẳng qua gốc: điện áp tăng gấp đôi thì dòng cũng gấp đôi. Điện trở càng lớn, đường càng thoải, dòng càng nhỏ.',
      },
      {
        kind: 'svg',
        title: 'Cầu chia áp',
        viewBox: '0 0 360 190',
        svg:
          sch.supply(120, 30, '3V3') +
          sch.resistor([120, 30], [120, 90], `R1 = ${sch.ohm(r)}`) +
          sch.resistor([120, 90], [120, 150], 'R2 = 10 kΩ') +
          sch.gnd(120, 150) +
          sch.dot(120, 90) +
          sch.wire([[120, 90], [230, 90]], 'sch-s') +
          sch.text(236, 86, 'Vout → GPIO34', { anchor: 'start', cls: 'sch-s' }) +
          sch.text(236, 104, `= ${sch.num(vout, 2)} V`, { anchor: 'start', cls: 'sch-strong' }),
        caption: `Hai điện trở nối tiếp chia điện áp theo tỉ lệ: Vout = 3,3 V × R2 ÷ (R1 + R2). Đây là cách đọc quang trở, nhiệt điện trở hay biến trở bằng chân analog.`,
      },
    ];
  },
};
