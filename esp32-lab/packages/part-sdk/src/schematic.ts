// Schematic symbols for the parts' detail pages, as SVG strings in plain pixel units. Colours
// come from classes the page styles (sch-w wire, sch-b body, sch-t text, sch-m muted text,
// sch-a accent, sch-s signal), so every drawing follows the app theme.

type Pt = [number, number];

const f = (n: number) => +n.toFixed(2);

/** A polyline wire through the points; `cls` adds e.g. sch-s for a signal line. */
export function wire(points: Pt[], cls = ''): string {
  return `<polyline class="sch-w ${cls}" points="${points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>`;
}

/** Junction dot where wires join. */
export function dot(x: number, y: number): string {
  return `<circle class="sch-dot" cx="${x}" cy="${y}" r="2.6"/>`;
}

export function text(x: number, y: number, s: string, opts: { anchor?: 'start' | 'middle' | 'end'; cls?: string; size?: number } = {}): string {
  const size = opts.size ? ` font-size="${opts.size}"` : '';
  return `<text class="sch-t ${opts.cls ?? ''}" x="${f(x)}" y="${f(y)}" text-anchor="${opts.anchor ?? 'middle'}"${size}>${s}</text>`;
}

/** Ground symbol hanging below (x, y). */
export function gnd(x: number, y: number): string {
  return `${wire([[x, y], [x, y + 8]])}<path class="sch-w" d="M${x - 9},${y + 8} H${x + 9} M${x - 5.5},${y + 12} H${x + 5.5} M${x - 2},${y + 16} H${x + 2}"/>`;
}

/** Supply rail above (x, y): a bar with its name, e.g. "3V3". */
export function supply(x: number, y: number, name: string): string {
  return `${wire([[x, y], [x, y - 10]])}<path class="sch-w" d="M${x - 8},${y - 10} H${x + 8}"/>${text(x, y - 15, name, { cls: 'sch-a' })}`;
}

/**
 * Draws `body` (local coordinates: the element runs along +x from 0 to its length, centred on
 * y = 0) between two points, with lead wires filling the gap either side of a `size` long body.
 * The label sits beside the middle, upright whatever the direction.
 */
function along(a: Pt, b: Pt, size: number, body: string, label?: string, sub?: string): string {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy);
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const s = (len - size) / 2;
  const leads = `<path class="sch-w" d="M0,0 H${f(s)} M${f(s + size)},0 H${f(len)}"/>`;
  const g = `<g transform="translate(${f(a[0])} ${f(a[1])}) rotate(${f(deg)})">${leads}<g transform="translate(${f(s)} 0)">${body}</g></g>`;
  if (!label) return g;
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const vertical = Math.abs(dy) > Math.abs(dx);
  const lines = vertical
    ? text(mx + 14, my + (sub ? -2 : 4), label, { anchor: 'start' }) + (sub ? text(mx + 14, my + 11, sub, { anchor: 'start', cls: 'sch-m' }) : '')
    : text(mx, my - 13, label) + (sub ? text(mx, my + 22, sub, { cls: 'sch-m' }) : '');
  return g + lines;
}

/** Resistor (zigzag). */
export function resistor(a: Pt, b: Pt, label?: string, sub?: string): string {
  const zig = [0, 3, 9, 15, 21, 27, 33, 36].map((x, i) => `${x},${i === 0 || i === 7 ? 0 : i % 2 ? -6 : 6}`).join(' ');
  return along(a, b, 36, `<polyline class="sch-w" points="${zig}"/>`, label, sub);
}

/** Resistor with a wiper arrow: potentiometer, or with `kind` an LDR / thermistor marking. */
export function variable(a: Pt, b: Pt, kind: 'light' | 'heat' | 'adjust', label?: string, sub?: string): string {
  const box = `<rect class="sch-b" x="0" y="-6" width="36" height="12"/>`;
  const mark =
    kind === 'light'
      ? `<path class="sch-w sch-a" d="M6,-24 L14,-12 M14,-24 L22,-12"/><path class="sch-a-fill" d="M14,-12 l-5,-2 l3,-3 Z M22,-12 l-5,-2 l3,-3 Z"/>`
      : kind === 'heat'
        ? `<path class="sch-w" d="M-2,12 L6,12 L30,-12"/>${text(34, -12, 't°', { anchor: 'start', size: 9 })}`
        : `<path class="sch-w" d="M2,12 L34,-12"/><path class="sch-b-ink" d="M34,-12 l-7,1 l3,4 Z"/>`;
  return along(a, b, 36, box + mark, label, sub);
}

/** Diode from anode a to cathode b; `led` adds the two light arrows. */
export function diode(a: Pt, b: Pt, opts: { led?: boolean; color?: string; label?: string; sub?: string } = {}): string {
  const fill = opts.color ? ` style="fill:${opts.color}"` : '';
  const arrows = opts.led
    ? `<path class="sch-w sch-a" d="M10,-12 L18,-22 M17,-9 L25,-19"/><path class="sch-a-fill" d="M18,-22 l-5,2 l2,2.5 Z M25,-19 l-5,2 l2,2.5 Z"/>`
    : '';
  return along(a, b, 18, `<path class="sch-b"${fill} d="M0,-8 L16,0 L0,8 Z"/><path class="sch-w" d="M17,-8 V8"/>${arrows}`, opts.label, opts.sub);
}

/** Single-pole switch between a and b: open (lever up) or closed. */
export function switchSym(a: Pt, b: Pt, closed: boolean, label?: string, sub?: string): string {
  const lever = closed ? `<path class="sch-w" d="M2,0 L28,0"/>` : `<path class="sch-w" d="M2,0 L26,-12"/>`;
  return along(a, b, 30, `<circle class="sch-b" cx="2" cy="0" r="2.2"/><circle class="sch-b" cx="28" cy="0" r="2.2"/>${lever}`, label, sub);
}

/** Buzzer: a speaker-ish box with sound lines, + side at a. */
export function buzzer(a: Pt, b: Pt, label?: string): string {
  return along(a, b, 26, `<rect class="sch-b" x="0" y="-9" width="26" height="18"/>${text(5, -12, '+', { size: 10 })}<path class="sch-w sch-a" d="M9,-5 Q13,0 9,5 M14,-8 Q20,0 14,8"/>`, label);
}

export interface BlockPin {
  name: string;
  /** Offset down the block's edge. */
  dy: number;
}

/**
 * A labelled block with pins down one edge (right for the ESP32, left for a module), e.g.
 * block(10, 20, 'ESP32', [{ name: 'GPIO2', dy: 30 }]). Returns the drawing and each pin's end.
 */
export function block(x: number, y: number, title: string, pins: BlockPin[], opts: { side?: 'left' | 'right'; w?: number; h?: number; chip?: boolean } = {}): { svg: string; pin: Record<string, Pt> } {
  const side = opts.side ?? 'right';
  const w = opts.w ?? 74;
  const h = opts.h ?? Math.max(40, Math.max(...pins.map((p) => p.dy)) + 18);
  const edge = side === 'right' ? x + w : x;
  const out = side === 'right' ? 12 : -12;
  const pin: Record<string, Pt> = {};
  let svg = `<rect class="sch-b ${opts.chip ? 'sch-chip' : ''}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  svg += text(x + w / 2, y + 14, title, { cls: opts.chip ? 'sch-chip-t' : 'sch-strong' });
  for (const p of pins) {
    const py = y + p.dy;
    svg += wire([[edge, py], [edge + out, py]]);
    svg += text(side === 'right' ? edge - 5 : edge + 5, py + 3.5, p.name, { anchor: side === 'right' ? 'end' : 'start', cls: opts.chip ? 'sch-chip-t' : 'sch-m', size: 9.5 });
    pin[p.name] = [edge + out, py];
  }
  return { svg, pin };
}

/** The ESP32 as a dark block with the given GPIO / power pins on its right edge. */
export function esp32(x: number, y: number, pins: BlockPin[], h?: number) {
  return block(x, y, 'ESP32', pins, { chip: true, h });
}

/** A label with a thin leader line from the thing it names (`from`) to the text (`to`). */
export function callout(from: Pt, to: Pt, label: string, anchor: 'start' | 'end' = 'start'): string {
  const tx = to[0] + (anchor === 'start' ? 4 : -4);
  return `<polyline class="sch-lead" points="${from.join(',')} ${to.join(',')}"/><circle class="sch-lead-dot" cx="${from[0]}" cy="${from[1]}" r="1.8"/>${text(tx, to[1] + 3.5, label, { anchor, cls: 'sch-ui', size: 10.5 })}`;
}

/** Signal-coloured arrow from a to b, e.g. the direction current flows; label beside its middle. */
export function flow(a: Pt, b: Pt, label?: string, cls = 'sch-s'): string {
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const head = `<path class="sch-head ${cls}" transform="translate(${b[0]} ${b[1]}) rotate(${f(deg)})" d="M0,0 L-8,-4 L-8,4 Z"/>`;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const t = label ? text(mid[0], mid[1] - 7, label, { cls }) : '';
  return `<polyline class="sch-w ${cls} sch-flow" points="${a.join(',')} ${b.join(',')}"/>${head}${t}`;
}

/** A number with a Vietnamese decimal comma and at most `digits` decimals, e.g. 6,8. */
export function num(n: number, digits = 1): string {
  return String(+n.toFixed(digits)).replace('.', ',');
}

/** 220 Ω, 4,7 kΩ, 1 MΩ. */
export function ohm(r: number): string {
  return r >= 1e6 ? `${num(r / 1e6, 2)} MΩ` : r >= 1e3 ? `${num(r / 1e3, 2)} kΩ` : `${num(r, 0)} Ω`;
}
