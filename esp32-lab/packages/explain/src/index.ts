// "Mạch đang làm gì": plain-language notes about the live circuit, for beginners.
//
// Every sentence is derived from the solved circuit (voltages, terminal and edge currents,
// pad drive states) – nothing is scripted per lesson. Text is Vietnamese UI copy; numbers use
// a decimal comma.

import type { PadCapabilities } from '@esp32lab/mcu-esp32';
import type { PartManifest, PartProps } from '@esp32lab/part-sdk';
import type { BoardDef, Project } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, type SimKernel } from '@esp32lab/sim-core';

export type NoteLevel = 'error' | 'warn' | 'ok' | 'info';

export interface Note {
  level: NoteLevel;
  text: string;
  /** Part ids and netlist keys to highlight on the bench when the note is hovered. */
  highlight: string[];
}

export interface ExplainContext {
  kernel: SimKernel;
  project: Project;
  board: BoardDef;
  pads: Record<string, PadCapabilities>;
  manifests: Record<string, PartManifest>;
}

/** Below this a part is considered to carry no current. */
const I_MIN = 1e-6;
const LED_MAX = 0.03;

const num = (x: number, digits: number) => x.toFixed(digits).replace('.', ',');
const volts = (v: number) => `${num(v, 2)} V`;
const amps = (i: number) => (Math.abs(i) >= 1e-3 ? `${num(i * 1000, 1)} mA` : `${num(i * 1e6, 0)} µA`);
const ohms = (r: number) => (r >= 1000 ? `${num(r / 1000, r % 1000 ? 1 : 0)} kΩ` : `${r} Ω`);

/** What each strapping pin's level at reset does, for beginners. */
const STRAPPING: Record<string, string> = {
  GPIO0: 'nếu bị kéo LOW lúc bật nguồn, chip vào chế độ nạp code thay vì chạy chương trình (đây chính là nút BOOT).',
  GPIO2: 'phải LOW hoặc thả nổi khi nạp code. Nối LED qua điện trở như bài học là an toàn.',
  GPIO5: 'chip xuất vài xung lúc khởi động, linh kiện nối vào có thể nháy nhẹ.',
  GPIO12: 'nếu HIGH lúc bật nguồn, chip chọn điện áp flash 1,8 V và không chạy được. Tránh nối điện trở kéo lên.',
  GPIO15: 'nếu LOW lúc bật nguồn, chip tắt dòng log khởi động trên Serial.',
};

const LED_COLOR: Record<string, string> = { red: 'đỏ', yellow: 'vàng', green: 'xanh lá', blue: 'xanh dương', white: 'trắng' };

export function explain(ctx: ExplainContext): Note[] {
  const { kernel, project, board } = ctx;
  const notes: Note[] = [];
  const nl = kernel.netlist;
  const volt = kernel.keyVoltages();
  const { terminals } = kernel.flows();
  const parts = kernel.terminals();
  const net = (key: string) => nl.net(key);
  const v = (key: string) => volt.get(key)?.v ?? 0;
  const userParts = project.parts.filter((p) => parts.has(p.id));
  const props = (id: string): PartProps => {
    const p = project.parts.find((q) => q.id === id);
    const m = p && ctx.manifests[p.type];
    const out: PartProps = {};
    if (m) for (const [k, s] of Object.entries(m.props)) out[k] = p?.props?.[k] ?? s.default;
    return out;
  };

  // Header pin of each pad and of each board net, to name things the way the board does
  const pinOfNet = new Map<number, string>();
  for (const pin of board.pins) {
    const n = net(keyOf.boardPin(pin.name));
    if (n !== undefined && !pinOfNet.has(n)) pinOfNet.set(n, pin.name.replace(/\.[LR]$/, ''));
  }
  pinOfNet.set(0, 'GND');
  const padOfPin = (pin: string) => {
    const p = board.pins.find((q) => q.name === pin);
    return p && 'pad' in p.connect ? p.connect.pad : undefined;
  };

  /** A net counts as connected if something other than bare holes and this part's own legs is on it. */
  const connectedBeyond = (key: string, self: string) => {
    const n = net(key);
    if (n === undefined) return false;
    return nl.keysOf(n).some((k) => !k.startsWith('h:') && !k.startsWith(`p:${self}:`));
  };
  /** User wiring (a hole, a user part, a wire end) reaches this net. */
  const userWired = (n: number) => nl.keysOf(n).some((k) => k.startsWith('h:') || (k.startsWith('p:') && !k.startsWith('p:board.')));

  // --- Shorts ---------------------------------------------------------------------------
  for (const supply of board.supplies) {
    if (nl.connected(keyOf.net(supply.net), GROUND_KEY)) {
      notes.push({
        level: 'error',
        text: `Chập mạch: ${supply.net} đang nối thẳng xuống GND. Nguồn ${supply.name} sẽ quá tải. Hãy gỡ dây nối giữa ${supply.net} và GND.`,
        highlight: [keyOf.net(supply.net), GROUND_KEY],
      });
    }
  }

  // --- Damaged parts --------------------------------------------------------------------
  for (const d of kernel.diagnostics.filter((x) => x.code === 'damaged' && x.part)) {
    const id = d.part!;
    const what = id.startsWith('mcu.') ? `Chân ${id.slice(4)} của ESP32` : id;
    notes.push({ level: 'error', text: `${what} đã hỏng vì dòng quá lớn trong thời gian dài. Kiểm tra điện trở hạn dòng.`, highlight: [id] });
  }

  // --- Current paths --------------------------------------------------------------------
  // From every driving pad / supply net that the user wired, follow user parts carrying
  // current in the direction it flows, until ground or a pad sinking it.
  const sources: { key: string; label: string }[] = [];
  for (const pin of board.pins) {
    const pad = padOfPin(pin.name);
    const n = net(keyOf.boardPin(pin.name));
    if (n === undefined || !userWired(n)) continue;
    if (pad && kernel.observables(`mcu.${pad}`).output === 'high') sources.push({ key: keyOf.pad(pad), label: pin.name });
    if ('net' in pin.connect && pin.connect.net !== 'GND') sources.push({ key: keyOf.net(pin.connect.net), label: pin.connect.net });
  }
  const seenSources = new Set<number>();
  for (const src of sources) {
    const start = net(src.key)!;
    if (seenSources.has(start)) continue;
    seenSources.add(start);
    for (const first of userParts) {
      const path = walk(start, first.id);
      if (path) notes.push(path);
    }
  }

  function walk(startNet: number, firstId: string): Note | null {
    const steps: string[] = [];
    const highlight: string[] = [];
    let at = startNet;
    let current = 0;
    const used = new Set<string>();
    let nextId: string | undefined = firstId;
    for (let depth = 0; depth < 8; depth++) {
      // Next part: one with a terminal on this net that current flows into
      const candidates = depth === 0 ? userParts.filter((p) => p.id === nextId) : userParts.filter((p) => !used.has(p.id));
      let found: { id: string; enter: string; exit: string; i: number } | null = null;
      for (const p of candidates) {
        const keys = parts.get(p.id)!.keys;
        const cur = terminals.get(p.id) ?? {};
        for (const [t, i] of Object.entries(cur)) {
          if (i <= I_MIN || net(keys[t]!) !== at) continue;
          const exit = Object.entries(cur).find(([u, j]) => u !== t && j < -I_MIN && net(keys[u]!) !== at);
          if (exit) found = { id: p.id, enter: t, exit: exit[0], i };
        }
        if (found) break;
      }
      if (!found) return null;
      if (depth === 0 && found.id !== firstId) return null;
      used.add(found.id);
      highlight.push(found.id);
      const keys = parts.get(found.id)!.keys;
      const drop = v(keys[found.enter]!) - v(keys[found.exit]!);
      current = Math.max(current, found.i);
      steps.push(describeInPath(found.id, drop));
      at = net(keys[found.exit]!)!;
      if (at === 0) break;
      const endPin = pinOfNet.get(at);
      if (endPin && !nl.keysOf(at).some((k) => k.startsWith('p:') && !k.startsWith('p:board.') && !used.has(k.split(':')[1]!))) {
        steps.push(endPin);
        break;
      }
    }
    if (at !== 0 && !pinOfNet.has(at)) return null;
    const startLabel = pinOfNet.get(startNet) ?? 'nguồn';
    return {
      level: 'ok',
      text: `Dòng điện ${amps(current)} chạy: ${startLabel} → ${steps.join(' → ')}${at === 0 ? ' → GND' : ''}.`,
      highlight: [...highlight, ...nl.keysOf(startNet).filter((k) => k.startsWith('bp:'))],
    };
  }

  function describeInPath(id: string, drop: number): string {
    const type = parts.get(id)?.type;
    const p = props(id);
    if (type === 'resistor') return `${id} (${ohms(Number(p.resistance))}, sụt ${volts(drop)})`;
    if (type === 'led') {
      const b = Math.round(Number(kernel.observables(id).brightness ?? 0) * 100);
      return `${id} (LED ${LED_COLOR[String(p.color)] ?? ''}, ${volts(drop)}, sáng ${b}%)`;
    }
    if (type === 'pushbutton') return `${id} (đang nhấn)`;
    if (type === 'potentiometer') return `${id} (biến trở ${ohms(Number(p.resistance))}, núm ${p.position} %, sụt ${volts(drop)})`;
    if (type === 'photoresistor') return `${id} (quang trở ${ohms(Math.round(Number(kernel.observables(id).resistance)))}, sụt ${volts(drop)})`;
    if (type === 'diode') return `${id} (diode ${p.model}, sụt ${volts(drop)})`;
    if (type === 'rgb-led') return `${id} (LED RGB, ${volts(drop)})`;
    if (type === 'buzzer') return `${id} (còi, ${volts(drop)})`;
    if (type === 'slide-switch') return `${id} (công tắc gạt về ${p.position})`;
    return id;
  }

  // --- Part status ----------------------------------------------------------------------
  for (const p of userParts) {
    const keys = parts.get(p.id)!.keys;
    const legs = Object.keys(keys);
    const loose = legs.filter((t) => !connectedBeyond(keys[t]!, p.id));
    const obs = kernel.observables(p.id);
    if (!p.placement && !p.bench) continue;
    // Two legs in one breadboard strip are joined by its metal clip: the part is bypassed
    const joined = new Set((ctx.manifests[p.type]?.internalShorts ?? []).map(([a, b]) => [a, b].sort().join('|')));
    const shorted = legs.flatMap((t, i) => legs.slice(i + 1).filter((u) => !joined.has([t, u].sort().join('|')) && net(keys[t]!) !== undefined && net(keys[t]!) === net(keys[u]!)).map((u) => [t, u]));
    if (shorted.length) {
      const label = (t: string) => ctx.manifests[p.type]?.terminals.find((d) => d.name === t)?.label ?? t;
      const [t, u] = shorted[0]!;
      notes.push({
        level: 'warn',
        text: `${p.id} bị nối tắt: chân ${label(t!)} và chân ${label(u!)} nằm cùng một cột (cùng thanh kim loại của breadboard), nên dòng điện đi vòng qua thanh kim loại chứ không qua linh kiện. Xoay (R) hoặc dời linh kiện để mỗi chân nằm ở một cột riêng; linh kiện có chân cách 3 lỗ như còi thì cắm vắt ngang rãnh giữa.`,
        highlight: [p.id],
      });
      continue;
    }
    if (loose.length === legs.length) {
      notes.push({ level: 'info', text: `${p.id} chưa nối vào mạch: các chân chỉ cắm vào breadboard, chưa có dây hay linh kiện nào cùng hàng.`, highlight: [p.id] });
      continue;
    }

    if (p.type === 'led') {
      const i = Number(obs.current ?? 0);
      const va = v(keys.anode!);
      const vk = v(keys.cathode!);
      if (obs.damaged) continue; // already reported
      if (i > LED_MAX) {
        notes.push({ level: 'warn', text: `${p.id} đang chịu ${amps(i)}, quá mức an toàn ${amps(LED_MAX)}: sẽ cháy nếu để lâu. Thêm điện trở hạn dòng (220–330 Ω) nối tiếp với LED.`, highlight: [p.id] });
      } else if (i < I_MIN) {
        if (loose.includes('anode') || loose.includes('cathode')) {
          const which = loose.includes('anode') ? 'chân + (chân dài)' : 'chân − (phía mặt phẳng)';
          notes.push({ level: 'info', text: `${p.id} tắt: ${which} chưa nối vào đâu, mạch bị hở nên không có dòng.`, highlight: [p.id] });
        } else if (vk - va > 1) {
          notes.push({ level: 'warn', text: `${p.id} đang cắm ngược: phía − có ${volts(vk)}, cao hơn phía + (${volts(va)}). LED chỉ cho dòng đi từ chân dài (+) sang chân ngắn (−). Chọn LED rồi nhấn R hai lần để xoay 180°.`, highlight: [p.id] });
        } else {
          notes.push({ level: 'info', text: `${p.id} đang tắt: hai chân gần như cùng điện áp (+ ${volts(va)}, − ${volts(vk)}). LED cần chênh khoảng ${p.props?.color === 'blue' || p.props?.color === 'white' ? '3' : '2'} V mới sáng.`, highlight: [p.id] });
        }
      }
    } else if (p.type === 'resistor') {
      if (loose.length === 1) notes.push({ level: 'info', text: `${p.id}: một đầu chưa nối, nên không có dòng qua điện trở.`, highlight: [p.id] });
      if (Number(obs.power ?? 0) > 0.25) notes.push({ level: 'warn', text: `${p.id} đang toả ${num(Number(obs.power) * 1000, 0)} mW, vượt mức 250 mW của điện trở 1/4 W: sẽ nóng và cháy.`, highlight: [p.id] });
    } else if (p.type === 'pushbutton') {
      notes.push({
        level: 'info',
        text: obs.pressed
          ? `${p.id} đang được nhấn: hai cặp chân trái và phải nối với nhau.`
          : `${p.id} đang nhả: cặp chân trái và cặp chân phải không thông nhau (các chân cùng phía luôn thông).`,
        highlight: [p.id],
      });
    } else if (p.type === 'potentiometer') {
      if (!loose.includes('wiper')) notes.push({ level: 'info', text: `${p.id}: núm ở ${p.props?.position ?? 50} %, chân giữa đang có ${volts(v(keys.wiper!))}. Kéo thanh "position" để xoay núm.`, highlight: [p.id] });
    } else if (p.type === 'photoresistor') {
      notes.push({ level: 'info', text: `${p.id}: ở ${p.props?.light ?? 300} lux quang trở có ${ohms(Math.round(Number(obs.resistance)))}. Tối hơn thì lớn hơn, sáng hơn thì nhỏ hơn.`, highlight: [p.id] });
    } else if (p.type === 'buzzer' && !obs.damaged && !obs.sounding) {
      const vp = v(keys.plus!);
      const vm = v(keys.minus!);
      if (vm - vp > 1) notes.push({ level: 'warn', text: `${p.id} đang cắm ngược: chân − có ${volts(vm)}, cao hơn chân + (${volts(vp)}). Còi chủ động chỉ kêu khi chân + (chân dài) ở phía điện áp cao. Chọn còi rồi nhấn R hai lần để xoay 180°.`, highlight: [p.id] });
    } else if (p.type === 'rgb-led' && !obs.damaged && Number(obs.current ?? 0) < I_MIN) {
      const vc = v(keys.common!);
      const cathode = (p.props?.common ?? 'cathode') !== 'anode';
      const backwards = ['red', 'green', 'blue'].some((ch) => (cathode ? vc - v(keys[ch]!) : v(keys[ch]!) - vc) > 1.5);
      if (backwards)
        notes.push({ level: 'warn', text: `${p.id} không sáng vì phân cực ngược: loại chung ${cathode ? 'cathode thì chân chung (dài nhất) phải nối GND' : 'anode thì chân chung (dài nhất) phải nối 3,3 V'}. Kiểm tra lại, hoặc đổi "common" trong bảng thuộc tính nếu LED của bạn là loại kia.`, highlight: [p.id] });
    } else if (p.type === 'slide-switch') {
      notes.push({ level: 'info', text: `${p.id} đang gạt về phía ${p.props?.position ?? 'a'}: chân giữa nối với chân ${p.props?.position === 'b' ? 'phải (b)' : 'trái (a)'}. Bấm vào cần gạt để đổi.`, highlight: [p.id] });
    }
  }

  // --- Pins the user wired --------------------------------------------------------------
  for (const pin of board.pins) {
    const pad = padOfPin(pin.name);
    if (!pad) continue;
    const key = keyOf.boardPin(pin.name);
    const n = net(key);
    if (n === undefined || !userWired(n)) continue;
    const o = kernel.observables(`mcu.${pad}`);
    const state = volt.get(key);
    const caps = ctx.pads[pad];
    const name = `${pin.name} (${pad})`;
    const padAmps = Math.abs(Number(o.current ?? 0));
    if (padAmps > 0.04) {
      notes.push({ level: 'warn', text: `Chân ${pin.name} đang phải cấp ${amps(padAmps)}, quá giới hạn 40 mA của một chân ESP32: chân có thể hỏng. Thêm điện trở để giảm dòng.`, highlight: [key] });
    }
    if (o.output === 'high') {
      const pv = state?.v ?? 3.3;
      notes.push({
        level: 'info',
        text:
          pv < 3.0
            ? `${name} đang HIGH, nhưng chân chỉ còn ${volts(pv)} thay vì 3,3 V vì phải cấp dòng lớn (${amps(padAmps)}): mạch ngoài đang "kéo sụt" chân.`
            : `${name} đang HIGH: chip xuất ${volts(pv)} ra chân này (digitalWrite HIGH).`,
        highlight: [key],
      });
    } else if (o.output === 'low') {
      notes.push({ level: 'info', text: `${name} đang LOW: chân bị chip kéo về 0 V (digitalWrite LOW).`, highlight: [key] });
    } else if (state?.floating) {
      notes.push({ level: 'warn', text: `${name} đang là chân đọc nhưng thả nổi: không được nối tới 3,3 V hay GND, nên giá trị đọc được không xác định. Dùng pinMode(…, INPUT_PULLUP) hoặc thêm điện trở kéo.`, highlight: [key] });
    } else if (state) {
      const level = state.v >= 0.75 * 3.3 ? 'HIGH' : state.v <= 0.25 * 3.3 ? 'LOW' : 'không rõ (giữa ngưỡng)';
      const why = o.pull === 'up' && level === 'HIGH' ? ' nhờ điện trở kéo lên bên trong (INPUT_PULLUP)' : o.pull === 'up' && level === 'LOW' ? ': có đường nối chân xuống GND (ví dụ nút đang nhấn)' : '';
      notes.push({ level: 'info', text: `${name} là chân đọc, đang thấy ${volts(state.v)} → digitalRead() = ${level}${why}.`, highlight: [key] });
    }
    if (caps?.flash) notes.push({ level: 'error', text: `${name} nối với chip flash bên trong module, không được dùng.`, highlight: [key] });
    else if (caps?.strapping && STRAPPING[pad]) {
      // Only a real risk for GPIO12; elsewhere it's worth knowing, not alarming
      notes.push({ level: pad === 'GPIO12' ? 'warn' : 'info', text: `${name} là chân "strapping": ${STRAPPING[pad]}`, highlight: [key] });
    }
    if (caps?.inputOnly && o.output !== 'z') notes.push({ level: 'error', text: `${name} chỉ dùng làm chân đọc, không xuất được.`, highlight: [key] });
  }

  const order: Record<NoteLevel, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  return notes.sort((a, b) => order[a.level] - order[b.level]);
}
