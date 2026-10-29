import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { JoystickProps } from './index';

const vi = sch.num;
/** Wiper voltage and analogRead() value with the module on 3V3. */
const volts = (pct: number) => (3.3 * Math.min(100, Math.max(0, pct))) / 100;
const reading = (pct: number) => Math.min(4095, Math.round((volts(pct) / 3.1) * 4095));

export const doc: PartDoc<JoystickProps> = {
  active: { pressed: true },
  specs: (p) => [
    ['Hai biến trở', '10 kΩ mỗi trục'],
    ['Nguồn', '3,3 V (đúng với ADC của ESP32)'],
    ['Vị trí đang chọn', `X ${p.x} %, Y ${p.y} %`],
    ['VRx / VRy ở 3,3 V', `${vi(volts(p.x), 2)} V / ${vi(volts(p.y), 2)} V`],
    ['analogRead (≈, 11 dB)', `X ${reading(p.x)} · Y ${reading(p.y)}`],
    ['Nút SW', 'Nối GND khi nhấn, cần INPUT_PULLUP'],
  ],
  figures: (p) => {
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 24 }, { name: 'GPIO34', dy: 60 }, { name: 'GPIO35', dy: 96 }, { name: 'GPIO25', dy: 132 }, { name: 'GND', dy: 168 }], 184);
    const mod = sch.block(256, 10, 'Joystick', [{ name: '+5V', dy: 24 }, { name: 'VRx', dy: 60 }, { name: 'VRy', dy: 96 }, { name: 'SW', dy: 132 }, { name: 'GND', dy: 168 }], { side: 'left', w: 84, h: 184 });
    const px = 60 + (p.x / 100) * 160;
    const py = 180 - (p.y / 100) * 160;
    return [
      {
        kind: 'svg',
        title: 'Vị trí cần và giá trị đọc được',
        viewBox: '0 0 300 210',
        svg:
          `<rect x="60" y="20" width="160" height="160" fill="none" class="sch-b"/>` +
          sch.wire([[140, 20], [140, 180]]) + sch.wire([[60, 100], [220, 100]]) +
          `<path d="M${140 - 13},${100 - 13} h26 v26 h-26 Z" fill="var(--line-strong)" opacity="0.6"/>` +
          `<circle cx="${px}" cy="${py}" r="9" class="sch-a-fill"/>` +
          sch.text(60, 198, '0', { cls: 'sch-m', size: 9.5 }) + sch.text(220, 198, '4095', { cls: 'sch-m', size: 9.5 }) + sch.text(140, 198, 'X →', { size: 10 }) +
          sch.text(52, 184, '0', { anchor: 'end', cls: 'sch-m', size: 9.5 }) + sch.text(52, 24, '4095', { anchor: 'end', cls: 'sch-m', size: 9.5 }) + sch.text(30, 104, 'Y ↑', { size: 10 }) +
          sch.text(230, 112, 'vùng chết', { anchor: 'start', cls: 'sch-m', size: 9.5 }) +
          sch.text(px, py - 14, `(${reading(p.x)}, ${reading(p.y)})`, { cls: 'sch-a', size: 10 }),
        caption: 'Mỗi trục là một biến trở: cần ở giữa cho khoảng nửa điện áp, đẩy hết về một phía cho 0 V hoặc 3,3 V. Ô xám là vùng chết nên bỏ qua vì cần thả ra không bao giờ về đúng giữa.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 350 200',
        svg:
          esp.svg + mod.svg +
          sch.wire([esp.pin['3V3']!, mod.pin['+5V']!]) +
          sch.wire([esp.pin.GPIO34!, mod.pin.VRx!], 'sch-s') +
          sch.wire([esp.pin.GPIO35!, mod.pin.VRy!], 'sch-s') +
          sch.wire([esp.pin.GPIO25!, mod.pin.SW!], 'sch-s') +
          sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Chân "+5V" nối 3V3 để điện áp ra không vượt quá dải đo của ADC. VRx, VRy vào hai chân ADC1; SW vào một GPIO thường, đặt pinMode(25, INPUT_PULLUP).',
      },
    ];
  },
};
