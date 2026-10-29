import { sch, type PartDoc } from '@esp32lab/part-sdk';
import type { RelayProps } from './index';

/** Inside: the coil pulls the armature down, moving COM's contact from NC over to NO. */
function inside(): string {
  return `
    <rect x="40" y="70" width="44" height="70" class="sch-b"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path class="sch-w" d="M40,${78 + i * 11} H84"/>`).join('')}
    ${sch.text(62, 160, 'Cuộn dây', { cls: 'sch-m', size: 10 })}
    <path class="sch-w" d="M100,64 L230,52" stroke-width="3"/>
    <circle class="sch-b" cx="100" cy="64" r="4"/>
    <circle class="sch-b" cx="230" cy="30" r="4"/><circle class="sch-b" cx="230" cy="78" r="4"/>
    ${sch.text(252, 34, 'NC', { anchor: 'start', cls: 'sch-a' })}${sch.text(252, 82, 'NO', { anchor: 'start' })}
    ${sch.text(92, 50, 'COM', { anchor: 'end' })}
    <path class="sch-w sch-a" d="M160,96 V70" stroke-dasharray="4 3"/>
    ${sch.text(168, 104, 'khi có điện: kéo xuống, COM chạm NO', { anchor: 'start', cls: 'sch-s', size: 10 })}`;
}

export const doc: PartDoc<RelayProps> = {
  active: { driven: true, energized: true, closed: true },
  specs: (p) => [
    ['Kích', p.trigger === 'high' ? 'Mức cao: IN HIGH là đóng' : 'Mức thấp: IN LOW là đóng'],
    ['Nguồn cuộn dây', '5 V, ~70 mA (70 Ω)'],
    ['Tiếp điểm', '10 A 250 V AC / 10 A 30 V DC'],
    ['Thời gian đóng / nhả', '≈ 10 ms / 5 ms'],
    ['Dòng chân IN', p.trigger === 'high' ? '≈ 1,5 mA ở 3,3 V' : '≈ 1 mA khi kéo xuống 0 V'],
  ],
  figures: (p) => {
    const esp = sch.esp32(14, 10, [{ name: 'VIN 5V', dy: 26 }, { name: 'GPIO23', dy: 64 }, { name: 'GND', dy: 104 }], 122);
    const mod = sch.block(196, 10, 'Relay', [{ name: 'VCC', dy: 26 }, { name: 'IN', dy: 64 }, { name: 'GND', dy: 104 }], { side: 'left', w: 70, h: 122 });
    return [
      { kind: 'svg', title: 'Bên trong relay', viewBox: '0 0 420 176', svg: inside(), caption: 'Cuộn dây có điện thành nam châm, hút lá thép (armature) xuống: tiếp điểm COM rời NC và chạm NO. Mất điện thì lò xo kéo lá thép về, COM lại chạm NC. Phía cuộn dây và phía tiếp điểm không nối điện với nhau.' },
      {
        kind: 'svg',
        title: 'Nối với ESP32 và một bóng đèn',
        viewBox: '0 0 420 150',
        svg:
          esp.svg +
          mod.svg +
          sch.wire([esp.pin['VIN 5V']!, mod.pin.VCC!]) +
          sch.wire([esp.pin.GPIO23!, mod.pin.IN!], 'sch-s') +
          sch.wire([esp.pin.GND!, mod.pin.GND!]) +
          sch.text(300, 40, 'COM', { anchor: 'start', size: 10 }) +
          sch.text(300, 80, 'NO', { anchor: 'start', size: 10 }) +
          sch.wire([[266, 36], [296, 36]]) + sch.wire([[266, 76], [296, 76]]) +
          sch.wire([[330, 36], [390, 36], [390, 56]]) +
          `<circle class="sch-b" cx="390" cy="70" r="12"/><path class="sch-w" d="M382,62 L398,78 M398,62 L382,78"/>` +
          sch.wire([[390, 82], [390, 110], [330, 110], [330, 80]]) +
          sch.text(380, 128, 'đèn + nguồn', { cls: 'sch-m', size: 10 }),
        caption:
          p.trigger === 'high'
            ? 'GPIO23 HIGH: relay đóng, COM nối NO, đèn sáng. LOW: relay nhả, đèn tắt. Cuộn dây lấy điện từ VIN (5 V), chân GPIO chỉ cấp khoảng 1,5 mA cho mạch kích.'
            : 'Kích mức thấp: GPIO23 LOW là đóng. Đèn LED của optocoupler nằm giữa VCC và IN, cần VCC − IN khoảng 2,6 V mới sáng. GPIO HIGH (3,3 V) chỉ để lại 1,7 V nên relay nhả; module nào có ngưỡng thấp hơn thì sẽ không tắt được bằng 3,3 V.',
      },
    ];
  },
};
