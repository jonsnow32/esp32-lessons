import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { PirSensorProps } from './index';

/** Seen from above: the lens splits the room into fan-shaped zones; walking across them is "motion". */
function zones(): string {
  const cx = 200;
  const cy = 210;
  const wedge = (a0: number, a1: number, r: number) => {
    const p = (a: number) => `${(cx + r * Math.cos((a * Math.PI) / 180)).toFixed(1)},${(cy - r * Math.sin((a * Math.PI) / 180)).toFixed(1)}`;
    return `M${cx},${cy} L${p(a0)} A${r},${r} 0 0 0 ${p(a1)} Z`;
  };
  let fan = '';
  for (let a = 30; a < 150; a += 12) fan += `<path class="sch-zone" d="${wedge(a, a + 6, 190)}"/>`;
  return `
    ${fan}
    <path d="M${cx},${cy} m-170,-98 A196,196 0 0 1 ${cx + 170},${cy - 98}" fill="none" class="sch-lead" stroke-dasharray="4 4"/>
    <rect x="${cx - 26}" y="${cy - 6}" width="52" height="16" fill="#2f7d4a"/>
    <path d="M${cx - 18},${cy - 6} A18,18 0 0 1 ${cx + 18},${cy - 6} Z" fill="#f4f4f0" stroke="#aaa"/>
    <g transform="translate(120 70)">
      <circle cx="0" cy="-14" r="8" fill="var(--accent)"/>
      <path d="M0,-6 V14 M-10,2 H10 M0,14 l-8,14 M0,14 l8,14" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
    </g>
    ${sch.flow([140, 98], [270, 98], '', 'sch-a')}
    ${sch.text(205, 120, 'người đi ngang qua các vùng', { cls: 'sch-a', size: 10.5 })}
    ${sch.text(30, 108, '≈ 7 m', { anchor: 'start', cls: 'sch-m' })}
    ${sch.text(cx, 232, 'Góc nhìn ≈ 110°', { cls: 'sch-m' })}`;
}

export const doc: PartDoc<PirSensorProps> = {
  active: { output: true },
  specs: (p) => [
    ['Điện áp nguồn', '4,5–20 V (dùng chân 5V)'],
    ['Mức OUT', 'HIGH = 3,3 V, LOW = 0 V'],
    ['Thời gian giữ', `${p.hold} s (núm Tx trên module)`],
    ['Tầm phát hiện', '3–7 m, góc ~110°'],
    ['Khởi động', '≈ 30–60 s sau khi cấp điện'],
  ],
  figures: (p) => {
    const esp = sch.esp32(14, 10, [{ name: '5V', dy: 30 }, { name: 'GPIO19', dy: 70 }, { name: 'GND', dy: 110 }], 128);
    const mod = sch.block(240, 10, 'HC-SR501', [{ name: 'VCC', dy: 30 }, { name: 'OUT', dy: 70 }, { name: 'GND', dy: 110 }], { side: 'left', w: 80, h: 128 });
    const end = 30 + p.hold + 12;
    return [
      { kind: 'svg', title: 'Vùng quan sát (nhìn từ trên xuống)', viewBox: '0 0 400 240', svg: zones(), caption: 'Mái vòm trắng là một thấu kính Fresnel chia không gian thành nhiều dải. Cảm biến bên trong có hai nửa; khi một vật ấm như người đi từ dải này sang dải khác, hai nửa nhận nhiệt khác nhau và module bật OUT lên. Đứng yên thì không có gì thay đổi, nên không được phát hiện.' },
      {
        kind: 'timing',
        title: `Chân OUT khi có chuyển động (giữ ${p.hold} s)`,
        end,
        signals: [
          { name: 'Chuyển động', steps: [[0, 0], [8, 1], [30, 0]], color: 'var(--accent-hi)' },
          { name: 'OUT', steps: [[0, 0], [8, 1], [30 + p.hold, 0]] },
        ],
        spans: [
          { row: 0, from: 8, to: 30, label: 'còn người di chuyển' },
          { row: 1, from: 30, to: 30 + p.hold, label: `giữ thêm ${p.hold} s` },
        ],
        caption: 'OUT lên HIGH ngay khi thấy chuyển động và chỉ về LOW sau khi hết chuyển động một khoảng thời gian giữ. Muốn đèn tắt sớm hơn thì giảm thời gian giữ (núm Tx), muốn nhạy hơn thì tăng núm Sx.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 340 150',
        svg: esp.svg + mod.svg + sch.wire([esp.pin['5V']!, mod.pin.VCC!]) + sch.wire([esp.pin.GPIO19!, mod.pin.OUT!], 'sch-s') + sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Module cần 5 V (chân 5V hoặc VIN của board) nhưng chân OUT chỉ ra 3,3 V nên nối thẳng vào GPIO được. Đọc bằng digitalRead(): HIGH là có người.',
      },
    ];
  },
};
