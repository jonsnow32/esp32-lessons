// Checking a circuit the AI assistant planned, part by part, before the user sees it. Two passes:
//
// - wiring: every leg the part's manifest says to plug in (PlugSpec) goes somewhere, and to the
//   right kind of place: a module's VCC on a supply, its GND on GND, I2C on the I2C pins, a signal
//   on a GPIO that can do the job, the pull resistor there, nothing bypassed by a strip or
//   reversed;
// - power: the circuit solved with the GPIOs that drive things held HIGH, then LOW (the GPIOs
//   reading things left as inputs with the pull-up on), and no part, pin or supply over its limit.
//
// Errors are what makes the circuit wrong (the assistant has to fix them before the user sees
// it); warnings are worth knowing. Only what the change brought is reported: a finding the bench
// already had is not the proposal's doing.

import { explain } from '@esp32lab/explain';
import { ESP32_PAD_NAMES, ESP32_PADS } from '@esp32lab/mcu-esp32';
import { MS, type PartManifest, type PlugRole } from '@esp32lab/part-sdk';
import type { BoardDef, Project } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { BOARDS, BREADBOARDS, PARTS } from './catalog';
import { pinInfo } from './pinout';

export interface Finding {
  level: 'error' | 'warn';
  text: string;
  /** What the finding is about, the same from one plan to the next (to tell old from new). */
  key: string;
}

const MANIFESTS = Object.fromEntries(Object.entries(PARTS).map(([k, m]) => [k, m.manifest]));
const SUPPLY: Partial<Record<PlugRole, string>> = { '3v3': '3V3', '5v': '5V' };
const SIGNAL: PlugRole[] = ['out', 'in', 'adc', 'sda', 'scl'];
/** Roles of a leg the ESP32 reads: its pad is left as an input in the power pass. */
const READ: PlugRole[] = ['in', 'adc', 'sda', 'scl'];
const PAD_MAX = 0.04;

const num = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
const amps = (i: number) => (i >= 1 ? `${num(i)} A` : `${num(i * 1000)} mA`);

/** What `planned` has wrong that `before` (the bench as it is) did not. */
export function verifyChange(before: Project, planned: Project): Finding[] {
  const old = new Set(verifyCircuit(before).map((f) => f.key));
  const had = new Set(before.parts.map((p) => p.id));
  return verifyCircuit(planned)
    .filter((f) => !old.has(f.key))
    .map((f) => {
      // A part already there that the change left open on one side: most likely what is left of the part it replaced
      const id = f.key.slice(0, f.key.indexOf(':one-side:'));
      if (!f.key.includes(':one-side:') || !had.has(id)) return f;
      return { ...f, level: 'error' as const, text: `${f.text} Đề xuất này đã ngắt phía kia của ${id}: nếu nó không còn dùng thì gỡ đi (remove), nếu còn dùng thì nối lại.` };
    })
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

/** Everything wrong with the circuit, errors first. */
export function verifyCircuit(project: Project): Finding[] {
  const board = BOARDS[project.board.type];
  if (!board) return [];
  const build = (setup?: (m: ScriptedMcu) => void) => {
    const mcu = new ScriptedMcu(ESP32_PAD_NAMES);
    setup?.(mcu);
    try {
      return new SimKernel({ project, board, breadboards: BREADBOARDS, parts: PARTS, mcu });
    } catch {
      return null;
    }
  };
  const kernel = build();
  if (!kernel) return [{ level: 'error', text: 'Không dựng được mạch này để kiểm tra.', key: 'build' }];
  const wiring = checkWiring(project, board, kernel);
  const findings = [...wiring.findings, ...checkPower(project, board, build, wiring)];
  // One finding per thing: the first (most severe) said about it
  const seen = new Set<string>();
  return findings
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
    .filter((f) => !seen.has(f.key) && seen.add(f.key));
}

interface Wiring {
  findings: Finding[];
  /** Pads that a part's leg reads from (left as inputs when powering the circuit up). */
  read: Set<string>;
  /** Parts already found wired wrong: what the power pass says about them is beside the point. */
  wrong: Set<string>;
  /** Parts and header pins (netlist keys) something was said about, so the circuit notes do not say it again. */
  flagged: Set<string>;
}

function checkWiring(project: Project, board: BoardDef, kernel: SimKernel): Wiring {
  const nl = kernel.netlist;
  const findings: Finding[] = [];
  const read = new Set<string>();
  const wrong = new Set<string>();
  const flagged = new Set<string>();
  const parts = kernel.terminals();
  const supplies = new Set(board.supplies.map((s) => s.net));
  const pinOf = (pad: string) => board.pins.find((p) => 'pad' in p.connect && p.connect.pad === pad);
  const pinName = (pad: string) => pinOf(pad)?.name ?? pad;

  /** The board net ("GND", "3V3", "5V") on net n, if any. */
  const boardNet = (n: number | undefined) => (n === undefined ? undefined : nl.keysOf(n).find((k) => k.startsWith('net:'))?.slice(4));
  const padsOn = (n: number | undefined) => (n === undefined ? [] : nl.keysOf(n).filter((k) => k.startsWith('pad:')).map((k) => k.slice(4)));
  /** Net n and the nets one resistor away from it. */
  const reach = (n: number | undefined): number[] => {
    if (n === undefined) return [];
    const out = [n];
    for (const p of project.parts.filter((q) => q.type === 'resistor')) {
      const keys = parts.get(p.id)?.keys;
      if (!keys) continue;
      const [a, b] = [nl.net(keys.a!), nl.net(keys.b!)];
      if (a === n && b !== undefined && b !== n) out.push(b);
      else if (b === n && a !== undefined && a !== n) out.push(a);
    }
    return out;
  };
  /** A resistor straight from net n to the board net named. */
  const pulled = (n: number | undefined, to: string) => reach(n).slice(1).some((m) => boardNet(m) === to);
  const userWired = (n: number | undefined) => n !== undefined && nl.keysOf(n).some((k) => k.startsWith('h:') || (k.startsWith('p:') && !k.startsWith('p:board.')));
  const connectedBeyond = (key: string, self: string) => {
    const n = nl.net(key);
    return n !== undefined && nl.keysOf(n).some((k) => !k.startsWith('h:') && !k.startsWith(`p:${self}:`));
  };
  /** `about`: the part id or header pin key the finding is about. */
  const add = (level: Finding['level'], key: string, text: string, about?: string) => {
    findings.push({ level, key, text });
    if (!about) return;
    flagged.add(about);
    if (level === 'error') wrong.add(about);
  };

  // --- The board's own nets -----------------------------------------------------------------
  for (const s of supplies) {
    if (nl.connected(keyOf.net(s), GROUND_KEY)) add('error', `short:${s}`, `Chập mạch: ${s} nối thẳng xuống GND.`);
    for (const t of supplies) if (s < t && nl.connected(keyOf.net(s), keyOf.net(t))) add('error', `short:${s}:${t}`, `Chập mạch: nguồn ${s} và ${t} nối thẳng với nhau.`);
  }
  for (const pin of board.pins) {
    const pad = 'pad' in pin.connect ? pin.connect.pad : undefined;
    if (!pad || !ESP32_PADS[pad]) continue;
    const n = nl.net(keyOf.boardPin(pin.name));
    if (!userWired(n)) continue;
    const on = boardNet(n);
    if (on) add('error', `pin-supply:${pin.name}`, `Chân ${pin.name} nối thẳng vào ${on}: khi chân xuất mức ngược lại là chập mạch. Phải có linh kiện hoặc điện trở ở giữa.`, keyOf.boardPin(pin.name));
    // Each pair once, from its first pad
    const others = padsOn(n).filter((p) => p !== pad && ESP32_PADS[p] && pinOf(p));
    if (others.length && others.every((p) => pad < p)) add('warn', `pins-joined:${pin.name}`, `Chân ${pin.name} và ${others.map(pinName).join(', ')} nối chung một đường: hai chân cùng xuất sẽ giành nhau.`, keyOf.boardPin(pin.name));
  }

  // --- Each part ----------------------------------------------------------------------------
  for (const p of project.parts) {
    const m = MANIFESTS[p.type] as PartManifest | undefined;
    const keys = parts.get(p.id)?.keys;
    if (!m || !keys) continue;
    const legs = m.terminals.map((t) => t.name);
    const label = (t: string) => {
      const l = m.terminals.find((d) => d.name === t)?.label;
      if (!l || l.toLowerCase() === t) return t;
      return l.includes('(') ? l : `${t} (${l})`;
    };
    const net = (t: string) => nl.net(keys[t]!);
    const loose = new Set(legs.filter((t) => !connectedBeyond(keys[t]!, p.id)));

    // Two legs on one net that the part does not join itself: the part is bypassed
    const joined = new Set((m.internalShorts ?? []).map(([a, b]) => [a, b].sort().join('|')));
    const apart = (t: string, u: string) => (m.isolated ?? []).some((g) => g.includes(t) !== g.includes(u));
    const shorted = legs.flatMap((t, i) => legs.slice(i + 1).filter((u) => !joined.has([t, u].sort().join('|')) && !apart(t, u) && !loose.has(t) && net(t) === net(u)).map((u) => [t, u] as const));
    if (shorted.length) {
      const [t, u] = shorted[0]!;
      add('error', `${p.id}:shorted`, `${p.id} bị nối tắt: chân ${label(t)} và ${label(u)} cùng một net, dòng điện đi vòng qua chứ không qua linh kiện.`, p.id);
      continue;
    }
    if (loose.size === legs.length) {
      add('error', `${p.id}:unplugged`, `${p.id} chưa nối vào mạch: không chân nào có dây.`, p.id);
      continue;
    }
    // A group of legs with something on one side only carries no current
    for (const group of m.isolated ?? [legs]) {
      const on = group.filter((t) => !loose.has(t));
      if (group.length > 1 && on.length && new Set(on.map(net)).size === 1 && on.length < group.length && !group.every((t) => loose.has(t) || on.some((u) => joined.has([t, u].sort().join('|')))))
        add('warn', `${p.id}:one-side:${group.join(',')}`, `${p.id}: trong các chân ${group.map(label).join(', ')} chỉ có ${on.map(label).join(', ')} được nối, phía kia hở nên không có dòng điện qua.`, p.id);
    }

    const plug = m.plug;
    if (!plug) continue;
    const roles = Object.entries(plug.pins) as [string, PlugRole][];
    const signals = roles.filter(([, r]) => SIGNAL.includes(r));
    // A module has its own supply and ground legs; polar parts work one way round only
    const module = roles.some(([, r]) => SUPPLY[r]) && roles.some(([, r]) => r === 'gnd');
    const polar = m.category === 'output' || m.category === 'display' || legs.some((t) => /^(vcc|vdd|gnd)$/.test(t));

    for (const [t, role] of roles) {
      const n = net(t);
      const on = boardNet(n);
      if (loose.has(t)) {
        // Leaving one of several channels free is a choice; a supply, ground or the only signal is not
        const level = SIGNAL.includes(role) && signals.length > 1 ? 'warn' : 'error';
        add(level, `${p.id}:${t}:loose`, `${p.id}: chân ${label(t)} chưa nối vào đâu (cần nối ${roleText(role)}).`, p.id);
        continue;
      }
      if (role === 'gnd' && polar) {
        if (on && on !== 'GND') add('error', `${p.id}:${t}:reversed`, `${p.id}: chân ${label(t)} phải về phía GND nhưng đang nối ${on}: cắm ngược hoặc nhầm chân.`, p.id);
        else if (module && on !== 'GND') add('error', `${p.id}:${t}:gnd`, `${p.id}: chân ${label(t)} của module phải nối thẳng GND.`, p.id);
      } else if (SUPPLY[role] && polar) {
        if (on === 'GND') add('error', `${p.id}:${t}:reversed`, `${p.id}: chân ${label(t)} là chân nguồn nhưng đang nối GND: cắm ngược.`, p.id);
        else if (!on || !supplies.has(on)) add('error', `${p.id}:${t}:supply`, `${p.id}: chân nguồn ${label(t)} phải nối thẳng ${SUPPLY[role] === '5V' ? 'VIN (5 V)' : '3V3'}, không qua GPIO hay linh kiện khác.`, p.id);
        else if (role === '5v' && on === '3V3') add('warn', `${p.id}:${t}:3v3`, `${p.id} cần 5 V nhưng chân ${label(t)} đang nối 3V3: nối chân VIN.`, p.id);
      } else if (role === 'sda' || role === 'scl') {
        const want = board.wiring?.i2c?.[role];
        const other = board.wiring?.i2c?.[role === 'sda' ? 'scl' : 'sda'];
        const pads = padsOn(n);
        if (want && !pads.includes(want)) {
          add('error', `${p.id}:${t}:i2c`, pads.includes(other ?? '') ? `${p.id}: SDA và SCL bị đảo: chân ${label(t)} phải nối ${pinName(want)}.` : `${p.id}: chân ${label(t)} phải nối ${pinName(want)} (${role.toUpperCase()} của bus I2C).`, p.id);
        } else if (want) read.add(want);
      } else if (role === 'out' && polar && !module && on === 'GND') {
        add('error', `${p.id}:${t}:reversed`, `${p.id}: chân ${label(t)} phải ở phía có điện áp (GPIO hoặc nguồn) nhưng đang về GND: cắm ngược.`, p.id);
      }
      if (plug.pull?.[t]) {
        const [to, ohms] = plug.pull[t]!;
        const supply = to === 'gnd' ? 'GND' : '3V3';
        if (padsOn(n).length && !pulled(n, supply)) add('warn', `${p.id}:${t}:pull`, `${p.id}: chân ${label(t)} nên có điện trở ${ohms >= 1000 ? `${num(ohms / 1000)} kΩ` : `${ohms} Ω`} kéo ${to === 'gnd' ? 'xuống GND' : 'lên 3V3'}.`, p.id);
      }
    }

    // The GPIOs the part's signals reach, straight or through a resistor
    if (!signals.length) continue;
    const reached = new Map<string, PlugRole>();
    for (const [t, role] of roles) {
      if (loose.has(t)) continue;
      for (const n of reach(net(t))) for (const pad of padsOn(n)) if (pinOf(pad) && ESP32_PADS[pad]) reached.set(pad, SIGNAL.includes(role) ? role : (reached.get(pad) ?? role));
    }
    // A light or a buzzer may well be switched by a relay or a button instead; a module needs the ESP32
    if (!reached.size && module) {
      add('warn', `${p.id}:no-gpio`, `${p.id} không nối với chân GPIO nào: code không ${signals.some(([, r]) => r === 'out') ? 'điều khiển' : 'đọc'} được nó.`, p.id);
      continue;
    }
    for (const [pad, role] of reached) {
      const pin = pinOf(pad)!;
      const info = pinInfo(board, pin);
      const caps = ESP32_PADS[pad]!;
      if (READ.includes(role)) read.add(pad);
      if (caps.flash) add('error', `${p.id}:${pin.name}:flash`, `${p.id} nối vào ${pin.name}, chân của bộ nhớ flash: board sẽ treo. Chọn chân khác.`, p.id);
      else if (role === 'out' && caps.inputOnly) add('error', `${p.id}:${pin.name}:input-only`, `${p.id} cần chân xuất tín hiệu nhưng ${pin.name} (${pad}) chỉ đọc vào được. Chọn chân khác.`, p.id);
      else if (role === 'adc' && !caps.adc) add('error', `${p.id}:${pin.name}:adc`, `${p.id} cần đọc analog nhưng ${pin.name} (${pad}) không có ADC. Dùng chân ADC1 (D32–D39).`, p.id);
      else if (role === 'adc' && caps.adcBlockedByWifi) add('warn', `${p.id}:${pin.name}:adc2`, `${p.id} đọc analog ở ${pin.name} (ADC2): không đọc được khi bật Wi-Fi. Nên dùng chân ADC1 (D32–D39).`, p.id);
      else if (info.verdict === 'avoid' || board.wiring?.avoid?.includes(pad)) add('warn', `${p.id}:${pin.name}:avoid`, `${p.id} nối vào ${pin.name}: ${info.note}`, p.id);
    }
  }
  return { findings, read, wrong, flagged };
}

function roleText(role: PlugRole): string {
  return { gnd: 'GND', '3v3': '3V3', '5v': 'VIN (5 V)', out: 'một chân GPIO', in: 'một chân GPIO', adc: 'một chân ADC1', sda: 'SDA', scl: 'SCL', common: 'chân chung' }[role];
}

/** Power the circuit up with the driving GPIOs HIGH, then LOW: what goes over its limit. */
function checkPower(project: Project, board: BoardDef, build: (setup?: (m: ScriptedMcu) => void) => SimKernel | null, wiring: Wiring): Finding[] {
  const findings: Finding[] = [];
  const probe = build();
  if (!probe) return findings;
  const nl = probe.netlist;
  // The GPIOs the user wired, not counting those a part's leg reads from
  const pads = board.pins.flatMap((pin) => {
    if (!('pad' in pin.connect) || !ESP32_PADS[pin.connect.pad]) return [];
    const n = nl.net(keyOf.boardPin(pin.name));
    const wired = n !== undefined && nl.keysOf(n).some((k) => k.startsWith('h:') || (k.startsWith('p:') && !k.startsWith('p:board.')));
    return wired ? [pin.connect.pad] : [];
  });
  const drive = pads.filter((p) => !wiring.read.has(p) && !ESP32_PADS[p]!.inputOnly);
  const label = (pad: string) => board.pins.find((p) => 'pad' in p.connect && p.connect.pad === pad)?.name ?? pad;
  const flagged = new Set(wiring.flagged);

  for (const level of ['high', 'low'] as const) {
    if (!drive.length && level === 'low') break;
    const when = drive.length ? ` khi ${drive.map(label).join(', ')} ở mức ${level.toUpperCase()}` : '';
    const kernel = build((m) => {
      for (const p of drive) m.set(p, { output: level }, 0);
      for (const p of wiring.read) m.set(p, { pull: 'up' }, 0);
    });
    if (!kernel) break;
    kernel.advanceTo(1 * MS);
    for (const d of kernel.diagnostics.filter((x) => x.code === 'damaged' && x.part))
      findings.push({ level: 'error', key: `${d.part}:damaged`, text: `${d.part} cháy ngay khi cấp điện${when}.` });
    const currents = kernel.terminalCurrents();
    for (const p of project.parts) {
      const max = MANIFESTS[p.type]?.ratings?.currentMax;
      // A display's common leg carries every segment: its rating is per segment
      const series = Object.keys(MANIFESTS[p.type]?.plug?.series ?? {});
      const legs = Object.entries(currents.get(p.id) ?? {}).filter(([t]) => series.length < 2 || series.includes(t));
      const i = Math.max(0, ...legs.map(([, a]) => Math.abs(a)));
      if (!max || i <= max || wiring.wrong.has(p.id)) continue;
      flagged.add(p.id);
      findings.push({ level: 'error', key: `${p.id}:current`, text: `${p.id} chịu ${amps(i)}${when}, quá mức ${amps(max)}${p.type === 'led' || p.type === 'led-bar' || p.type === 'rgb-led' || p.type === 'seven-segment' ? ': thiếu điện trở hạn dòng (220–330 Ω)' : ''}.` });
    }
    // A part over its limit says more than the pin feeding it
    const overloaded = findings.some((f) => f.key.endsWith(':current'));
    for (const pad of drive) {
      const i = Math.abs(Number(kernel.observables(`mcu.${pad}`).current ?? 0));
      if (i <= PAD_MAX) continue;
      flagged.add(keyOf.boardPin(label(pad)));
      if (!overloaded) findings.push({ level: 'error', key: `pad:${pad}:current`, text: `Chân ${label(pad)} phải cấp ${amps(i)}${when}, quá ${amps(PAD_MAX)} một chân ESP32 chịu được. Tải lớn (bơm, động cơ) phải đi qua relay hoặc MOSFET.` });
    }
    // What the circuit notes warn about, unless it was said already
    const notes = explain({ kernel, project, board, pads: ESP32_PADS, manifests: MANIFESTS });
    for (const n of notes) {
      if (n.level !== 'error' && n.level !== 'warn') continue;
      if (n.highlight.some((h) => flagged.has(h))) continue;
      findings.push({ level: n.level, key: `note:${n.text.replace(/[\d,.]+/g, '#')}`, text: n.text });
    }
  }
  return findings;
}
