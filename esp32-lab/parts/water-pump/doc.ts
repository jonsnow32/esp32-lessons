import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { flowAt, load, type WaterPumpProps } from './index';

const vi = sch.num;

export const doc: PartDoc<WaterPumpProps> = {
  active: { running: true },
  specs: () => [
    ['Điện áp', '3–5 V DC (chạy từ ≈ 2 V)'],
    ['Dòng ở 5 V', `≈ ${Math.round(load(5).i * 1000)} mA`],
    ['Lưu lượng ở 5 V', `≈ ${flowAt(5)} mL/s (90 L/giờ)`],
    ['Cột nước tối đa', '≈ 0,4–1 m'],
    ['Điều khiển', 'Qua relay hoặc MOSFET, không nối thẳng GPIO'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO23', dy: 64 }, { name: 'GND', dy: 104 }], 122);
    const mod = sch.block(196, 10, 'Relay', [{ name: 'VCC', dy: 26 }, { name: 'IN', dy: 64 }, { name: 'GND', dy: 104 }], { side: 'left', w: 70, h: 122 });
    const volts = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    return [
      {
        kind: 'chart',
        title: 'Lưu lượng theo điện áp',
        x: { label: 'Điện áp (V)', min: 0, max: 5 },
        y: { label: 'Lưu lượng (mL/s)', min: 0, max: 30 },
        series: [{ points: volts.map((v) => [v, flowAt(v)] as [number, number]), label: 'Nước' }],
        marks: [{ x: 3.3, y: flowAt(3.3), label: `3,3 V → ${vi(flowAt(3.3), 0)} mL/s` }],
        caption: 'Dưới khoảng 2 V cánh quạt chưa quay nổi. Cấp đủ 5 V từ VIN qua relay để nước lên mạnh nhất.',
      },
      {
        kind: 'svg',
        title: 'Nối qua relay',
        viewBox: '0 0 420 150',
        svg:
          esp.svg +
          mod.svg +
          sch.wire([esp.pin['VIN 5V']!, mod.pin.VCC!]) +
          sch.wire([esp.pin.GPIO23!, mod.pin.IN!], 'sch-s') +
          sch.wire([esp.pin.GND!, mod.pin.GND!]) +
          sch.text(300, 40, 'COM ← 5 V', { anchor: 'start', size: 10 }) +
          sch.text(300, 80, 'NO', { anchor: 'start', size: 10 }) +
          sch.wire([[266, 36], [296, 36]]) + sch.wire([[266, 76], [296, 76]]) +
          sch.wire([[322, 76], [390, 76], [390, 86]]) +
          `<circle class="sch-b" cx="390" cy="100" r="13"/>` + sch.text(390, 104, 'M', { size: 12 }) +
          sch.wire([[390, 113], [390, 134]]) +
          sch.text(360, 146, 'bơm → GND', { cls: 'sch-m', size: 10 }),
        caption: 'Relay đóng thì COM (nối VIN 5 V) chạm NO, dòng ≈ 180 mA chạy qua bơm xuống GND. Chân GPIO23 chỉ kích relay, không gánh dòng của động cơ.',
      },
    ];
  },
};
