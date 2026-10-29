import { Junction, sch, type PartDoc } from '@esp32lab/part-sdk';
import { FORWARD_VOLTAGE, type LedColor, type LedProps } from './index';

const INK: Record<LedColor, string> = { red: '#e5484d', yellow: '#d4a106', green: '#30a46c', blue: '#3e63dd', white: '#8b8d98' };
const NAME: Record<LedColor, string> = { red: 'đỏ', yellow: 'vàng', green: 'xanh lá', blue: 'xanh dương', white: 'trắng' };
const vi = sch.num;

/** I(V) of each colour from the same junction model the simulator uses, in mA. */
function curve(color: LedColor): [number, number][] {
  const j = Junction.fit(FORWARD_VOLTAGE[color], 0.02, 2);
  const out: [number, number][] = [];
  for (let v = 0; v <= 3.6; v += 0.01) {
    const i = j.current(v) * 1000;
    out.push([v, i]);
    if (i > 45) break;
  }
  return out;
}

/** Cut-away of a 5 mm LED: lens, die on the cathode anvil, bond wire to the anode post. */
function anatomy(color: LedColor): string {
  return `
    <path d="M160,165 V80 A50,50 0 0 1 260,80 V165 Z" fill="${INK[color]}" fill-opacity="0.22" stroke="${INK[color]}" stroke-width="1.6"/>
    <path d="M152,165 H262 V176 H152 Z" fill="${INK[color]}" fill-opacity="0.35" stroke="${INK[color]}" stroke-width="1.4"/>
    <path d="M262,163 V178" stroke="#15191d" stroke-width="2.5"/>
    <rect class="sch-metal" x="182" y="118" width="10" height="58"/>
    <path class="sch-metal" d="M224,176 V128 H218 L222,112 H252 L256,128 H246 V176 Z"/>
    <rect x="231" y="104" width="12" height="8" fill="#2a2d31"/>
    <path d="M237,104 Q210,82 187,118" fill="none" stroke="#c9a227" stroke-width="1.4"/>
    <path d="M187,176 V218" stroke="#a7adb4" stroke-width="4"/><path d="M235,176 V200" stroke="#a7adb4" stroke-width="4"/>
    ${sch.callout([248, 60], [284, 48], 'Thấu kính epoxy')}
    ${sch.callout([240, 106], [284, 90], 'Chip phát sáng (die)')}
    ${sch.callout([252, 132], [284, 132], 'Đế cực âm (to)')}
    ${sch.callout([262, 172], [284, 168], 'Mặt vát: phía cực âm')}
    ${sch.callout([235, 198], [284, 202], 'Chân ngắn: −')}
    ${sch.callout([206, 92], [140, 84], 'Dây vàng siêu nhỏ', 'end')}
    ${sch.callout([182, 140], [140, 136], 'Trụ cực dương (nhỏ)', 'end')}
    ${sch.callout([187, 214], [140, 214], 'Chân dài: +', 'end')}`;
}

export const doc: PartDoc<LedProps> = {
  active: { brightness: 1 },
  specs: (p) => {
    const vf = FORWARD_VOLTAGE[p.color];
    return [
      ['Điện áp thuận (Vf)', `${vi(vf)} V (${NAME[p.color]})`],
      ['Dòng định mức', '20 mA'],
      ['Dòng tối đa liên tục', '30 mA'],
      ['Điện áp ngược tối đa', '5 V'],
      ['Điện trở hạn dòng ở 3,3 V', `≥ ${Math.ceil((3.3 - vf) / 0.02)} Ω (dùng 220 Ω)`],
    ];
  },
  figures: (p) => {
    const vf = FORWARD_VOLTAGE[p.color];
    const i = ((3.3 - vf) / 220) * 1000;
    const esp = sch.esp32(14, 20, [{ name: 'GPIO2', dy: 40 }, { name: 'GND', dy: 104 }], 124);
    return [
      { kind: 'svg', title: 'Cấu tạo bên trong', viewBox: '0 0 420 228', svg: anatomy(p.color), caption: 'Nhìn từ bên hông: chip bán dẫn nằm trên đế lớn nối với chân âm, một sợi dây vàng nối nó sang trụ nhỏ của chân dương. Ánh sáng phát ra từ chip và được thấu kính tròn hội tụ lên trên.' },
      {
        kind: 'chart',
        title: 'Đặc tuyến dòng – áp (I–V)',
        x: { label: 'Điện áp giữa hai chân (V)', min: 0, max: 3.6 },
        y: { label: 'Dòng điện (mA)', min: 0, max: 40 },
        series: (Object.keys(FORWARD_VOLTAGE) as LedColor[]).map((c) => ({ points: curve(c), label: `LED ${NAME[c]}`, color: INK[c], muted: c !== p.color })),
        marks: [
          { y: 30, label: 'Giới hạn 30 mA', tone: 'error' },
          { x: vf, y: 20, label: `${vi(vf)} V → 20 mA` },
        ],
        caption: `Dưới khoảng ${vi(vf - 0.4)} V gần như không có dòng; vượt Vf một chút là dòng tăng vọt. Vì thế không bao giờ nối LED thẳng vào nguồn: luôn có một điện trở để giữ dòng ở mức an toàn.`,
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 360 160',
        svg:
          esp.svg +
          sch.resistor(esp.pin.GPIO2!, [196, 60], '220 Ω') +
          sch.diode([196, 60], [286, 60], { led: true, color: INK[p.color], label: 'LED', sub: 'chân dài ← → chân ngắn' }) +
          sch.wire([[286, 60], [320, 60], [320, 124], esp.pin.GND!]) +
          sch.flow([110, 36], [180, 36], `I ≈ ${vi(i)} mA`),
        caption: `Dòng đi từ GPIO qua điện trở, vào chân dài (+) và ra chân ngắn (−) về GND. Với LED ${NAME[p.color]}: I ≈ (3,3 V − ${vi(vf)} V) ÷ 220 Ω ≈ ${vi(i)} mA, đủ sáng và an toàn cho cả LED lẫn chân GPIO.`,
      },
    ];
  },
};
