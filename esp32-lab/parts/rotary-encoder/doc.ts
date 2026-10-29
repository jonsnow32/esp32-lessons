import { sch, type PartDoc, type PartProps } from '@esp32lab/part-sdk';

export const doc: PartDoc<PartProps> = {
  active: { position: 3, turning: 1 },
  specs: () => [
    ['Số nấc mỗi vòng', '20 (mỗi nấc một chu kỳ xung)'],
    ['Nguồn', '3,3–5 V; nối 3V3 với ESP32'],
    ['Điện trở kéo lên', '10 kΩ trên CLK và DT (có sẵn)'],
    ['Nút SW', 'Nối GND khi ấn, cần INPUT_PULLUP'],
    ['Rung tiếp điểm', '≈ 1–5 ms mỗi lần đổi mức'],
  ],
  figures: () => {
    const esp = sch.esp32(14, 10, [{ name: 'GPIO18', dy: 26 }, { name: 'GPIO19', dy: 60 }, { name: 'GPIO21', dy: 94 }, { name: '3V3', dy: 128 }, { name: 'GND', dy: 162 }], 178);
    const mod = sch.block(256, 10, 'KY-040', [{ name: 'CLK', dy: 26 }, { name: 'DT', dy: 60 }, { name: 'SW', dy: 94 }, { name: '+', dy: 128 }, { name: 'GND', dy: 162 }], { side: 'left', w: 76, h: 178 });
    return [
      {
        kind: 'timing',
        title: 'Hai xung lệch pha khi xoay',
        end: 76,
        signals: [
          { name: 'CLK', steps: [[0, 1], [8, 0], [24, 1], [52, 0], [68, 1]] },
          { name: 'DT', steps: [[0, 1], [16, 0], [32, 1], [44, 0], [60, 1]] },
        ],
        spans: [
          { row: 0, from: 8, to: 32, label: '1 nấc thuận: CLK xuống trước' },
          { row: 1, from: 44, to: 68, label: '1 nấc ngược: DT xuống trước' },
        ],
        caption: 'Mỗi nấc, CLK và DT đều xuống LOW rồi lên lại, nhưng lệch nhau một phần tư chu kỳ. Ngay lúc CLK đổi mức, nếu DT khác CLK là xoay thuận chiều kim đồng hồ, nếu DT bằng CLK là xoay ngược.',
      },
      {
        kind: 'svg',
        title: 'Nối với ESP32',
        viewBox: '0 0 350 196',
        svg:
          esp.svg + mod.svg +
          sch.wire([esp.pin.GPIO18!, mod.pin.CLK!], 'sch-s') +
          sch.wire([esp.pin.GPIO19!, mod.pin.DT!], 'sch-s') +
          sch.wire([esp.pin.GPIO21!, mod.pin.SW!], 'sch-s') +
          sch.wire([esp.pin['3V3']!, mod.pin['+']!]) +
          sch.wire([esp.pin.GND!, mod.pin.GND!]),
        caption: 'CLK và DT đã có điện trở kéo lên trên module nên chỉ cần pinMode INPUT. SW thì không: đặt INPUT_PULLUP. Cấp 3V3 để CLK, DT không lên quá 3,3 V.',
      },
    ];
  },
};
