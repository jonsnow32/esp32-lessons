import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { glyph } from './font';
import type { Lcd1602Props } from './index';

/** One character cell drawn big: the 5 × 8 dots of `ch`, lit ones in the accent colour. */
function cell(x: number, y: number, ch: string): string {
  const cols = glyph(ch.charCodeAt(0));
  let out = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 5; c++) {
      const on = (cols[c]! >> r) & 1;
      out += `<rect x="${x + c * 13}" y="${y + r * 13}" width="11" height="11" rx="1.5" fill="${on ? 'var(--accent-hi)' : 'var(--line-strong)'}" opacity="${on ? 1 : 0.45}"/>`;
    }
  }
  return out;
}

/** The expander's 8 pins and which LCD pin each drives. */
function backpack(): string {
  const pins = ['RS', 'RW', 'E', 'Đèn nền', 'D4', 'D5', 'D6', 'D7'];
  const exp = sch.block(130, 14, 'PCF8574', pins.map((_, i) => ({ name: `P${i}`, dy: 26 + i * 20 })), { w: 80, h: 190 });
  const lcd = sch.block(300, 14, 'HD44780', pins.map((name, i) => ({ name, dy: 26 + i * 20 })), { side: 'left', w: 90, h: 190 });
  const bus = sch.block(10, 60, 'I2C', [{ name: 'SDA', dy: 26 }, { name: 'SCL', dy: 56 }], { w: 60, h: 76 });
  return (
    exp.svg + lcd.svg + bus.svg +
    pins.map((_, i) => sch.wire([exp.pin[`P${i}`]!, lcd.pin[pins[i]!]!], i >= 4 ? 'sch-s' : '')).join('') +
    sch.wire([bus.pin.SDA!, [130, 86]], 'sch-s') + sch.wire([bus.pin.SCL!, [130, 116]], 'sch-s')
  );
}

export const doc: PartDoc<Lcd1602Props> = {
  active: { powered: true, display: true, backlight: true, contrast: 1, cells: [...'Xin chao ESP32!  Nhiet do 25.4 C'].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') },
  specs: (p) => [
    ['Hiển thị', '2 dòng × 16 ký tự, mỗi ký tự 5 × 8 chấm'],
    ['Địa chỉ I2C', `${p.address} (${p.address === '0x27' ? 'PCF8574' : 'PCF8574A'}, đổi bằng cầu hàn A0–A2)`],
    ['Nguồn', '5 V; ~20 mA khi bật đèn nền'],
    ['Bộ điều khiển', 'HD44780, giao tiếp 4 bit qua PCF8574'],
    ['Ký tự tự vẽ', '8 ký tự (createChar)'],
    ['Tốc độ I2C', '100 kHz (PCF8574 tối đa 100 kHz)'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO21', dy: 60 }, { name: 'GPIO22', dy: 94 }, { name: 'GND', dy: 128 }], 144);
    const mod = sch.block(256, 10, 'LCD 1602 I2C', [{ name: 'VCC', dy: 26 }, { name: 'SDA', dy: 60 }, { name: 'SCL', dy: 94 }, { name: 'GND', dy: 128 }], { side: 'left', w: 100, h: 144 });
    return [
      {
        kind: 'svg',
        title: 'Bo I2C phía sau màn hình',
        viewBox: '0 0 400 214',
        svg: backpack(),
        caption: 'PCF8574 nhận một byte qua I2C và đặt 8 chân của nó theo byte đó. Bốn chân nối D4–D7 của LCD, các chân còn lại là RS (lệnh hay chữ), E (xung "chốt dữ liệu") và đèn nền. Thư viện gửi mỗi ký tự thành hai nửa 4 bit, mỗi nửa kèm một xung E.',
      },
      {
        kind: 'svg',
        title: 'Một ô ký tự: 5 × 8 chấm',
        viewBox: '0 0 300 116',
        svg: cell(20, 6, 'A') + cell(110, 6, 'b') + cell(200, 6, '7'),
        caption: 'Mỗi ký tự là một ô 5 cột × 8 hàng chấm, lấy từ bảng chữ có sẵn trong chip. Hàng cuối dành cho con trỏ. lcd.createChar() cho phép tự vẽ 8 ký tự riêng (mũi tên, trái tim, độ °C…).',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 370 166',
        svg: esp.svg + mod.svg + sch.wire([esp.pin['VIN 5V']!, mod.pin.VCC!]) + sch.wire([esp.pin.GPIO21!, mod.pin.SDA!], 'sch-s') + sch.wire([esp.pin.GPIO22!, mod.pin.SCL!], 'sch-s') + sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Chỉ 4 dây. GPIO21 / GPIO22 là SDA / SCL mặc định của Wire.begin(). Module cần 5 V để chữ đủ đậm; điện trở kéo lên trên bo sẽ kéo SDA, SCL lên 5 V, đa số ESP32 vẫn chịu được nhưng an toàn hơn là dùng bộ chuyển mức.',
      },
    ];
  },
};
