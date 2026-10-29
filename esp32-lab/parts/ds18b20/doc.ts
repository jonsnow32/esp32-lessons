import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { encodeTemperature, type Ds18b20Props } from './index';

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

export const doc: PartDoc<Ds18b20Props> = {
  active: { converting: true },
  specs: (p) => {
    const raw = encodeTemperature(p.temperature, 12);
    return [
      ['Dải đo', '−55 … 125 °C, ±0,5 °C trong −10 … 85 °C'],
      ['Độ phân giải', '9–12 bit: bước 0,5 / 0,25 / 0,125 / 0,0625 °C'],
      ['Thời gian đo', '94 ms (9 bit) … 750 ms (12 bit)'],
      ['Nguồn', '3,0–5,5 V, ~1 mA khi đo'],
      ['Giao tiếp', '1-Wire, mã ROM 64 bit riêng cho mỗi con'],
      ['Thanh ghi nhiệt độ', `${hex(raw)} = ${raw << 16 >> 16} ÷ 16 = ${sch.num((raw << 16 >> 16) / 16, 4)} °C`],
    ];
  },
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 26 }, { name: 'GPIO4', dy: 74 }, { name: 'GND', dy: 122 }], 138);
    const mod = sch.block(266, 10, 'DS18B20', [{ name: 'VDD', dy: 26 }, { name: 'DQ', dy: 74 }, { name: 'GND', dy: 122 }], { side: 'left', w: 76, h: 138 });
    return [
      {
        kind: 'timing',
        title: 'Các khe thời gian 1-Wire',
        end: 120,
        signals: [
          { name: 'Reset', steps: [[0, 1], [4, 0], [52, 1], [56, 0], [68, 1], [120, 1]] },
          { name: 'Ghi 1', steps: [[0, 1], [10, 0], [12, 1]] },
          { name: 'Ghi 0', steps: [[0, 1], [40, 0], [48, 1]] },
          { name: 'Đọc 0', steps: [[0, 1], [80, 0], [84, 1]], color: 'var(--signal)' },
        ],
        spans: [
          { row: 0, from: 4, to: 52, label: 'ESP32 kéo ≥ 480 µs' },
          { row: 0, from: 56, to: 68, label: 'cảm biến báo có mặt' },
          { row: 1, from: 10, to: 12, label: '< 15 µs' },
          { row: 2, from: 40, to: 48, label: '60 µs' },
          { row: 3, from: 80, to: 84, label: 'cảm biến giữ LOW' },
        ],
        caption: 'Chỉ có một dây, nên mọi thứ đều là "kéo dây xuống bao lâu". Reset: ESP32 kéo xuống ≥ 480 µs, cảm biến đáp lại bằng một xung LOW. Ghi bit: kéo xuống ngắn là 1, dài là 0. Đọc bit: ESP32 kéo xuống một chút rồi thả, nếu cảm biến giữ dây LOW thêm thì bit đó là 0.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 360 156',
        svg:
          esp.svg + mod.svg +
          sch.wire([esp.pin['3V3']!, mod.pin.VDD!]) +
          sch.wire([esp.pin.GPIO4!, mod.pin.DQ!], 'sch-s') +
          sch.wire([esp.pin.GND!, mod.pin.GND!]) +
          sch.dot(200, 36) + sch.dot(200, 84) +
          sch.resistor([200, 36], [200, 84], '4,7 kΩ', 'kéo lên'),
        caption: 'DQ chỉ biết kéo dây xuống (open-drain), nên phải có điện trở 4,7 kΩ đưa dây về 3,3 V lúc rảnh. Thiếu nó, thư viện báo −127 °C (không thấy cảm biến). Nhiều DS18B20 có thể cắm chung chân DQ đó.',
      },
    ];
  },
};
