import { sch, type PartDoc } from '@esp32lab/part-sdk';
import { load, type BuzzerProps } from './index';

const VOLTS = Array.from({ length: 121 }, (_, i) => i * 0.05);
const loudness = (v: number) => Math.min(1, Math.max(0, (v - 2) / 3));

/** Section through the can: the oscillator board drives a piezo disc that pushes the air. */
function inside(): string {
  const waves = [0, 1, 2].map((i) => `<path d="M${150 - 30 - i * 16},${22 - i * 8} Q150,${4 - i * 12} ${150 + 30 + i * 16},${22 - i * 8}" fill="none" stroke="var(--accent-hi)" stroke-width="2" opacity="${1 - i * 0.28}"/>`).join('');
  return `
    ${waves}
    <rect x="80" y="30" width="140" height="110" rx="10" fill="#2a2d31" stroke="#111"/>
    <circle cx="150" cy="36" r="6" fill="var(--bg)"/>
    <rect x="94" y="52" width="112" height="7" fill="#c9a227"/>
    <rect x="114" y="46" width="72" height="6" fill="#e8ebee" stroke="#6f767e" stroke-width="0.8"/>
    <rect x="94" y="96" width="112" height="10" fill="#2f7d4a"/>
    <rect x="112" y="84" width="22" height="12" fill="#15191d"/><rect x="150" y="88" width="10" height="8" fill="#c9a227"/><rect x="168" y="86" width="14" height="10" fill="#7a4a1e"/>
    <path d="M118,140 V190 M182,140 V178" stroke="#a7adb4" stroke-width="4"/>
    ${sch.text(118, 204, '+ dài', { cls: 'sch-a' })}${sch.text(182, 192, '−', { cls: 'sch-m' })}
    ${sch.callout([200, 49], [250, 40], 'Màng piezo trên đĩa đồng')}
    ${sch.callout([206, 100], [250, 96], 'Mạch dao động ~2,3 kHz')}
    ${sch.callout([182, 18], [250, 12], 'Sóng âm')}
    ${sch.callout([150, 36], [250, 68], 'Lỗ thoát âm')}`;
}

export const doc: PartDoc<BuzzerProps> = {
  active: { loudness: 1, sounding: true },
  specs: () => [
    ['Loại', 'Chủ động (có sẵn mạch dao động)'],
    ['Điện áp hoạt động', '3–5 V (kêu từ ~2 V)'],
    ['Dòng ở 5 V', `≈ ${sch.num(load(5).i * 1000, 0)} mA`],
    ['Dòng ở 3,3 V', `≈ ${sch.num(load(3.3).i * 1000, 0)} mA`],
    ['Tần số', '≈ 2,3 kHz'],
    ['Độ to ở 10 cm', '≈ 85 dB'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 20, [{ name: 'GPIO23', dy: 40 }, { name: 'GND', dy: 100 }], 120);
    const tone: [number, 0 | 1][] = [[0, 0]];
    for (let t = 20; t < 60; t += 1.2) tone.push([t, 1], [t + 0.6, 0]);
    return [
      { kind: 'svg', title: 'Bên trong còi chủ động', viewBox: '0 0 420 212', svg: inside(), caption: 'Còi chủ động có sẵn một mạch dao động nhỏ: chỉ cần cấp điện một chiều, mạch tự bật tắt màng piezo hàng nghìn lần mỗi giây nên màng rung và phát ra tiếng "bíp".' },
      {
        kind: 'chart',
        title: 'Dòng điện và độ to theo điện áp',
        x: { label: 'Điện áp cấp vào (V)', min: 0, max: 6 },
        y: { label: 'Dòng (mA) · Độ to (% ÷ 2)', min: 0, max: 50 },
        series: [
          { points: VOLTS.map((v) => [v, load(v).i * 1000]), label: 'Dòng điện (mA)' },
          { points: VOLTS.map((v) => [v, loudness(v) * 50]), label: 'Độ to (100 % = 50)', color: 'var(--signal)' },
        ],
        marks: [
          { x: 3.3, y: load(3.3).i * 1000, label: `GPIO 3,3 V: ${sch.num(load(3.3).i * 1000, 0)} mA` },
          { y: 40, label: 'Giới hạn 40 mA', tone: 'error' },
        ],
        caption: 'Dưới khoảng 2 V còi im lặng; từ 2 V đến 5 V tiếng to dần. Cắm thẳng vào GPIO (3,3 V) thì còi kêu khoảng 40 % độ to và lấy ~17 mA, vừa sức chân GPIO.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 330 160',
        svg:
          esp.svg +
          sch.wire([esp.pin.GPIO23!, [220, 60], [220, 70]], 'sch-s') +
          sch.buzzer([220, 70], [220, 110], 'Còi') +
          sch.wire([[220, 110], [220, 120], esp.pin.GND!]),
        caption: 'Chân + (dài) vào GPIO, chân − xuống GND. digitalWrite(23, HIGH) là kêu, LOW là im. Cắm ngược chiều thì còi không kêu.',
      },
      {
        kind: 'timing',
        title: 'Lệnh HIGH và tiếng kêu',
        end: 80,
        signals: [
          { name: 'GPIO23', steps: [[0, 0], [20, 1], [60, 0]] },
          { name: 'Màng piezo', steps: tone, color: 'var(--accent-hi)' },
        ],
        spans: [{ row: 1, from: 20, to: 60, label: 'mạch trong còi tự dao động ~2,3 kHz' }],
        caption: 'Code chỉ cần giữ chân ở HIGH; còi thụ động (passive) mới cần code tạo xung bằng tone().',
      },
    ];
  },
};
