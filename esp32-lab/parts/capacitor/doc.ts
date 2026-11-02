import { parseCapacitance, sch, type PartDoc } from '@esp32lab/part-sdk';
import type { CapacitorProps } from './index';

/** Code printed on a ceramic capacitor, in pF: 104 = 10 × 10⁴ pF = 100 nF; under 100 pF the value itself. */
export function capCode(c: number): string {
  const pf = Math.round(c * 1e12);
  if (pf < 100) return String(pf);
  const exp = Math.floor(Math.log10(pf)) - 1;
  return `${Math.round(pf / 10 ** exp)}${exp}`;
}

/** The resistor the doc's examples charge through. */
const R = 10_000;

/** v(t) = 3.3·(1 − e^(−t/τ)) from 0 to 5τ, t in units of τ on the x axis. */
export function chargeCurve(): [number, number][] {
  return Array.from({ length: 26 }, (_, i) => {
    const t = i / 5;
    return [t, 3.3 * (1 - Math.exp(-t))];
  });
}

export const doc: PartDoc<CapacitorProps> = {
  specs: (p) => {
    const c = parseCapacitance(p.capacitance);
    return [
      ['Điện dung', `${sch.farad(c)} (mã ${capCode(c)})`],
      ['Chiều cắm', 'Không phân cực'],
      ['τ = R × C với R = 10 kΩ', sch.seconds(R * c)],
      ['Điện áp chịu được', '50 V'],
    ];
  },
  figures: (p) => {
    const c = parseCapacitance(p.capacitance);
    const tau = R * c;
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GND', dy: 104 }], 122);
    return [
      {
        kind: 'chart',
        title: 'Tụ nạp qua điện trở 10 kΩ từ 3,3 V',
        x: { label: 'Thời gian (× τ)', min: 0, max: 5 },
        y: { label: 'Điện áp trên tụ (V)', min: 0, max: 3.5 },
        series: [{ points: chargeCurve(), label: 'Điện áp tụ' }],
        marks: [{ x: 1, y: 3.3 * (1 - Math.exp(-1)), label: `τ = ${sch.seconds(tau)} → 63 %` }],
        caption: `Điện áp tụ không nhảy ngay lên 3,3 V mà tăng dần: sau τ = R × C = ${sch.seconds(tau)} được 63 %, sau 5τ = ${sch.seconds(5 * tau)} coi như đầy. Xả qua điện trở cũng theo đường cong y hệt, theo chiều ngược lại.`,
      },
      {
        kind: 'svg',
        title: 'Tụ lọc nguồn',
        viewBox: '0 0 390 150',
        svg:
          esp.svg +
          sch.wire([esp.pin['3V3']!, [250, 34], [250, 58]]) +
          sch.capacitor([250, 58], [250, 92], sch.farad(c)) +
          sch.wire([[250, 92], [250, 114], esp.pin.GND!]),
        caption: 'Cắm tụ giữa 3,3 V và GND, càng sát chân nguồn của module càng tốt: tụ cấp bù dòng trong những lúc module hút điện đột ngột, nên điện áp nguồn bớt bị giật.',
      },
    ];
  },
};
