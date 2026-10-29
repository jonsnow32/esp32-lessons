import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { aoRatio, type GasSensorProps } from './index';

const vi = sch.num;

export const doc: PartDoc<GasSensorProps> = {
  active: { alarm: true },
  specs: (p) => [
    ['Khí đo được', 'LPG, propan, hydro, khói, mêtan'],
    ['Dải đo', '200 – 10 000 ppm'],
    ['Nguồn', '5 V, ~150 mA (dây nung)'],
    ['AO ở nồng độ đang chọn', `${vi(5 * aoRatio(p.gas), 2)} V`],
    ['Ngưỡng DO', `${p.alarm} ppm (AO = ${vi(5 * aoRatio(p.alarm), 2)} V)`],
    ['DO', p.gas >= p.alarm ? 'LOW: đang báo động' : 'HIGH: bình thường'],
  ],
  figures: (p) => {
    const pts: [number, number][] = [];
    for (let ppm = 100; ppm <= 10000; ppm *= 1.15) pts.push([ppm, 5 * aoRatio(ppm)]);
    const esp = sch.esp32(14, 10, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO27', dy: 62 }, { name: 'GPIO34', dy: 98 }, { name: 'GND', dy: 134 }], 150);
    const mod = sch.block(256, 10, 'MQ-2', [{ name: 'VCC', dy: 26 }, { name: 'DO', dy: 62 }, { name: 'AO', dy: 98 }, { name: 'GND', dy: 134 }], { side: 'left', w: 70, h: 150 });
    return [
      {
        kind: 'chart',
        title: 'Điện áp AO theo nồng độ khí (nguồn 5 V)',
        x: { label: 'Nồng độ LPG (ppm)', min: 100, max: 10000, log: true },
        y: { label: 'AO (V)', min: 0, max: 5 },
        series: [{ points: pts, label: 'AO' }],
        marks: [
          { y: 5 * aoRatio(p.alarm), label: `Ngưỡng DO ${p.alarm} ppm`, tone: 'error' },
          ...(p.gas >= 100 ? [{ x: p.gas, y: 5 * aoRatio(p.gas), label: `${p.gas} ppm` }] : []),
        ],
        caption: 'Trục ngang theo thang log: nồng độ tăng gấp 10 thì AO chỉ tăng thêm khoảng 1,3 V. Cảm biến không chính xác tuyệt đối, chỉ nên dùng để báo "có gas / không có gas" hoặc theo dõi xu hướng.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 350 168',
        svg:
          esp.svg + mod.svg +
          sch.wire([esp.pin['VIN 5V']!, mod.pin.VCC!]) +
          sch.wire([esp.pin.GPIO27!, mod.pin.DO!], 'sch-s') +
          sch.wire([esp.pin.GPIO34!, mod.pin.AO!], 'sch-s') +
          sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'Dây nung cần 5 V và ~150 mA, lấy từ VIN. DO cho biết vượt ngưỡng (LOW) hay chưa; AO cho giá trị liên tục để đọc bằng analogRead. Với module thật, DO được kéo lên 5 V: nên thêm cầu phân áp trước khi vào GPIO.',
      },
    ];
  },
};
