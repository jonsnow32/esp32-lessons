import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { FORWARD_VOLTAGE, type RgbLedProps } from './index';

/** Additive mixing: three lights overlapping on black, with the colour each overlap makes. */
function mixing(): string {
  const c = (x: number, y: number, fill: string) => `<circle cx="${x}" cy="${y}" r="58" fill="${fill}" style="mix-blend-mode: screen"/>`;
  return `
    <rect x="0" y="0" width="400" height="230" fill="#0f1215"/>
    <g style="isolation: isolate">${c(160, 92, '#ff2020')}${c(232, 92, '#20ff40')}${c(196, 152, '#2050ff')}</g>
    ${[
      [118, 64, 'Đỏ'], [276, 64, 'Xanh lá'], [196, 206, 'Xanh dương'],
      [196, 66, 'Vàng'], [150, 150, 'Tím'], [244, 150, 'Ngọc'], [196, 118, 'Trắng'],
    ].map(([x, y, t]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="11" font-weight="700" fill="${t === 'Trắng' || t === 'Vàng' || t === 'Ngọc' ? '#15191d' : '#fff'}" font-family="var(--font-ui)">${t}</text>`).join('')}`;
}

/** Inside the lens: three dies on the common lead, each bonded to its own leg. */
function inside(common: RgbLedProps['common']): string {
  const legs = [
    { x: 150, name: 'R', color: '#e5484d', len: 196 },
    { x: 185, name: common === 'cathode' ? '− chung' : '+ chung', color: 'var(--ink-2)', len: 216 },
    { x: 220, name: 'G', color: '#30a46c', len: 196 },
    { x: 255, name: 'B', color: '#3e63dd', len: 196 },
  ];
  return `
    <path d="M140,150 V70 A62,62 0 0 1 264,70 V150 Z" fill="#e6e9ee" fill-opacity="0.55" stroke="#8b8d98" stroke-width="1.6"/>
    <rect x="132" y="150" width="140" height="10" fill="#e6e9ee" stroke="#8b8d98"/>
    <path class="sch-metal" d="M178,160 V112 H168 V100 H202 V112 H192 V160 Z"/>
    ${[['#e5484d', 172], ['#30a46c', 182], ['#3e63dd', 192]].map(([c, x]) => `<rect x="${x}" y="92" width="8" height="8" fill="${c}"/>`).join('')}
    <path d="M176,92 Q160,70 150,120 M186,92 Q205,66 220,120 M196,92 Q236,64 255,120" fill="none" stroke="#c9a227" stroke-width="1.2"/>
    ${legs.map((l) => `<path d="M${l.x},${l.x === 185 ? 160 : 120} V${l.len}" stroke="#a7adb4" stroke-width="4"/>${sch.text(l.x, l.len + 14, l.name, { size: 10.5 }).replace('class="sch-t ', `style="fill:${l.color}" class="sch-t `)}`).join('')}
    ${sch.callout([196, 96], [290, 50], 'Ba chip R, G, B')}
    ${sch.callout([185, 140], [290, 140], 'Chân chung (dài nhất)')}`;
}

export const doc: PartDoc<RgbLedProps> = {
  active: { red: 1, green: 0, blue: 0.9 },
  specs: (p) => [
    ['Kiểu chân chung', p.common === 'cathode' ? 'Cathode chung (−)' : 'Anode chung (+)'],
    ['Vf đỏ / xanh lá / xanh dương', `${sch.num(FORWARD_VOLTAGE.red)} / ${sch.num(FORWARD_VOLTAGE.green)} / ${sch.num(FORWARD_VOLTAGE.blue)} V`],
    ['Dòng mỗi màu', '20 mA, tối đa 30 mA'],
    ['Điện trở mỗi màu', '220 Ω'],
    ['Bật một màu', p.common === 'cathode' ? 'digitalWrite(chân, HIGH)' : 'digitalWrite(chân, LOW)'],
  ],
  figures: (p) => {
    const cathode = p.common === 'cathode';
    const esp = sch.esp32(14, 10, [{ name: 'GPIO21', dy: 30 }, { name: 'GPIO19', dy: 66 }, { name: 'GPIO18', dy: 102 }, { name: cathode ? 'GND' : '3V3', dy: 150 }], 166);
    const rows: [string, string, number][] = [['GPIO21', '#e5484d', 40], ['GPIO19', '#30a46c', 76], ['GPIO18', '#3e63dd', 112]];
    const wiring =
      esp.svg +
      rows
        .map(([pin, color, y]) =>
          sch.resistor(esp.pin[pin]!, [190, y], y === 40 ? '220 Ω' : undefined) +
          (cathode ? sch.diode([190, y], [270, y], { led: true, color }) : sch.diode([270, y], [190, y], { led: true, color })),
        )
        .join('') +
      sch.wire([[270, 40], [300, 40], [300, 160], esp.pin[cathode ? 'GND' : '3V3']!]) +
      sch.dot(300, 76) + sch.wire([[270, 76], [300, 76]]) +
      sch.dot(300, 112) + sch.wire([[270, 112], [300, 112]]) +
      sch.text(306, 100, 'chân chung', { anchor: 'start', cls: 'sch-m', size: 10 });
    return [
      { kind: 'svg', title: 'Trộn màu ánh sáng', viewBox: '0 0 400 230', svg: mixing(), caption: 'Ánh sáng cộng màu: đỏ + xanh lá = vàng, đỏ + xanh dương = tím, xanh lá + xanh dương = ngọc, cả ba = trắng. Mắt ta thấy ba chip nhỏ đứng sát nhau như một màu duy nhất.' },
      { kind: 'svg', title: 'Bên trong LED RGB', viewBox: '0 0 420 236', svg: inside(p.common), caption: 'Ba chip LED nằm trên cùng một đế nối với chân chung. Mỗi chân màu nối với một chip qua dây vàng, nên có thể bật từng màu riêng.' },
      {
        kind: 'svg',
        title: `Nối với ESP32 (${cathode ? 'cathode' : 'anode'} chung)`,
        viewBox: '0 0 380 190',
        svg: wiring,
        caption: cathode
          ? 'Chân chung xuống GND; mỗi màu qua một điện trở 220 Ω tới một GPIO. Chân ở HIGH thì màu đó sáng.'
          : 'Chân chung lên 3V3; mỗi màu qua 220 Ω tới một GPIO. Logic bị đảo: chân ở LOW thì màu sáng, HIGH thì tắt.',
      },
      {
        kind: 'timing',
        title: 'Pha màu hồng bằng PWM (analogWrite)',
        end: 100,
        signals: [
          { name: 'Đỏ 100 %', steps: [[0, 1]], color: '#e5484d' },
          { name: 'Xanh lá 20 %', steps: [[0, 1], [5, 0], [25, 1], [30, 0], [50, 1], [55, 0], [75, 1], [80, 0]], color: '#30a46c' },
          { name: 'Xanh d. 60 %', steps: [[0, 1], [15, 0], [25, 1], [40, 0], [50, 1], [65, 0], [75, 1], [90, 0]], color: '#3e63dd' },
        ],
        spans: [{ row: 2, from: 0, to: 25, label: '1 chu kỳ PWM (~0,2 ms)' }],
        caption: 'Bật tắt rất nhanh, mắt chỉ thấy độ sáng trung bình. Đổi tỉ lệ thời gian sáng (duty) của từng màu là pha được hàng triệu màu.',
      },
    ];
  },
};
