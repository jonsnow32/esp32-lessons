import { sch, type PartDoc, type PartProps } from '@esp32lab/part-sdk';

export const doc: PartDoc<PartProps> = {
  active: { powered: true, pixels: 'ff0000 ff8000 ffff00 00ff00 00ffff 0000ff 8000ff ff00ff' },
  specs: () => [
    ['Nguồn', '3,5–5,3 V; tới 60 mA mỗi LED (trắng, sáng nhất)'],
    ['Dữ liệu', '800 kHz, 24 bit mỗi LED theo thứ tự G-R-B, bit cao trước'],
    ['Bit 0 / bit 1', 'HIGH 0,4 µs / 0,8 µs, cả bit dài 1,25 µs'],
    ['Chốt màu', 'DIN giữ LOW ≥ 50 µs'],
    ['Thời gian gửi', '30 µs mỗi LED: 60 LED ≈ 1,8 ms'],
    ['Trên ESP32', 'Adafruit_NeoPixel và FastLED gửi bằng ngoại vi RMT, không chiếm CPU'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO5', dy: 64 }, { name: 'GND', dy: 102 }], 118);
    const mod = sch.block(256, 10, 'WS2812B', [{ name: 'VCC', dy: 26 }, { name: 'DIN', dy: 64 }, { name: 'GND', dy: 102 }], { side: 'left', w: 96, h: 118 });
    return [
      {
        kind: 'timing',
        title: 'Ba bit trên dây DIN',
        end: 44,
        signals: [{ name: 'DIN', steps: [[0, 0], [2, 1], [6, 0], [14, 1], [22, 0], [26, 1], [30, 0], [44, 0]] }],
        spans: [
          { row: 0, from: 2, to: 6, label: '0: 0,4 µs' },
          { row: 0, from: 14, to: 22, label: '1: 0,8 µs' },
          { row: 0, from: 30, to: 44, label: 'LOW ≥ 50 µs: chốt' },
        ],
        caption: 'Độ dài của mỗi xung HIGH quyết định bit: ngắn là 0, dài là 1. Chip lấy 24 bit đầu cho mình, các bit sau đi thẳng ra DOUT. Khi dây đứng yên ở LOW đủ lâu, mọi LED cùng đổi sang màu vừa nhận.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 370 140',
        svg: esp.svg + mod.svg + sch.wire([esp.pin['VIN 5V']!, mod.pin.VCC!]) + sch.wire([esp.pin.GPIO5!, mod.pin.DIN!], 'sch-s') + sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Chung GND giữa dải LED và ESP32 là bắt buộc. Với dải dài, cấp 5 V từ nguồn riêng và thêm tụ 1000 µF giữa VCC và GND ở đầu dải.',
      },
    ];
  },
};
