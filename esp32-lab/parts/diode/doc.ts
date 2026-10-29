import { Junction, sch, type PartDoc } from '@esp32lab/part-sdk';
import { MODELS, type DiodeModel, type DiodeProps } from './index';

const COLOR: Record<DiodeModel, string> = { '1N4148': 'var(--accent-hi)', '1N4007': 'var(--info)' };

/** I(V) from the simulator's junction, in mA, up to just past the chart. */
function curve(model: DiodeModel): [number, number][] {
  const j = new Junction(MODELS[model].is, MODELS[model].n);
  const out: [number, number][] = [];
  for (let v = 0; v <= 1.2; v += 0.005) {
    out.push([v, j.current(v) * 1000]);
    if (j.current(v) > 0.35) break;
  }
  return out;
}

/** Forward voltage at a given current. */
const vAt = (model: DiodeModel, i: number) => MODELS[model].n * 0.025852 * Math.log(i / MODELS[model].is + 1);

/** The body as it looks, its stripe lined up with the bar of the schematic symbol. */
function realVsSymbol(model: DiodeModel): string {
  const glass = model === '1N4148';
  return `
    <path d="M40,50 H340" stroke="#a7adb4" stroke-width="4" stroke-linecap="round"/>
    <rect x="${glass ? 130 : 110}" y="${glass ? 36 : 30}" width="${glass ? 120 : 160}" height="${glass ? 28 : 40}" rx="${glass ? 12 : 8}" fill="url(#diode-${glass ? 'glass' : 'epoxy'})"/>
    <rect x="${glass ? 226 : 246}" y="${glass ? 36 : 30}" width="12" height="${glass ? 28 : 40}" fill="${glass ? '#1b1b1b' : '#c9ccd1'}"/>
    <path class="sch-lead" d="M${glass ? 232 : 252},${glass ? 66 : 72} L${200},118" stroke-dasharray="3 3"/>
    ${sch.diode([40, 140], [340, 140], { sub: '' })}
    ${sch.text(40, 172, 'Anode (+)', { anchor: 'start', cls: 'sch-a' })}
    ${sch.text(340, 172, 'Cathode (−, vạch)', { anchor: 'end', cls: 'sch-a' })}
    ${sch.flow([110, 112], [170, 112], 'dòng đi theo mũi tên')}`;
}

/** Forward: current flows and the resistor gets ~2,6 V. Reverse: nothing gets through. */
function bothWays(model: DiodeModel): string {
  const vf = vAt(model, 0.0026);
  const i = (3.3 - vf) / 1000;
  return `
    ${sch.supply(40, 50, '3V3')}
    ${sch.diode([40, 50], [40, 110], { label: 'Thuận' })}
    ${sch.resistor([40, 110], [40, 160], '1 kΩ')}
    ${sch.gnd(40, 160)}
    ${sch.flow([110, 60], [110, 150], '')}
    ${sch.text(124, 100, `${sch.num(i * 1000, 2)} mA`, { anchor: 'start', cls: 'sch-s' })}
    ${sch.text(124, 116, `rơi ${sch.num(vf, 2)} V`, { anchor: 'start', cls: 'sch-m' })}
    ${sch.supply(240, 50, '3V3')}
    ${sch.diode([240, 110], [240, 50], { label: 'Ngược' })}
    ${sch.resistor([240, 110], [240, 160], '1 kΩ')}
    ${sch.gnd(240, 160)}
    <path d="M300,92 l14,14 M314,92 l-14,14" stroke="var(--error)" stroke-width="2.5"/>
    ${sch.text(322, 104, '≈ 0 mA', { anchor: 'start', cls: 'sch-m' })}`;
}

export const doc: PartDoc<DiodeProps> = {
  specs: (p) => {
    const m = MODELS[p.model];
    return [
      ['Loại', p.model === '1N4148' ? '1N4148: diode tín hiệu, nhanh' : '1N4007: diode chỉnh lưu nguồn'],
      ['Sụt áp thuận ở 10 mA', `${sch.num(vAt(p.model, 0.01), 2)} V`],
      ['Dòng thuận tối đa', `${sch.num(m.currentMax * 1000, 0)} mA`],
      ['Dòng xung tối đa', `${sch.num(m.currentAbsMax, 1)} A`],
      ['Điện áp ngược tối đa', `${m.reverseVoltageMax} V`],
    ];
  },
  figures: (p) => [
    { kind: 'svg', title: 'Hình dạng và ký hiệu', viewBox: '0 0 380 184', svg: realVsSymbol(p.model), caption: 'Vạch trên thân diode chính là thanh ngang trong ký hiệu: phía cathode. Mũi tên tam giác chỉ chiều dòng điện được phép đi qua.' },
    {
      kind: 'chart',
      title: 'Đặc tuyến thuận',
      x: { label: 'Điện áp anode − cathode (V)', min: 0, max: 1.2 },
      y: { label: 'Dòng điện (mA)', min: 0, max: 300 },
      series: (Object.keys(MODELS) as DiodeModel[]).map((m) => ({ points: curve(m), label: m, color: COLOR[m], muted: m !== p.model })),
      marks: [
        { x: vAt(p.model, 0.1), y: 100, label: `${sch.num(vAt(p.model, 0.1), 2)} V → 100 mA` },
        ...(MODELS[p.model].currentMax < 0.3 ? [{ y: MODELS[p.model].currentMax * 1000, label: `Tối đa ${MODELS[p.model].currentMax * 1000} mA`, tone: 'error' as const }] : []),
      ],
      caption: 'Dưới khoảng 0,4 V diode gần như không dẫn; sau đó dòng tăng rất nhanh và điện áp hai đầu chỉ nhích lên chút ít (0,6–0,9 V). Chiều ngược lại dòng gần bằng 0 cho tới khi vượt điện áp ngược tối đa.',
    },
    { kind: 'svg', title: 'Van một chiều', viewBox: '0 0 400 190', svg: bothWays(p.model), caption: 'Cùng một mạch, chỉ đảo chiều diode: chiều thuận có dòng (và diode "ăn" mất một phần điện áp), chiều ngược thì mạch như bị ngắt.' },
  ],
};
