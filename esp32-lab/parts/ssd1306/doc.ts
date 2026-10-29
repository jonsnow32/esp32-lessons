import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { Ssd1306Props } from './index';

/** GDDRAM: 8 pages of 128 columns; one byte is a column of 8 pixels, bit 0 on top. */
function pages(): string {
  let out = '';
  for (let p = 0; p < 8; p++) {
    out += `<rect x="60" y="${14 + p * 22}" width="256" height="20" fill="none" class="sch-b"/>` + sch.text(52, 28 + p * 22, `Trang ${p}`, { anchor: 'end', size: 9.5, cls: p === 2 ? 'sch-strong' : 'sch-m' });
  }
  const bits = [1, 0, 1, 1, 1, 1, 0, 1];
  out += bits.map((b, i) => `<rect x="${360}" y="${10 + i * 22}" width="18" height="18" fill="${b ? 'var(--accent-hi)' : 'var(--line-strong)'}"/>` + sch.text(390, 24 + i * 22, `bit ${i}`, { anchor: 'start', size: 9, cls: 'sch-m' })).join('');
  out += `<rect x="${60 + 40 * 2}" y="58" width="2" height="20" fill="var(--accent-hi)"/>` + sch.callout([141, 68], [350, 100], 'Một byte = 8 điểm dọc', 'end');
  return out;
}

export const doc: PartDoc<Ssd1306Props> = {
  active: { powered: true, on: true },
  specs: (p) => [
    ['Độ phân giải', '128 × 64 điểm, 0,96 inch'],
    ['Màu', p.color === 'white' ? 'Trắng trên nền đen' : 'Xanh dương trên nền đen'],
    ['Địa chỉ I2C', `${p.address}`],
    ['Nguồn', '3,3–5 V; 3–20 mA tuỳ số điểm sáng'],
    ['Bộ nhớ hình', '1024 byte: 8 trang × 128 cột'],
    ['Gửi một khung hình', '≈ 25 ms ở 400 kHz, ≈ 95 ms ở 100 kHz'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 26 }, { name: 'GPIO22', dy: 60 }, { name: 'GPIO21', dy: 94 }, { name: 'GND', dy: 128 }], 144);
    const mod = sch.block(256, 10, 'OLED SSD1306', [{ name: 'VCC', dy: 26 }, { name: 'SCL', dy: 60 }, { name: 'SDA', dy: 94 }, { name: 'GND', dy: 128 }], { side: 'left', w: 100, h: 144 });
    return [
      {
        kind: 'svg',
        title: 'Bộ nhớ hình trong chip',
        viewBox: '0 0 440 196',
        svg: pages(),
        caption: 'Màn hình chia thành 8 "trang" cao 8 điểm. Mỗi byte gửi tới là một cột 8 điểm trong một trang (bit 0 ở trên). Thư viện vẽ tất cả vào một bộ đệm 1024 byte trong RAM của ESP32, rồi display() gửi cả bộ đệm qua I2C.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 370 166',
        svg: esp.svg + mod.svg + sch.wire([esp.pin['3V3']!, mod.pin.VCC!]) + sch.wire([esp.pin.GPIO22!, mod.pin.SCL!], 'sch-s') + sch.wire([esp.pin.GPIO21!, mod.pin.SDA!], 'sch-s') + sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Chú ý thứ tự chân trên module: SCL đứng trước SDA. Chạy được cả 3,3 V lẫn 5 V vì module có ổn áp riêng; nối 3V3 để SDA, SCL không bị kéo lên 5 V.',
      },
    ];
  },
};
