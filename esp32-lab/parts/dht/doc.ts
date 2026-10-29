import { sch, type PartDoc, type TimingSpan } from '@esp32lab/part-sdk';
import { dhtFrame, type DhtProps } from './index';

const RANGE = {
  DHT11: { t: [0, 50], h: [20, 90], dt: '± 2 °C', dh: '± 5 %', every: '1 lần/giây' },
  DHT22: { t: [-40, 80], h: [0, 100], dt: '± 0,5 °C', dh: '± 2 %', every: '1 lần/2 giây' },
} as const;

/** Behind the grille: a humidity-sensing plate, a tiny NTC and the chip that talks on DATA. */
function inside(model: DhtProps['model']): string {
  const shell = model === 'DHT11' ? '#3e7fd0' : '#f2f2ee';
  const holes = Array.from({ length: 24 }, (_, i) => `<rect x="${42 + (i % 4) * 18}" y="${34 + Math.floor(i / 4) * 18}" width="10" height="10" fill="#0003"/>`).join('');
  return `
    <rect x="30" y="20" width="96" height="140" fill="${shell}" stroke="#0005"/>${holes}
    ${sch.text(78, 178, 'Vỏ (mặt trước)', { cls: 'sch-m', size: 10 })}
    <path class="sch-lead" d="M126,90 H150" stroke-dasharray="3 3"/>
    <rect x="150" y="20" width="150" height="140" fill="#2f7d4a" fill-opacity="0.15" stroke="#2f7d4a"/>
    <rect x="166" y="38" width="60" height="44" fill="#4a4f57"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${172 + i * 10},42 V78" stroke="#c9a227" stroke-width="2"/>`).join('')}
    <circle cx="256" cy="58" r="10" fill="#2a2d31"/>
    <rect x="200" y="104" width="44" height="30" fill="#15191d"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${180 + i * 30},160 V200" stroke="#a7adb4" stroke-width="3"/>`).join('')}
    ${['VCC', 'DATA', 'NC', 'GND'].map((n, i) => sch.text(180 + i * 30, 214, n, { size: 9, cls: 'sch-m' })).join('')}
    ${sch.callout([196, 40], [316, 30], 'Tấm đo ẩm')}
    ${sch.callout([264, 58], [316, 64], 'Nhiệt điện trở NTC')}
    ${sch.callout([244, 120], [316, 120], 'Chip xử lý')}`;
}

/** DHT11 vs DHT22 ranges on one scale each, the chosen model highlighted. */
function ranges(model: DhtProps['model']): string {
  const tx = (t: number) => 90 + ((t + 40) / 140) * 290;
  const hx = (h: number) => 90 + (h / 100) * 290;
  const bar = (y: number, x0: number, x1: number, on: boolean, label: string) =>
    `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="14" fill="${on ? 'var(--accent-hi)' : 'var(--line-strong)'}"/>${sch.text(x1 + 6, y + 11, label, { anchor: 'start', size: 9.5, cls: on ? 'sch-strong' : 'sch-m' })}`;
  const axis = (y: number, ticks: number[], x: (v: number) => number, unit: string) =>
    `<path class="sch-w" d="M90,${y} H380"/>` + ticks.map((t) => `<path class="sch-w" d="M${x(t)},${y} v4"/>${sch.text(x(t), y + 15, `${t}${unit}`, { size: 9, cls: 'sch-m' })}`).join('');
  return `
    ${sch.text(10, 30, 'Nhiệt độ', { anchor: 'start', cls: 'sch-strong' })}
    ${sch.text(10, 52, 'DHT11', { anchor: 'start', size: 10 })}${bar(42, tx(0), tx(50), model === 'DHT11', RANGE.DHT11.dt)}
    ${sch.text(10, 74, 'DHT22', { anchor: 'start', size: 10 })}${bar(64, tx(-40), tx(80), model === 'DHT22', RANGE.DHT22.dt)}
    ${axis(88, [-40, 0, 25, 50, 80], tx, '°')}
    ${sch.text(10, 130, 'Độ ẩm', { anchor: 'start', cls: 'sch-strong' })}
    ${sch.text(10, 152, 'DHT11', { anchor: 'start', size: 10 })}${bar(142, hx(20), hx(90), model === 'DHT11', RANGE.DHT11.dh)}
    ${sch.text(10, 174, 'DHT22', { anchor: 'start', size: 10 })}${bar(164, hx(0), hx(100), model === 'DHT22', RANGE.DHT22.dh)}
    ${axis(188, [0, 20, 50, 90, 100], hx, '%')}`;
}

export const doc: PartDoc<DhtProps> = {
  active: { sending: true },
  specs: (p) => {
    const r = RANGE[p.model];
    return [
      ['Đo nhiệt độ', `${r.t[0]} … ${r.t[1]} °C, ${r.dt}`],
      ['Đo độ ẩm', `${r.h[0]} … ${r.h[1]} %, ${r.dh}`],
      ['Tần suất đọc tối đa', r.every],
      ['Điện áp', '3,3–5,5 V'],
      ['Giao tiếp', '1 dây DATA, 40 bit'],
      ['Điện trở kéo lên DATA', '4,7–10 kΩ'],
    ];
  },
  figures: (p) => {
    const frame = dhtFrame(p.model, p.temperature, p.humidity);
    const first = frame[0]!;
    // Display units: the start pulse and the bits share one line, so the 18 ms start is squeezed
    const steps: [number, 0 | 1][] = [[0, 1], [2, 0], [24, 1], [27, 0], [33, 1], [39, 0]];
    const spans: TimingSpan[] = [
      { row: 0, from: 2, to: 24, label: `ESP32 kéo LOW ${p.model === 'DHT11' ? '18 ms' : '0,8 ms'}` },
      { row: 0, from: 27, to: 39, label: 'DHT: 80+80 µs' },
    ];
    let t = 39;
    for (let bit = 7; bit >= 0; bit--) {
      const one = (first >> bit) & 1;
      steps.push([t + 3, 1]);
      spans.push({ row: 0, from: t, to: t + 3 + (one ? 6 : 2.4), label: String(one) });
      t += 3 + (one ? 6 : 2.4);
      steps.push([t, 0]);
    }
    steps.push([t + 3, 1]);
    const esp = sch.esp32(14, 10, [{ name: '3V3', dy: 26 }, { name: 'GPIO4', dy: 72 }, { name: 'GND', dy: 118 }], 136);
    const mod = sch.block(270, 10, p.model, [{ name: 'VCC', dy: 26 }, { name: 'DATA', dy: 72 }, { name: 'NC', dy: 96 }, { name: 'GND', dy: 118 }], { side: 'left', w: 70, h: 136 });
    const hex = frame.map((b) => b.toString(2).padStart(8, '0')).join(' ');
    return [
      { kind: 'svg', title: 'Bên trong cảm biến', viewBox: '0 0 460 224', svg: inside(p.model), caption: 'Sau lớp vỏ lưới là một tấm đo ẩm (hơi nước thấm vào làm đổi tính chất điện của nó), một nhiệt điện trở NTC và một chip nhỏ đọc hai thứ đó rồi gửi kết quả đã tính sẵn qua dây DATA.' },
      { kind: 'svg', title: 'DHT11 hay DHT22?', viewBox: '0 0 420 206', svg: ranges(p.model), caption: 'DHT22 đo được dải rộng hơn (cả nhiệt độ âm) và chính xác hơn nhiều, nhưng đắt hơn. DHT11 đủ dùng cho phòng ở bình thường.' },
      {
        kind: 'timing',
        title: `Dây DATA: lời gọi và byte đầu tiên (${p.model === 'DHT11' ? `độ ẩm = ${first} %` : `byte cao của độ ẩm × 10 = ${first}`})`,
        end: t + 6,
        signals: [{ name: 'DATA', steps }],
        spans,
        caption: `Mỗi bit bắt đầu bằng 50 µs LOW, rồi HIGH ngắn (~27 µs) là bit 0, HIGH dài (~70 µs) là bit 1. Cả khung gồm 5 byte: độ ẩm (2 byte), nhiệt độ (2 byte), tổng kiểm tra. Lúc này cảm biến gửi: ${hex}.`,
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 360 160',
        svg:
          esp.svg +
          mod.svg +
          sch.wire([esp.pin['3V3']!, mod.pin.VCC!]) +
          sch.dot(180, 36) +
          sch.resistor([180, 36], [180, 82], '10 kΩ', 'kéo lên') +
          sch.dot(180, 82) +
          sch.wire([esp.pin.GPIO4!, mod.pin.DATA!], 'sch-s') +
          sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'VCC lên 3V3, GND xuống GND, DATA vào một GPIO và có điện trở 10 kΩ kéo DATA lên 3V3 (nhiều module DHT đã có sẵn điện trở này). Chân NC bỏ trống. Trong code dùng thư viện DHT: dht.readTemperature(), dht.readHumidity().',
      },
    ];
  },
};
