// The circuit on the bench drawn as a schematic: breadboard strips and jumper wires collapse
// into nets, and only what is electrically connected is drawn. Pixel units, as in part-sdk's
// schematic.ts, whose symbols and classes it reuses.
//
// Layout, as hobby schematics usually go: the ESP32 as a block on the left with only the pins
// in use, everything else stacked to its right. Two-leg parts (resistor, LED, button…) are drawn
// in rows, chained from a GPIO through the parts in series down to GND or up to a supply;
// modules are boxes with their signal pins facing the ESP32, supplies on top and GND below.
// GND and 3V3 / 5V are symbols, never wires; a net that neither reaches the ESP32 nor a supply
// but joins several things gets a label (N1, N2…) at each end.

import { sch } from '@esp32lab/part-sdk';
import { GROUND_KEY, keyOf, type SimKernel } from '@esp32lab/sim-core';
import type { PartInstance, Project } from '@esp32lab/project-model';
import { PARTS } from './catalog';

type P = [number, number];

/** Two-leg parts drawn as a symbol in a row: which legs, the symbol, the designator letter. */
const TWO_LEG: Record<string, { legs: [string, string]; ref: string; draw: (a: P, b: P, part: PartInstance, label: string) => string }> = {
  resistor: { legs: ['a', 'b'], ref: 'R', draw: (a, b, p, l) => sch.resistor(a, b, l, sch.ohm(Number(prop(p, 'resistance')))) },
  // The designator goes under an LED, clear of its light arrows
  led: { legs: ['anode', 'cathode'], ref: 'LED', draw: (a, b, p, l) => sch.diode(a, b, { led: true, color: LED_COLORS[String(prop(p, 'color'))] }) + sch.text((a[0] + b[0]) / 2, a[1] + 22, l) },
  diode: { legs: ['anode', 'cathode'], ref: 'D', draw: (a, b, p, l) => sch.diode(a, b, { label: l, sub: String(prop(p, 'model')) }) },
  buzzer: { legs: ['plus', 'minus'], ref: 'BZ', draw: (a, b, _p, l) => sch.buzzer(a, b, l) },
  photoresistor: { legs: ['a', 'b'], ref: 'LDR', draw: (a, b, _p, l) => sch.variable(a, b, 'light', l) },
  thermistor: { legs: ['a', 'b'], ref: 'TH', draw: (a, b, _p, l) => sch.variable(a, b, 'heat', l, 'NTC 10 kΩ') },
  pushbutton: { legs: ['a1', 'b1'], ref: 'SW', draw: (a, b, _p, l) => sch.switchSym(a, b, false, l) },
  'tilt-switch': { legs: ['a', 'b'], ref: 'SW', draw: (a, b, _p, l) => sch.switchSym(a, b, false, l, 'nghiêng') },
};

/** Designator letters for the parts drawn as boxes. */
const BOX_REF: Record<string, string> = { potentiometer: 'RV', 'slide-switch': 'SW', 'rgb-led': 'LED', relay: 'K' };

const LED_COLORS: Record<string, string> = { red: '#e5484d', yellow: '#f5d90a', green: '#46a758', blue: '#3e63dd', white: '#f0f0f3' };

function prop(part: PartInstance, name: string) {
  return part.props?.[name] ?? PARTS[part.type]?.manifest.props[name]?.default;
}

const PITCH = 20; // between neighbouring pins
const ROW = 62; // height of a row of two-leg parts
const SPAN = 84; // width of one two-leg symbol in a row
const ESP_X = 10;
const ESP_W = 84;
const STUB = ESP_X + ESP_W + 12; // where the ESP32's pin stubs end

/** What a net is, for drawing: the ESP32 pad on it, a supply, ground, or none of those. */
interface Net {
  index: number;
  /** "GPIO18", when an ESP32 pad is on the net. */
  pad?: string;
  /** "GND", "3V3" or "5V". */
  rail?: string;
  /** Legs of the parts drawn on the net. */
  legs: { part: string; terminal: string }[];
  /** "N1"…, when the net needs a label (assigned while drawing). */
  label?: string;
}

/** A thing to stack right of the ESP32: a row of two-leg parts, or a module box. */
interface Item {
  /** Its size and drawing, given its top and left edge. */
  width: number;
  height: number;
  /** Where its connections to ESP32 pads are, relative to its top / left. */
  pads: { net: number; dy: number; x: number }[];
  draw: (x: number, y: number) => string;
}

export interface Schematic {
  svg: string;
  width: number;
  height: number;
  /** Nothing to draw (no parts connected to anything). */
  empty: boolean;
}

export function buildSchematic(project: Project, kernel: SimKernel, voltages: Record<string, number | null> = {}): Schematic {
  const nl = kernel.netlist;
  const nets = new Map<number, Net>();
  const netOf = (key: string): Net | undefined => {
    const index = nl.net(key);
    if (index === undefined) return undefined;
    let n = nets.get(index);
    if (!n) {
      const keys = nl.keysOf(index);
      const pad = keys.find((k) => k.startsWith('pad:GPIO'))?.slice(4);
      const rail = index === nl.net(GROUND_KEY) ? 'GND' : keys.includes(keyOf.net('3V3')) ? '3V3' : keys.includes(keyOf.net('5V')) ? '5V' : undefined;
      n = { index, pad: rail ? undefined : pad, rail, legs: [] };
      nets.set(index, n);
    }
    return n;
  };

  // Parts to draw (the board's own parts are the board's business), and the net of each leg
  const parts = project.parts.filter((p) => PARTS[p.type]);
  const legNet = new Map<string, Net>();
  for (const part of parts) {
    for (const t of PARTS[part.type]!.manifest.terminals) {
      const n = netOf(keyOf.terminal(part.id, t.name));
      if (!n) continue;
      legNet.set(`${part.id}:${t.name}`, n);
      n.legs.push({ part: part.id, terminal: t.name });
    }
  }
  const net = (part: string, terminal: string) => legNet.get(`${part}:${terminal}`);
  /** A net joins something besides this leg (another part, the ESP32, a supply). */
  const joined = (n: Net | undefined) => !!n && (!!n.pad || !!n.rail || partsOn(n) > 1);
  /** How many parts have a leg on the net (a button's two joined legs count once). */
  const partsOn = (n: Net) => new Set(n.legs.map((l) => l.part)).size;
  /** ESP32 pads only reached through a label at the end of a row: listed on the ESP32 all the same. */
  const labelledPads = new Set<number>();
  let labels = 0;
  const labelOf = (n: Net) => (n.label ??= `N${++labels}`);

  const refs = designators(parts);

  // The voltage on a net while the program runs, beside its pin or label
  const volts = (n: Net) => {
    const v = nl.keysOf(n.index).map((k) => voltages[k]).find((v) => v !== undefined);
    return v === undefined || v === null ? '' : `${v.toFixed(2).replace('.', ',')} V`;
  };

  /** How a row or box leg that does not go to the ESP32 ends at `at`, facing `dir` (−1 left, +1 right). */
  function end(n: Net | undefined, at: P, dir: -1 | 1): string {
    const [x, y] = at;
    if (n?.rail === 'GND') return sch.gnd(x, y);
    if (n?.rail) return sch.supply(x, y, n.rail);
    if (!joined(n)) return `<path class="sch-w sch-nc" d="M${x - 4},${y - 4} l8,8 m0,-8 l-8,8"/>`;
    const name = n!.pad ?? labelOf(n!);
    return sch.wire([[x, y], [x + 8 * dir, y]]) + flag(x + 8 * dir, y, name, dir);
  }

  // --- Rows: chains of two-leg parts ----------------------------------------------------------
  const placed = new Set<string>();
  const rowOf = new Map<string, Item>();
  const items: { order: number; item: Item }[] = [];
  const twoLeg = (id: string) => {
    const p = parts.find((q) => q.id === id);
    return p && TWO_LEG[p.type] ? p : undefined;
  };
  /** A net that a row simply passes through: two two-leg parts in series and nothing else. */
  const through = (n: Net) => !n.pad && !n.rail && partsOn(n) === 2 && n.legs.every((l) => twoLeg(l.part));

  function chain(start: Net, first: PartInstance) {
    const steps: { part: PartInstance; from: string; to: string }[] = [];
    let part: PartInstance | undefined = first;
    let at = start;
    while (part && !placed.has(part.id)) {
      placed.add(part.id);
      const [a, b] = TWO_LEG[part.type]!.legs;
      const from = net(part.id, a) === at ? a : b;
      const to = from === a ? b : a;
      steps.push({ part, from, to });
      const next = net(part.id, to);
      if (!next || next === at || !through(next)) break;
      at = next;
      const nextLeg: { part: string } | undefined = next.legs.find((l) => l.part !== part!.id);
      part = nextLeg && twoLeg(nextLeg.part);
    }
    const last = steps[steps.length - 1]!;
    const endNet = net(last.part.id, last.to);
    if (endNet?.pad && endNet !== start) labelledPads.add(endNet.index);
    const width = steps.length * SPAN;
    const item: Item = {
      width: width + 80,
      height: ROW,
      pads: start.pad ? [{ net: start.index, dy: ROW / 2, x: 0 }] : [],
      draw: (x, y) => {
        const cy = y + ROW / 2;
        let s = start.pad ? '' : end(start, [x, cy], -1);
        steps.forEach((st, i) => {
          const a: P = [x + i * SPAN, cy];
          const b: P = [x + (i + 1) * SPAN, cy];
          const def = TWO_LEG[st.part.type]!;
          // Symbols are drawn from their first leg to their second: turn them round if entered backwards
          const forward = st.from === def.legs[0];
          s += `<g data-part="${st.part.id}">${def.draw(forward ? a : b, forward ? b : a, st.part, refs.get(st.part.id)!)}</g>`;
        });
        const tail: P = [x + width, cy];
        // A supply or ground hangs off a short lead, clear of the last symbol's label
        if (endNet?.rail) s += sch.wire([tail, [tail[0] + 16, cy]]) + end(endNet, [tail[0] + 16, cy], 1);
        else s += end(endNet, tail, 1);
        return s;
      },
    };
    items.push({ order: parts.indexOf(first), item });
    rowOf.set(first.id, item);
  }

  // Rows start at the ESP32 if they can, then at a supply, a labelled net, ground
  const starts = [...nets.values()].sort((m, n) => rank(m) - rank(n) || m.index - n.index);
  function rank(n: Net) {
    return n.pad ? 0 : n.rail === '3V3' || n.rail === '5V' ? 1 : n.rail === 'GND' ? 3 : 2;
  }
  for (const n of starts) {
    for (const leg of n.legs) {
      const p = twoLeg(leg.part);
      if (p && !placed.has(p.id) && TWO_LEG[p.type]!.legs.includes(leg.terminal)) chain(n, p);
    }
  }
  // Two-leg parts connected to nothing at all
  for (const p of parts) {
    if (!TWO_LEG[p.type] || placed.has(p.id)) continue;
    const n = net(p.id, TWO_LEG[p.type]!.legs[0]);
    if (n) chain(n, p);
  }

  // --- Potentiometers: a resistor standing between its ends, the wiper pointing at it ----------
  for (const part of parts) {
    if (part.type !== 'potentiometer') continue;
    const [a, wiper, b] = ['a', 'wiper', 'b'].map((t) => net(part.id, t));
    const H = 96;
    const margin = wiper?.pad ? 40 : 70;
    const item: Item = {
      width: margin + 90,
      height: H,
      pads: wiper?.pad ? [{ net: wiper.index, dy: H / 2, x: 0 }] : [],
      draw: (x0, y0) => {
        const x = x0 + margin;
        const cy = y0 + H / 2;
        const top: P = [x, y0 + 22];
        const bottom: P = [x, y0 + H - 22];
        let s = sch.resistor(top, bottom, refs.get(part.id), sch.ohm(Number(prop(part, 'resistance'))));
        // Ends: a supply above, ground below (turned round if wired the other way up)
        s += end(a, top, 1) + end(b, bottom, 1);
        const head = `<path class="sch-b-ink" d="M${x - 7},${cy} l-8,-4 v8 Z"/>`;
        s += sch.wire([[wiper?.pad ? x0 : x - 30, cy], [x - 12, cy]]) + head;
        if (!wiper?.pad) s += end(wiper, [x - 30, cy], -1);
        return `<g data-part="${part.id}">${s}</g>`;
      },
    };
    items.push({ order: parts.indexOf(part), item });
  }

  // --- Boxes: everything with more legs -------------------------------------------------------
  for (const part of parts) {
    if (TWO_LEG[part.type] || part.type === 'potentiometer') continue;
    const m = PARTS[part.type]!.manifest;
    // Pushbutton-style legs that are the same pin inside the part are drawn once
    const shorted = new Set((m.internalShorts ?? []).map(([, b]) => b));
    const legs = m.terminals.filter((t) => !shorted.has(t.name)).map((t) => ({ name: t.name.toUpperCase(), terminal: t.name, n: net(part.id, t.name) }));
    const top = legs.filter((l) => l.n?.rail === '3V3' || l.n?.rail === '5V');
    const bottom = legs.filter((l) => l.n?.rail === 'GND');
    const left = legs.filter((l) => !l.n?.rail);
    const title = `${refs.get(part.id)} · ${m.name.length > 26 ? m.name.slice(0, 25) + '…' : m.name}`;
    const w = Math.max(96, (Math.max(top.length, bottom.length) + 1) * 34, title.length * 6.8 + 16);
    // Inside the box: supply pins' names, the title, the side pins, ground pins' names
    const first = top.length ? 44 : 30;
    const boxH = Math.max(44, (left.length ? first + (left.length - 1) * PITCH : first - 6) + (bottom.length ? 26 : 16));
    const above = top.length ? 34 : 12;
    // Room left of the box for the labels of legs that do not go to the ESP32
    const margin = Math.max(26, ...left.filter((l) => !l.n?.pad && joined(l.n)).map((l) => (l.n!.label ?? 'N00').length * 6.2 + 40));
    const item: Item = {
      width: margin + w + 20,
      height: above + boxH + (bottom.length ? 30 : 12),
      pads: left.flatMap((l, i) => (l.n?.pad ? [{ net: l.n.index, dy: above + first + i * PITCH, x: 0 }] : [])),
      draw: (x0, y0) => {
        const x = x0 + margin;
        const y = y0 + above;
        let s = `<rect class="sch-b" x="${x}" y="${y}" width="${w}" height="${boxH}"/>`;
        s += sch.text(x + w / 2, y + (top.length ? 28 : 14), esc(title), { cls: 'sch-strong', size: 10 });
        left.forEach((l, i) => {
          const py = y + first + i * PITCH;
          s += sch.text(x + 5, py + 3.5, esc(l.name), { anchor: 'start', cls: 'sch-m', size: 9.5 });
          // A pad leg is wired from the ESP32 to the box edge; the rest end in a label or ×
          s += l.n?.pad ? sch.wire([[x0, py], [x, py]]) : sch.wire([[x - 14, py], [x, py]]) + end(l.n, [x - 14, py], -1);
        });
        const across = (row: typeof top, py: number, dir: -1 | 1) =>
          row
            .map((l, i) => {
              const px = x + ((i + 1) * w) / (row.length + 1);
              return sch.text(px, dir < 0 ? py + 12 : py - 6, esc(l.name), { cls: 'sch-m', size: 9 }) + sch.wire([[px, py], [px, py + dir * 8]]) + end(l.n, [px, py + dir * 8], 1);
            })
            .join('');
        s += across(top, y, -1);
        s += across(bottom, y + boxH, 1);
        return `<g data-part="${part.id}">${s}</g>`;
      },
    };
    items.push({ order: parts.indexOf(part), item });
  }

  // In placing order, but anything sharing an ESP32 pin with an earlier item goes right after it
  items.sort((a, b) => a.order - b.order);
  const firstOnNet = new Map<number, number>();
  const group = new Map<Item, number>();
  for (const { order, item } of items) {
    const key = Math.min(order, ...item.pads.map((p) => firstOnNet.get(p.net) ?? order));
    for (const p of item.pads) if (!firstOnNet.has(p.net)) firstOnNet.set(p.net, key);
    group.set(item, key);
  }
  items.sort((a, b) => group.get(a.item)! - group.get(b.item)! || a.order - b.order);

  // --- Stack the items and line up the ESP32's pins with them ---------------------------------
  const pinY = new Map<number, number>();
  const taps = new Map<number, number[]>(); // y of every leg wired to each pad's net
  let lastPin = 14;
  let y = 0;
  const at: { item: Item; y: number }[] = [];
  for (const { item } of items) {
    // A new pin goes level with the leg it feeds, pushing the item down if pins are crowded
    const fresh = item.pads.find((p) => !pinY.has(p.net));
    if (fresh && lastPin + PITCH > y + fresh.dy) y = lastPin + PITCH - fresh.dy;
    for (const p of item.pads) {
      const ty = y + p.dy;
      if (!pinY.has(p.net)) {
        pinY.set(p.net, Math.max(ty, lastPin + PITCH));
        lastPin = pinY.get(p.net)!;
      }
      taps.set(p.net, [...(taps.get(p.net) ?? []), ty]);
    }
    at.push({ item, y });
    y += item.height + 8;
  }
  const flagged = [...labelledPads].filter((n) => !pinY.has(n));
  for (const n of flagged) pinY.set(n, (lastPin += PITCH));

  // Nets needing a vertical run (shared by several legs, or not level with their pin) get a lane
  const lanes = [...pinY.keys()].filter((n) => taps.has(n) && (taps.get(n)!.length > 1 || taps.get(n)![0] !== pinY.get(n)));
  const laneX = (n: number) => STUB + 12 + lanes.indexOf(n) * 10;
  const itemX = STUB + 30 + lanes.length * 10;

  let svg = '';
  const padNets = [...pinY.entries()].sort((a, b) => a[1] - b[1]);
  const espTop = 0;
  const espH = Math.max(48, lastPin + PITCH);
  const pins = padNets.map(([n, py]) => ({ name: nets.get(n)!.pad!, dy: py - espTop }));
  svg += sch.block(ESP_X, espTop, 'ESP32', pins, { chip: true, w: ESP_W, h: espH }).svg;
  for (const [n, py] of padNets) {
    const v = volts(nets.get(n)!);
    if (v) svg += sch.text(STUB + 2, py - 4, v, { anchor: 'start', cls: 'sch-volt', size: 8.5 });
    if (flagged.includes(n)) {
      svg += sch.wire([[STUB, py], [STUB + 8, py]]) + flag(STUB + 8, py, nets.get(n)!.pad!, 1);
      continue;
    }
    const ys = taps.get(n)!;
    if (!lanes.includes(n)) {
      svg += sch.wire([[STUB, py], [itemX, py]]);
      continue;
    }
    const lx = laneX(n);
    const lo = Math.min(py, ...ys);
    const hi = Math.max(py, ...ys);
    svg += sch.wire([[STUB, py], [lx, py]]) + sch.wire([[lx, lo], [lx, hi]]);
    for (const ty of ys) svg += sch.wire([[lx, ty], [itemX, ty]]);
    // Dots where wires meet as a T: mid-way down the lane, or where a wire runs straight across its end
    for (const ty of new Set([py, ...ys])) if ((ty > lo && ty < hi) || (ty === py && ys.includes(py))) svg += sch.dot(lx, ty);
  }
  let width = itemX;
  for (const { item, y: iy } of at) {
    svg += item.draw(itemX, iy);
    width = Math.max(width, itemX + item.width);
  }
  const height = Math.max(espH, y) + 10;
  return { svg, width: width + 40, height: height + 20, empty: parts.length === 0 };
}

/** Designators by part id: R1, R2…, LED1…, U1… in the order the parts were placed. */
export function designators(parts: readonly PartInstance[]): Map<string, string> {
  const refs = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const part of parts) {
    const letter = TWO_LEG[part.type]?.ref ?? BOX_REF[part.type] ?? 'U';
    refs.set(part.id, `${letter}${(counts[letter] = (counts[letter] ?? 0) + 1)}`);
  }
  return refs;
}

/** A net label: a small pennant pointing away from the wire, with the name in it. */
function flag(x: number, y: number, name: string, dir: -1 | 1): string {
  const w = name.length * 6.2 + 12;
  const tip = x + dir * w;
  const d = `M${x},${y} l${dir * 6},-7 H${tip} V${y + 7} H${x + dir * 6} Z`;
  return `<path class="sch-flag" d="${d}"/>${sch.text((x + dir * 6 + tip) / 2, y + 3.5, name, { cls: 'sch-s', size: 9.5 })}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
