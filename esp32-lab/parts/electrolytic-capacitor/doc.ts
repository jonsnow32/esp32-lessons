import { parseCapacitance, sch, type PartDoc } from '@esp32lab/part-sdk';
import type { ElectrolyticProps } from './index';

/** The resistor the doc's examples charge through. */
const R = 10_000;

export const doc: PartDoc<ElectrolyticProps> = {
  specs: (p) => {
    const c = parseCapacitance(p.capacitance);
    return [
      ['Điện dung', `${sch.farad(c)} ± 20 %`],
      ['Điện áp tối đa', p.voltage.replace('V', ' V')],
      ['Chiều cắm', 'Có phân cực: + (chân dài), − (vạch trắng)'],
      ['τ = R × C với R = 10 kΩ', sch.seconds(R * c)],
      ['Điện áp ngược chịu được', '≈ 1 V'],
    ];
  },
  figures: (p) => {
    const c = parseCapacitance(p.capacitance);
    const tau = R * c;
    const points = Array.from({ length: 26 }, (_, i): [number, number] => [i / 5, 3.3 * Math.exp(-i / 5)]);
    const esp = sch.esp32(14, 10, [{ name: '5V', dy: 24 }, { name: 'GND', dy: 104 }], 122);
    return [
      {
        kind: 'chart',
        title: 'Tụ đầy 3,3 V xả qua điện trở 10 kΩ',
        x: { label: 'Thời gian (× τ)', min: 0, max: 5 },
        y: { label: 'Điện áp trên tụ (V)', min: 0, max: 3.5 },
        series: [{ points, label: 'Điện áp tụ' }],
        marks: [{ x: 1, y: 3.3 * Math.exp(-1), label: `τ = ${sch.seconds(tau)} → còn 37 %` }],
        caption: `Ngắt nguồn thì tụ xả dần qua điện trở: sau τ = R × C = ${sch.seconds(tau)} còn 37 %, sau 5τ = ${sch.seconds(5 * tau)} coi như hết. Nạp thì theo đường cong ngược lại. Tụ càng lớn thì càng lâu.`,
      },
      {
        kind: 'svg',
        title: 'Giữ nguồn cho servo, relay',
        viewBox: '0 0 390 150',
        svg:
          esp.svg +
          sch.wire([esp.pin['5V']!, [250, 34], [250, 58]]) +
          sch.capacitor([250, 58], [250, 92], sch.farad(c), p.voltage.replace('V', ' V'), true) +
          sch.wire([[250, 92], [250, 114], esp.pin.GND!]),
        caption: 'Chân + vào nguồn, chân − vào GND. Lúc servo hay relay đóng, tụ cấp bù dòng tức thời để nguồn không bị sụt làm ESP32 khởi động lại.',
      },
    ];
  },
};
