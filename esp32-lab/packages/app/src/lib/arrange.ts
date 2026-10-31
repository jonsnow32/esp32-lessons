// Lay the whole bench out again: every part and wire taken up, then put back the way the
// one-click plug-in would place them (see autoplug.ts), with the circuit itself unchanged.
//
// The circuit is read from the netlist: which leg is on which net, which header pin and supply
// each net reaches. Each part then gets a plug spec of its own: a leg on a supply goes to a rail,
// a leg on a GPIO goes to that same pin (the sketch depends on it), a resistor that only sits
// between a leg and its pin (or pulls a leg up or down) is laid again right beside that leg.
// What is left, nets between parts only, becomes wires between legs.
//
// Parts that share a signal net work together (a relay and the pump it switches, two displays on
// one I2C bus): they are laid out as a group, one after the other, each drawn toward the legs it
// is wired to. The groups are laid out in a few orders and the bench with the least wire is kept.
// Its netlist is compared with the old one before anything is kept: a layout that would change the
// circuit is refused.

import type { PartInstance, Project } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, type SimKernel } from '@esp32lab/sim-core';
import { applyChange, autoPlug, placeOnBench, placeOnBreadboard, type Bodies, type PlugResult, type Spec } from './autoplug';
import { PARTS } from './catalog';
import { board, breadboardBox, endpointPos, pinPos, terminalPos } from './geometry';

type Supply = 'gnd' | '3v3' | '5v';
const SUPPLY_KEYS: [string, Supply][] = [
  [GROUND_KEY, 'gnd'],
  [keyOf.net('3V3'), '3v3'],
  [keyOf.net('5V'), '5v'],
];

/** What one net joins, as the arrangement needs it. */
interface Net {
  supply?: Supply;
  /** Header pins on it (GPIOs: power pins make it a supply). */
  pins: string[];
  /** Part legs on it, as "part.terminal". */
  legs: string[];
}

export function arrange(project: Project, netlist: (p: Project) => SimKernel | null, bodies?: Bodies): PlugResult {
  const kernel = netlist(project);
  if (!kernel) return { ok: false, reason: 'Không đọc được mạch hiện tại.' };
  const def = board(project);
  const n = kernel.netlist;

  // Every net that a part leg is on
  const nets = new Map<number, Net>();
  const netOf = new Map<string, number>();
  for (const p of project.parts) {
    for (const t of PARTS[p.type]?.manifest.terminals ?? []) {
      const id = n.net(keyOf.terminal(p.id, t.name));
      if (id === undefined) continue;
      netOf.set(`${p.id}.${t.name}`, id);
      if (nets.has(id)) {
        nets.get(id)!.legs.push(`${p.id}.${t.name}`);
        continue;
      }
      const keys = n.keysOf(id);
      const supply = SUPPLY_KEYS.find(([k]) => keys.includes(k))?.[1];
      const pins = def.pins.filter((pin) => 'pad' in pin.connect && keys.includes(keyOf.boardPin(pin.name))).map((pin) => pin.name);
      nets.set(id, { supply, pins, legs: [`${p.id}.${t.name}`] });
    }
  }
  const typeOf = (leg: string) => project.parts.find((p) => p.id === leg.slice(0, leg.indexOf('.')))!.type;
  const others = (net: Net, leg: string) => net.legs.filter((l) => l !== leg);

  // Resistors that belong to one leg: in series between it and its GPIO, or pulling it to a supply
  const specs = new Map<string, Spec>();
  const spec = (part: string) => specs.get(part) ?? specs.set(part, { pins: {} }).get(part)!;
  const absorbed = new Set<string>();
  for (const r of project.parts.filter((p) => p.type === 'resistor')) {
    const ohms = Number(r.props?.resistance ?? PARTS.resistor!.manifest.props.resistance?.default);
    const [a, b] = [`${r.id}.a`, `${r.id}.b`].map((l) => nets.get(netOf.get(l)!)) as [Net | undefined, Net | undefined];
    if (!a || !b || a === b) continue;
    for (const [leg, far, legNet, farNet] of [[`${r.id}.a`, `${r.id}.b`, a, b], [`${r.id}.b`, `${r.id}.a`, b, a]] as const) {
      const mine = others(legNet, leg);
      const target = mine[0];
      if (mine.length !== 1 || !target || typeOf(target) === 'resistor' || legNet.supply || legNet.pins.length) continue;
      const [part, terminal] = target.split('.') as [string, string];
      const s = spec(part);
      if (s.series?.[terminal]) continue;
      // Leg — resistor — GPIO, nothing else on the far side
      if (!farNet.supply && farNet.pins.length === 1 && others(farNet, far).length === 0) {
        s.series = { ...s.series, [terminal]: ohms };
        s.pins[terminal] = { pin: farNet.pins[0]! };
        absorbed.add(r.id);
        break;
      }
      // Leg — resistor — a supply (an LED's resistor on its cathode side, to GND)
      if (farNet.supply) {
        s.series = { ...s.series, [terminal]: ohms };
        s.pins[terminal] = farNet.supply;
        absorbed.add(r.id);
        break;
      }
    }
  }
  // A pull resistor: one leg on a supply, the other on a net with one other part leg and maybe a pin
  for (const r of project.parts.filter((p) => p.type === 'resistor' && !absorbed.has(p.id))) {
    const ohms = Number(r.props?.resistance ?? PARTS.resistor!.manifest.props.resistance?.default);
    for (const [leg, far] of [[`${r.id}.a`, `${r.id}.b`], [`${r.id}.b`, `${r.id}.a`]] as const) {
      const legNet = nets.get(netOf.get(leg)!);
      const farNet = nets.get(netOf.get(far)!);
      if (!legNet || !farNet || legNet === farNet) continue;
      if ((farNet.supply !== 'gnd' && farNet.supply !== '3v3') || legNet.supply) continue;
      const mine = others(legNet, leg).filter((l) => !absorbed.has(l.slice(0, l.indexOf('.'))));
      const target = mine[0];
      if (mine.length !== 1 || !target || typeOf(target) === 'resistor' || legNet.pins.length !== 1) continue;
      const [part, terminal] = target.split('.') as [string, string];
      const s = spec(part);
      if (s.pull?.[terminal]) continue;
      s.pull = { ...s.pull, [terminal]: [farNet.supply, ohms] };
      absorbed.add(r.id);
      break;
    }
  }

  const kept = project.parts.filter((p) => !absorbed.has(p.id));
  const isAbsorbedLeg = (l: string) => absorbed.has(l.slice(0, l.indexOf('.')));
  const partOf = (leg: string) => leg.slice(0, leg.indexOf('.'));
  /** Nets that carry a signal between things (a supply joins everything, so it groups nothing). */
  const signals = [...nets.values()].filter((net) => !net.supply);

  // Parts that work together: on a signal net together (a relay and its pump, two displays on one bus)
  const groupOf = new Map(kept.map((p) => [p.id, p.id]));
  const find = (id: string): string => (groupOf.get(id) === id ? id : find(groupOf.get(id)!));
  for (const net of signals) {
    const ids = [...new Set(net.legs.filter((l) => !isAbsorbedLeg(l)).map(partOf))];
    for (const id of ids.slice(1)) groupOf.set(find(id), find(ids[0]!));
  }
  /** How high on the board the pins a part uses sit: groups and parts are laid out from the top down. */
  const pinY = (id: string) => {
    const ys = signals.filter((net) => net.legs.some((l) => partOf(l) === id)).flatMap((net) => net.pins.map((pin) => pinPos(project, pin)!.y));
    return ys.length ? Math.min(...ys) : Infinity;
  };
  const neighbours = (id: string) =>
    new Set(signals.filter((net) => net.legs.some((l) => partOf(l) === id)).flatMap((net) => net.legs.filter((l) => !isAbsorbedLeg(l)).map(partOf)));
  const groups = [...new Set(kept.map((p) => find(p.id)))].map((root) => {
    // Within a group, from the part nearest the top of the board along its connections
    const members = kept.filter((p) => find(p.id) === root).map((p) => p.id).sort((a, b) => pinY(a) - pinY(b));
    const ordered: string[] = [];
    const queue = [members[0]!];
    while (ordered.length < members.length) {
      const next = queue.shift() ?? members.find((m) => !ordered.includes(m))!;
      if (ordered.includes(next)) continue;
      ordered.push(next);
      queue.push(...members.filter((m) => !ordered.includes(m) && neighbours(next).has(m)));
    }
    return ordered;
  });

  /** The bench laid out with the groups in this order, or why it cannot be. */
  const layout = (order: string[][]): PlugResult => {
    const specs2 = new Map([...specs].map(([k, v]) => [k, structuredClone(v)]));
    const spec2 = (part: string) => specs2.get(part) ?? specs2.set(part, { pins: {} }).get(part)!;
    const ids = order.flat();
    let out: Project = structuredClone(project);
    out.wires = [];
    const below = Math.max(out.board.y + def.height + 3, ...out.breadboards.map((b) => b.y + (breadboardBox(b.type)?.h ?? 0) + 2));
    out.parts = ids.map((id, i) => {
      const p = kept.find((q) => q.id === id)!;
      return {
        ...structuredClone(p),
        placement: null,
        // Out of the way until its turn: below the breadboards, or (with none) far off, so it blocks nothing on the bench
        bench: out.breadboards.length ? { x: out.board.x + 2 + 5 * (i % 8), y: below + 4 * Math.floor(i / 8), rot: 0 } : { x: 10 * i, y: FAR_OFF, rot: 0 },
      };
    });

    // Each leg: to a rail, to its pin (the first leg on a net in this order takes it), or wired to that first leg
    const hub = new Map<Net, string>();
    const wires: [string, string][] = [];
    for (const id of ids) {
      const p = kept.find((q) => q.id === id)!;
      for (const t of PARTS[p.type]?.manifest.terminals ?? []) {
        const leg = `${p.id}.${t.name}`;
        const net = nets.get(netOf.get(leg)!);
        const s = spec2(p.id);
        if (!net || s.pins[t.name]) continue;
        if (net.supply) {
          s.pins[t.name] = net.supply;
          continue;
        }
        const reached = net.pins.length > 0 || others(net, leg).some((l) => !isAbsorbedLeg(l));
        if (!reached) continue;
        const first = hub.get(net);
        if (first) wires.push([first, leg]);
        else {
          hub.set(net, leg);
          if (net.pins[0]) s.pins[t.name] = { pin: net.pins[0] };
        }
      }
    }
    // A net on two header pins: the second one by a wire too
    for (const [net, leg] of hub) for (const pin of net.pins.slice(1)) wires.push([`board:${pin}`, leg]);

    const placed = new Set<string>();
    for (const id of ids) {
      // Each leg drawn toward the legs already down that it shares a signal net with
      const p = out.parts.find((q) => q.id === id)!;
      const toward = (PARTS[p.type]?.manifest.terminals ?? []).flatMap((t) => {
        const net = nets.get(netOf.get(`${id}.${t.name}`)!);
        if (!net || net.supply) return [];
        return others(net, `${id}.${t.name}`)
          .filter((l) => placed.has(partOf(l)))
          .flatMap((l) => {
            const at = terminalPos(out, out.parts.find((q) => q.id === partOf(l))!, l.slice(l.indexOf('.') + 1));
            return at ? [{ terminal: t.name, at }] : [];
          });
      });
      placed.add(id);
      const s = spec2(id);
      if (!Object.keys(s.pins).length) {
        // Nothing to plug: onto the breadboard (or the bench), near what it is wired to
        if (!placeOnBreadboard(out, p, bodies, toward)) placeOnBench(out, p, bodies, toward);
        continue;
      }
      const r = autoPlug(out, id, netlist, bodies, s, toward);
      if (!r.ok) return { ok: false, reason: `Không xếp được ${id}: ${r.reason}` };
      out = r.project;
    }
    if (wires.length) {
      const r = applyChange(out, { parts: [], wires }, netlist, bodies);
      if (!r.ok) return r;
      out = r.project;
    }
    return { ok: true, project: out, report: [] };
  };

  // The groups top down, bottom up, and shuffled a few ways: the bench with the least wire wins
  const byPin = [...groups].sort((a, b) => pinY(a[0]!) - pinY(b[0]!));
  const orders = [byPin, [...byPin].reverse()];
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // Laying parts out on an open bench searches far more spots per part: fewer orders there
  for (let i = 0; i < (project.breadboards.length ? SHUFFLES : BENCH_SHUFFLES) && groups.length > 2; i++) {
    const o = [...byPin];
    for (let j = o.length - 1; j > 0; j--) {
      const k = Math.floor(random() * (j + 1));
      [o[j], o[k]] = [o[k]!, o[j]!];
    }
    orders.push(o);
  }
  const seen = new Set<string>();
  let best: { project: Project; score: number } | null = null;
  let failure = '';
  for (const order of orders) {
    const key = order.map((g) => g.join('+')).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = layout(order);
    if (!r.ok) {
      failure ||= r.reason;
      continue;
    }
    const score = wireLength(r.project) + r.project.wires.length * PER_WIRE + r.project.parts.filter((p) => !p.placement).length * OFF_BOARD;
    if (!best || score < best.score) best = { project: r.project, score };
  }
  if (!best) return { ok: false, reason: failure || 'Không tìm được cách xếp.' };
  const out = best.project;

  const same = sameCircuit(project, out, netlist, absorbed);
  if (same !== true) return { ok: false, reason: `Xếp lại sẽ làm đổi mạch (${same}), nên mình giữ nguyên.` };
  const report: string[] = [];
  const onBench = out.parts.filter((p) => !p.placement && project.parts.find((q) => q.id === p.id)?.placement).map((p) => p.id);
  report.push(`${kept.length} linh kiện, ${out.wires.length} dây dài ${Math.round(wireLength(out))} bước lỗ (trước: ${project.wires.length} dây, ${Math.round(wireLength(project))} bước lỗ)`);
  const together = groups.filter((g) => g.length > 1);
  if (together.length) report.push(`đặt cạnh nhau: ${together.map((g) => g.join(' + ')).join('; ')}`);
  if (onBench.length) report.push(`không đủ chỗ trên breadboard cho ${onBench.join(', ')}`);
  return { ok: true, project: out, report };
}

/** Where parts wait for their turn on a bench with no breadboard. */
const FAR_OFF = 10000;
/** Group orders tried beyond top-down and bottom-up. */
const SHUFFLES = 10;
const BENCH_SHUFFLES = 3;
/** A wire weighs this many pitches of wire: fewer wires first, then shorter ones. */
const PER_WIRE = 4;
/** A part left off the breadboards weighs this many pitches of wire. */
const OFF_BOARD = 200;

/** All the wire on the bench, in pitches, as each wire runs between its ends (across, then along). */
export function wireLength(project: Project): number {
  return project.wires.reduce((sum, w) => {
    const [a, b] = [endpointPos(project, w.a), endpointPos(project, w.b)];
    return sum + (a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 0);
  }, 0);
}

/**
 * Do the two benches make the same circuit? Every leg of the parts kept and every header pin on
 * the same nets as before; a resistor laid again must join the same two nets with the same value.
 * True, or what differs.
 */
export function sameCircuit(a: Project, b: Project, netlist: (p: Project) => SimKernel | null, relaid: Set<string>): true | string {
  const [ka, kb] = [netlist(a), netlist(b)];
  if (!ka || !kb) return 'không dựng được netlist';
  const def = board(a);
  const keys = [
    ...def.pins.map((p) => keyOf.boardPin(p.name)),
    ...a.parts.filter((p) => !relaid.has(p.id)).flatMap((p) => (PARTS[p.type]?.manifest.terminals ?? []).map((t) => keyOf.terminal(p.id, t.name))),
  ];
  // Group the keys by net on each bench: the groupings must match
  const groups = (k: SimKernel) => {
    const by = new Map<number, string[]>();
    for (const key of keys) {
      const id = k.netlist.net(key);
      if (id !== undefined) by.set(id, [...(by.get(id) ?? []), key]);
    }
    return new Set([...by.values()].filter((g) => g.length > 1).map((g) => g.sort().join('|')));
  };
  const [ga, gb] = [groups(ka), groups(kb)];
  for (const g of ga) if (!gb.has(g)) return `nhóm ${g.split('|').slice(0, 3).join(', ')} bị tách`;
  for (const g of gb) if (!ga.has(g)) return `nhóm ${g.split('|').slice(0, 3).join(', ')} bị nối thêm`;
  // Resistors laid again: the same values between the same nets, by the keys each side reaches
  const resistors = (p: Project, k: SimKernel, which: (id: string) => boolean) =>
    p.parts
      .filter((r) => r.type === 'resistor' && which(r.id))
      .map((r) => {
        const side = (t: string) => {
          const id = k.netlist.net(keyOf.terminal(r.id, t));
          return id === undefined ? '' : k.netlist.keysOf(id).filter((x) => keys.includes(x)).sort().join('|');
        };
        return `${r.props?.resistance}:${[side('a'), side('b')].sort().join('~')}`;
      })
      .sort()
      .join('\n');
  const before = resistors(a, ka, (id) => relaid.has(id));
  const after = resistors(b, kb, (id) => !a.parts.some((p) => p.id === id && !relaid.has(id)));
  return before === after ? true : 'điện trở không còn đúng chỗ';
}
