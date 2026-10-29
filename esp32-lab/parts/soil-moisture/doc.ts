import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { outputRatio, type SoilMoistureProps } from './index';

const vi = sch.num;
const reading = (v: number) => Math.min(4095, Math.round((v / 3.1) * 4095));

export const doc: PartDoc<SoilMoistureProps> = {
  specs: (p) => {
    const v = 3.3 * outputRatio(p.moisture);
    return [
      ['Nguồn', '3,3–5,5 V, ~5 mA'],
      ['AOUT ở 3,3 V', `${vi(3.3 * outputRatio(0), 2)} V (khô) … ${vi(3.3 * outputRatio(100), 2)} V (ướt)`],
      ['Ở độ ẩm đang chọn', `${vi(v, 2)} V → analogRead ≈ ${reading(v)}`],
      ['Nguyên lý', 'Điện dung, không có kim loại chạm đất'],
    ];
  },
  figures: (p) => {
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 26 }, { name: 'GPIO34', dy: 66 }, { name: 'GND', dy: 106 }], 122);
    const mod = sch.block(256, 10, 'Độ ẩm đất', [{ name: 'VCC', dy: 26 }, { name: 'AOUT', dy: 66 }, { name: 'GND', dy: 106 }], { side: 'left', w: 84, h: 122 });
    const curve: [number, number][] = [0, 100].map((m) => [m, 3.3 * outputRatio(m)]);
    return [
      {
        kind: 'chart',
        title: 'Điện áp AOUT theo độ ẩm (nguồn 3,3 V)',
        x: { label: 'Độ ẩm đất (%)', min: 0, max: 100 },
        y: { label: 'AOUT (V)', min: 0, max: 3.3 },
        series: [{ points: curve, label: 'AOUT' }],
        marks: [{ x: p.moisture, y: 3.3 * outputRatio(p.moisture), label: `${p.moisture} % → ${vi(3.3 * outputRatio(p.moisture), 2)} V` }],
        caption: 'Đường đi xuống: đất càng ướt, điện áp càng thấp. Mỗi que và mỗi loại đất một khác, nên đo hai mốc khô và ướt của chính que mình rồi nội suy giữa chúng.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 360 140',
        svg: esp.svg + mod.svg + sch.wire([esp.pin['3V3']!, mod.pin.VCC!]) + sch.wire([esp.pin.GPIO34!, mod.pin.AOUT!], 'sch-s') + sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Ba dây: nguồn, đất và tín hiệu vào chân ADC1. Cấp 3,3 V để AOUT không vượt dải đo của ADC.',
      },
    ];
  },
};
