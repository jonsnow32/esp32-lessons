<script lang="ts">
  // The workbench, in breadboard-pitch units.
  //
  // One pointer (mouse, pen or finger):
  //   on a part      → move it            on a hole / pin → draw a wire
  //   on empty space → pan                tap             → select (also a breadboard or the board)
  //   on the selected breadboard or board → move it
//   on a segment of the selected wire → slide it sideways
// A wire released over empty space is not dropped: it bends there, and the next press on a
// hole / pin ends it (Backspace takes the last bend back, Esc drops the wire).
  // Two fingers pinch to zoom and pan; the mouse wheel / trackpad pinch zooms at the cursor.
  // While a finger drags a part or wire, a loupe above the finger shows what is underneath.
  //
  // Drags are tracked on the window, not on the element where they started: on touch screens
  // the browser keeps sending a finger's events to its first target, so a drag from the parts
  // library would otherwise never reach the workbench. A breadboard dragged in from the library
  // arrives as dragType "bb:<type>".

  import type { Endpoint, Rotation } from '@esp32lab/project-model';
  import { ESP32_PADS } from '@esp32lab/mcu-esp32';
  import { PARTS } from '../lib/catalog';
  import { benchBounds, board, boardBox, breadboard, breadboardAt, breadboardBox, endpointAt, endpointPos, holePos, moveSegment, onBoard, onBreadboard, partAnchor, pinPos, routePath, sameEndpoint, snapCorner, terminalPos, wirePath, wireRoute, type Pt } from '../lib/geometry';
  import { SCENE_DEFS } from '../lib/scene';
  import { TIDY_MODES } from '../lib/tidy';
  import { endpointKey } from '@esp32lab/sim-core';
  import { lab } from '../lib/lab.svelte';
  import BoardView from './BoardView.svelte';
  import BreadboardView from './BreadboardView.svelte';

  let { dragType = $bindable<string | null>(null) } = $props();

  let svg: SVGSVGElement;
  let view = $state({ x: -5, y: -6, w: 54, h: 30 });
  let pointer = $state<Pt | null>(null);
  let pointerType = $state<string>('mouse');
  let hover = $state<Endpoint | null>(null);
  let wireFrom = $state<Endpoint | null>(null);
  /** Bends of the wire being drawn, where it was released over empty space. */
  let corners = $state<Pt[]>([]);
  /** A segment (index i of its route) of the selected wire being slid sideways. */
  let bending = $state<{ id: string; i: number; start: Pt; route: Pt[]; moved: boolean } | null>(null);
  let moving = $state<{ id: string; type: string; rot: Rotation; moved: boolean } | null>(null);
  /** Rotation of a new part being dragged in from the library (R while dragging turns it). */
  let dragRot = $state<Rotation>(0);
  /** Panning, and what a tap without moving selects (a breadboard id, 'board' or nothing). */
  let pan: { start: Pt; view: typeof view; moved: boolean; tapped?: string } | null = null;
  /** The selected breadboard (its id) or 'board' being dragged to another spot. */
  let shifting = $state<{ target: string; start: Pt; from: Pt; moved: boolean } | null>(null);
  let downAt: Pt | null = null;

  /** Active touch points on the workbench, for pinch. */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; mid: Pt; view: typeof view } | null = null;

  const TAP = 0.35;
  function toWorld(clientX: number, clientY: number): Pt {
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(clientX, clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  function inside(ev: PointerEvent): boolean {
    const r = svg.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }

  let dragging = $derived(!!dragType || !!moving || !!wireFrom || !!shifting || !!bending);

  /** Breadboard type being dragged in from the library, and where its a1 hole would go. */
  let bbGhost = $derived(
    dragType?.startsWith('bb:') && pointer ? { type: dragType.slice(3), at: { x: Math.round(pointer.x), y: Math.round(pointer.y) } } : null,
  );

  function positionOf(target: string): Pt | undefined {
    return target === 'board' ? lab.project.board : lab.project.breadboards.find((b) => b.id === target);
  }

  /**
   * Where a part being placed or moved would go: the hole under the pointer (its first leg), or,
   * away from the breadboard, a spot on the bench.
   */
  let ghost = $derived.by(() => {
    const type = dragType ?? moving?.type;
    if (!type || type.startsWith('bb:') || !pointer || (moving && !moving.moved)) return null;
    const e = endpointAt(lab.project, pointer);
    const rot = moving?.rot ?? dragRot;
    if (e?.kind === 'hole') {
      const ok = lab.canPlace(type, e.bb, e.hole, rot, moving?.id);
      return { type, at: holePos(lab.project, e.bb, e.hole)!, ok, hole: { bb: e.bb, hole: e.hole }, bench: false };
    }
    if (!e && !onBreadboard(lab.project, pointer)) {
      return { type, at: { x: Math.round(pointer.x), y: Math.round(pointer.y) }, ok: true, hole: null, bench: true };
    }
    return { type, at: pointer, ok: false, hole: null as null | { bb: string; hole: string }, bench: false };
  });

  let hoverNet = $derived(hover ? lab.netOf(hover) : new Set<string>());
  let hereHole = $derived(hover?.kind === 'hole' ? hover : null);

  // --- Pointer handling --------------------------------------------------------------------

  function onSvgDown(ev: PointerEvent) {
    pointerType = ev.pointerType;
    if (ev.pointerType === 'touch') {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        // Second finger: abandon whatever the first started and pinch instead
        wireFrom = null;
        corners = [];
        moving = null;
        pan = null;
        if (shifting?.moved) {
          lab.retidy();
          lab.commit();
        }
        shifting = null;
        startPinch();
        return;
      }
    }
    const p = toWorld(ev.clientX, ev.clientY);
    pointer = p;
    downAt = p;
    // A wire is being drawn: where this press is released, it ends or bends
    if (wireFrom) return;
    const e = endpointAt(lab.project, p);
    if (e) {
      wireFrom = e;
      return;
    }
    // The board is drawn over the breadboards
    const target = onBoard(lab.project, p) ? 'board' : breadboardAt(lab.project, p);
    const s = lab.selection;
    const selected = target && ((target === 'board' && s?.kind === 'board') || (s?.kind === 'breadboard' && s.id === target));
    if (selected) shifting = { target, start: p, from: { ...positionOf(target)! }, moved: false };
    else pan = { start: { x: ev.clientX, y: ev.clientY }, view: { ...view }, moved: false, tapped: target };
  }

  function startMove(ev: PointerEvent, id: string) {
    if (ev.pointerType === 'touch' && touches.size >= 1) return; // second finger of a pinch
    if (wireFrom) return; // a wire being drawn ends or bends over the part
    ev.stopPropagation();
    pointerType = ev.pointerType;
    if (ev.pointerType === 'touch') touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const part = lab.part(id);
    const rot = part?.placement?.rot ?? part?.bench?.rot;
    if (!part || rot === undefined) return;
    pointer = toWorld(ev.clientX, ev.clientY);
    downAt = pointer;
    moving = { id, type: part.type, rot, moved: false };
  }

  function startBend(ev: PointerEvent, id: string, i: number, route: Pt[]) {
    if (ev.pointerType === 'touch' && touches.size >= 1) return;
    ev.stopPropagation();
    pointerType = ev.pointerType;
    if (ev.pointerType === 'touch') touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    bending = { id, i, start: toWorld(ev.clientX, ev.clientY), route, moved: false };
  }

  function onWindowMove(ev: PointerEvent) {
    if (!svg) return;
    pointerType = ev.pointerType;
    if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && touches.size === 2) return updatePinch();
    const p = toWorld(ev.clientX, ev.clientY);
    if (pan) {
      const r = svg.getBoundingClientRect();
      const k = view.w / r.width;
      const dx = (ev.clientX - pan.start.x) * k;
      const dy = (ev.clientY - pan.start.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 0.2) pan.moved = true;
      view = { ...pan.view, x: pan.view.x - dx, y: pan.view.y - dy };
      return;
    }
    if (shifting) {
      // Whole pitches, so holes stay on the grid the parts snap to
      const x = shifting.from.x + Math.round(p.x - shifting.start.x);
      const y = shifting.from.y + Math.round(p.y - shifting.start.y);
      const at = positionOf(shifting.target);
      if (at && (at.x !== x || at.y !== y)) {
        at.x = x;
        at.y = y;
        shifting.moved = true;
      }
      return;
    }
    if (bending) {
      const { route, i, start } = bending;
      const horizontal = route[i]!.y === route[i + 1]!.y;
      // Half pitches, the grid wire corners snap to
      const d = Math.round((horizontal ? p.y - start.y : p.x - start.x) * 2) / 2;
      const w = lab.project.wires.find((q) => q.id === bending!.id);
      if (w && (d !== 0 || bending.moved)) {
        w.points = moveSegment(route, i, d);
        bending.moved = true;
      }
      return;
    }
    pointer = inside(ev) ? p : dragging ? p : null;
    hover = pointer ? endpointAt(lab.project, p) : null;
    if (moving && downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > TAP) moving.moved = true;
  }

  function onWindowUp(ev: PointerEvent) {
    touches.delete(ev.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      return;
    }
    if (!svg) return;
    const p = toWorld(ev.clientX, ev.clientY);
    const over = inside(ev);
    if (dragType) {
      if (over && bbGhost) lab.addBreadboard(bbGhost.type, bbGhost.at.x, bbGhost.at.y);
      else if (over && ghost?.ok && ghost.hole) lab.addPart(dragType, ghost.hole.bb, ghost.hole.hole, dragRot);
      else if (over && ghost?.bench) lab.addPartOnBench(dragType, ghost.at.x, ghost.at.y, dragRot);
      dragType = null;
      dragRot = 0;
    }
    if (moving) {
      if (moving.moved && ghost?.ok && ghost.hole) lab.movePart(moving.id, ghost.hole.bb, ghost.hole.hole, moving.rot);
      else if (moving.moved && over && ghost?.bench) lab.benchPart(moving.id, ghost.at.x, ghost.at.y, moving.rot);
      else if (!moving.moved) lab.selection = { kind: 'part', id: moving.id };
      moving = null;
    }
    if (wireFrom) {
      const to = over ? endpointAt(lab.project, p) : null;
      const corner = snapCorner(p);
      const last = corners[corners.length - 1];
      if (to && !sameEndpoint(to, wireFrom)) {
        lab.addWire(wireFrom, to, $state.snapshot(corners));
        wireFrom = null;
        corners = [];
      } else if (!over || to) {
        // Released off the bench or back on its start: no wire
        wireFrom = null;
        corners = [];
      } else if (!last || last.x !== corner.x || last.y !== corner.y) corners = [...corners, corner];
    }
    if (bending) {
      if (bending.moved) lab.commit();
      bending = null;
    }
    if (shifting) {
      // Wires follow in the tidy mode last chosen; one undo step with the move
      if (shifting.moved) {
        lab.retidy();
        lab.commit();
      }
      shifting = null;
    }
    if (pan) {
      if (!pan.moved) {
        const t = pan.tapped;
        lab.selection = t === 'board' ? { kind: 'board' } : t ? { kind: 'breadboard', id: t } : null;
      }
      pan = null;
    }
    // On touch, keep the last tapped point under the probe; just forget the pointer
    if (ev.pointerType === 'touch') pointer = null;
  }

  // --- Zoom ---------------------------------------------------------------------------------

  function zoomAt(world: Pt, factor: number) {
    const w = Math.min(160, Math.max(12, view.w * factor));
    const k = w / view.w;
    view = { x: world.x - (world.x - view.x) * k, y: world.y - (world.y - view.y) * k, w, h: view.h * k };
  }

  function onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const p = toWorld(ev.clientX, ev.clientY);
    // Trackpad pinch arrives as ctrl+wheel with small deltas
    zoomAt(p, Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
  }

  function touchPair() {
    const [a, b] = [...touches.values()];
    return { a: a!, b: b! };
  }

  function startPinch() {
    const { a, b } = touchPair();
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2),
      view: { ...view },
    };
  }

  function updatePinch() {
    if (!pinch) return;
    const { a, b } = touchPair();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const k = Math.min(160 / pinch.view.w, Math.max(12 / pinch.view.w, pinch.dist / Math.max(dist, 1)));
    // Keep the world point first under the fingers' midpoint under their current midpoint
    const r = svg.getBoundingClientRect();
    const w = pinch.view.w * k;
    const h = pinch.view.h * k;
    const mx = ((a.x + b.x) / 2 - r.left) / r.width;
    const my = ((a.y + b.y) / 2 - r.top) / r.height;
    view = { x: pinch.mid.x - mx * w, y: pinch.mid.y - my * h, w, h };
  }

  /** Keep a press's events on its element; harmless if the browser refuses. */
  function capture(e: PointerEvent) {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* pointer not active (synthetic event) */
    }
  }

  /** Tidy the wires in the next mode and say which one, for a moment. */
  let tidyNote = $state<string | null>(null);
  let tidyTimer: ReturnType<typeof setTimeout> | undefined;
  /** A wire for each tidy mode on the button: between the pins, over one, straight over all. */
  const TIDY_ICONS = ['M4 4V7H16V16', 'M4 4V10H16V16', 'M4 4V16H16'];
  /** The mode the tidy button applies next. */
  let next = $derived(TIDY_MODES[(lab.tidyMode + 1) % TIDY_MODES.length]!);
  function tidy() {
    lab.tidyWires();
    const m = TIDY_MODES[lab.tidyMode]!;
    tidyNote = `Dây: ${m.name} (${lab.tidyMode + 1}/${TIDY_MODES.length}) · ${m.hint}`;
    clearTimeout(tidyTimer);
    tidyTimer = setTimeout(() => (tidyNote = null), 2500);
  }

  /** Frame everything on the bench, keeping the workbench's aspect ratio. */
  function fit() {
    const r = svg.getBoundingClientRect();
    const k = benchBounds(lab.project, 2);
    const aspect = r.height / Math.max(1, r.width);
    const w = Math.min(160, Math.max(12, k.w, k.h / aspect));
    const h = w * aspect;
    view = { x: k.x + k.w / 2 - w / 2, y: k.y + k.h / 2 - h / 2, w, h };
  }

  function onKey(ev: KeyboardEvent) {
    // Keys typed in the code editor (contenteditable) or a form field are not bench commands
    if ((ev.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return;
    if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        ev.preventDefault();
        if (k === 'y' || ev.shiftKey) lab.redo();
        else lab.undo();
      }
      return;
    }
    if (wireFrom && ev.key === 'Backspace') corners = corners.slice(0, -1);
    else if (ev.key === 'Delete' || ev.key === 'Backspace') lab.deleteSelected();
    if (ev.key === 'r' || ev.key === 'R') {
      // While dragging, R turns the part in hand; otherwise the selected part
      const next = (r: Rotation) => ((r + 90) % 360) as Rotation;
      if (moving?.moved) moving = { ...moving, rot: next(moving.rot) };
      else if (dragType) dragRot = next(dragRot);
      else lab.rotateSelected();
    }
    if (ev.key === '+' || ev.key === '=') zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 0.8);
    if (ev.key === '-') zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 1.25);
    if (ev.key === '0') fit();
    if (ev.key === 'Escape') {
      dragType = null;
      dragRot = 0;
      wireFrom = null;
      corners = [];
      moving = null;
      lab.selection = null;
    }
  }

  // --- Drawing helpers --------------------------------------------------------------------------

  function partView(type: string, props: Record<string, unknown>, obs: Record<string, unknown>): string {
    const m = PARTS[type];
    if (!m?.view) return '';
    const full: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(m.manifest.props)) full[k] = props[k] ?? s.default;
    return m.view(full as never, obs as never);
  }

  function pinFill(pin: string): string {
    const pad = lab.padOfPin(pin);
    const o = pad ? lab.observables[`mcu.${pad}`] : undefined;
    if (o?.damaged) return '#000';
    if (o?.output === 'high') return '#ff5a4f';
    if (o?.output === 'low') return '#4f7bff';
    return 'url(#gold)';
  }

  function pinHint(pin: string): string {
    const pad = lab.padOfPin(pin);
    if (!pad) return pin;
    const c = ESP32_PADS[pad];
    return [pin, pad, c?.adc, c?.touch, c?.dac, c?.inputOnly ? 'input only' : '', c?.strapping ? 'strapping' : '', c?.note].filter(Boolean).join(' · ');
  }

  // --- Seeing the circuit: current dots, voltage colours, probe -----------------------------

  /** Where a netlist key is drawn, if it is something visible (hole, header pin, part leg). */
  function keyPos(key: string): Pt | undefined {
    const [kind, a, c] = key.split(':');
    if (kind === 'h') return holePos(lab.project, a!, c!);
    if (kind === 'bp') return pinPos(lab.project, a!);
    if (kind === 'p') {
      const part = lab.part(a!);
      return part ? terminalPos(lab.project, part, c!) : undefined;
    }
    return undefined;
  }

  /** 0 V blue → 3.3 V red → 5 V purple; floating grey. */
  function voltColor(v: number | null | undefined): string {
    if (v === null || v === undefined) return '#b9bbc6';
    if (v > 3.6) return '#8e4ec6';
    const t = Math.max(0, Math.min(1, v / 3.3));
    const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `rgb(${mix(62, 229)},${mix(99, 72)},${mix(221, 77)})`;
  }

  function fmtV(v: number | null | undefined): string {
    return v === null || v === undefined ? 'thả nổi (không xác định)' : `${v.toFixed(2).replace('.', ',')} V`;
  }
  function fmtA(i: number): string {
    const a = Math.abs(i);
    return a >= 1e-3 ? `${(a * 1000).toFixed(2).replace('.', ',')} mA` : `${(a * 1e6).toFixed(0)} µA`;
  }

  /** Dot speed grows with log(current): 1 µA crawls, 10 mA races. */
  function flowDuration(amps: number): number {
    const speed = 1 + 2 * Math.log10(Math.max(1, Math.abs(amps) / 1e-6)); // pitches / s
    return 0.62 / speed;
  }

  interface Stream { d: string; dur: number; key: string }

  /** Animated current paths: wires, strip segments, internal shorts and through parts. */
  let streams = $derived.by((): Stream[] => {
    if (lab.overlay !== 'current') return [];
    const out: Stream[] = [];
    for (const f of lab.flows) {
      const [from, to] = f.amps > 0 ? [f.a, f.b] : [f.b, f.a];
      const pa = keyPos(from);
      const pb = keyPos(to);
      if (!pa || !pb || (pa.x === pb.x && pa.y === pb.y)) continue;
      const w = f.kind === 'wire' ? lab.project.wires.find((q) => q.id === f.id) : undefined;
      // Along the wire's bends, from the end the current enters
      const route = w && (from === endpointKey(w.a) ? wireRoute(pa, pb, w.points) : wireRoute(pb, pa, w.points).reverse());
      const d = route ? routePath(route) : `M${pa.x},${pa.y} L${pb.x},${pb.y}`;
      out.push({ d, dur: flowDuration(f.amps), key: `${f.kind}:${f.id ?? ''}:${f.a}:${f.b}` });
    }
    // Through two-terminal parts and closed switches: from the terminal current enters to the
    // one it leaves
    for (const part of lab.project.parts) {
      const c = lab.terminalCurrents[part.id];
      if (!c) continue;
      const enter = Object.entries(c).filter(([, i]) => i > 1e-6).sort((x, y) => y[1] - x[1])[0];
      const leave = Object.entries(c).filter(([, i]) => i < -1e-6).sort((x, y) => x[1] - y[1])[0];
      if (!enter || !leave) continue;
      const pa = terminalPos(lab.project, part, enter[0]);
      const pb = terminalPos(lab.project, part, leave[0]);
      if (!pa || !pb) continue;
      out.push({ d: `M${pa.x},${pa.y} L${pb.x},${pb.y}`, dur: flowDuration(enter[1]), key: `part:${part.id}` });
    }
    return out;
  });

  /** Highlight for a hovered explanation: its parts and the nets of its keys. */
  let emphasisNet = $derived.by(() => {
    const keys = new Set<string>();
    for (const k of lab.emphasis) if (k.includes(':')) for (const x of lab.netOfKey(k)) keys.add(x);
    return keys;
  });

  function holeFill(key: string): string | null {
    if (emphasisNet.has(key)) return '#f5a524';
    if (lab.overlay !== 'voltage') return null;
    const v = lab.voltages[key];
    return v === undefined || v === null ? null : voltColor(v);
  }

  /** Each part's drawn body, measured to fit the dashed outline around the selected one. */
  const bodies: Record<string, SVGGElement> = {};
  /** Size a rect to hug the body's box (in the part's own, unrotated units), with a little margin. */
  function hug(rect: SVGRectElement, body: SVGGraphicsElement | undefined) {
    const fit = (el: SVGGraphicsElement | undefined) => {
      if (!el) return;
      const b = el.getBBox();
      const m = 0.25;
      rect.setAttribute('x', String(b.x - m));
      rect.setAttribute('y', String(b.y - m));
      rect.setAttribute('width', String(b.width + 2 * m));
      rect.setAttribute('height', String(b.height + 2 * m));
    };
    fit(body);
    return { update: fit };
  }

  let hoverPart = $state<string | null>(null);
  let hoverWire = $state<string | null>(null);

  /** What the probe chip says about whatever is under the pointer (or was last tapped). */
  let probe = $derived.by((): string | null => {
    if (wireFrom && corners.length && !hover) return 'Bấm lỗ / chân để nối · chỗ trống để gấp góc · Backspace bỏ góc · Esc huỷ';
    if (hoverPart) {
      const part = lab.part(hoverPart);
      const o = lab.observables[hoverPart] ?? {};
      const c = lab.terminalCurrents[hoverPart] ?? {};
      const i = Math.max(0, ...Object.values(c));
      const bits = [`${hoverPart}: ${fmtA(i)}`];
      if (part) {
        const terms = Object.keys(c);
        if (terms.length === 2) {
          const [t1, t2] = terms as [string, string];
          const v1 = lab.voltages[`p:${part.id}:${t1}`];
          const v2 = lab.voltages[`p:${part.id}:${t2}`];
          if (v1 != null && v2 != null) bits.push(`chênh ${Math.abs(v1 - v2).toFixed(2).replace('.', ',')} V`);
        }
      }
      if (typeof o.brightness === 'number') bits.push(`sáng ${Math.round(o.brightness * 100)}%`);
      if (o.pressed === true) bits.push('đang nhấn');
      return bits.join(' · ');
    }
    if (hoverWire) {
      const f = lab.flows.find((x) => x.kind === 'wire' && x.id === hoverWire);
      const w = lab.project.wires.find((x) => x.id === hoverWire);
      const v = w ? lab.voltages[endpointKey(w.a)] : undefined;
      return `Dây: ${fmtV(v)} · ${f ? fmtA(f.amps) : 'không có dòng'}`;
    }
    if (hover) {
      const key = endpointKey(hover);
      const net = lab.netOf(hover);
      const pinOnNet = [...net].find((k) => k.startsWith('bp:'));
      const where = hover.kind === 'board' ? hover.pin.replace(/\.[LR]\d*$/, '') : hover.kind === 'hole' ? `Lỗ ${hover.hole}` : key;
      const tail = pinOnNet && pinOnNet !== key ? ` · cùng mạch với ${pinOnNet.slice(3).replace(/\.[LR]\d*$/, '')}` : '';
      return `${where}: ${fmtV(lab.voltages[key])}${tail}`;
    }
    return null;
  });

  let b = $derived(board(lab.project));
  /** Loupe: shown above a finger that is dragging, magnifying what it covers. */
  let loupe = $derived(pointerType === 'touch' && dragging && pointer ? pointer : null);
  const LOUPE_R = 3.2;
  const LOUPE_ZOOM = 2.2;
</script>

<svelte:window onkeydown={onKey} onpointermove={onWindowMove} onpointerup={onWindowUp} onpointercancel={onWindowUp} />

<div class="wrap">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg bind:this={svg} class="bench" class:grabbing={!!pan} viewBox="{view.x} {view.y} {view.w} {view.h}"
    onpointerdown={onSvgDown} onwheel={onWheel} onpointerleave={() => pointerType !== 'touch' && !dragging && (hover = null)}>
    <defs>
      {@html SCENE_DEFS}
      <filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0.15" dy="0.25" stdDeviation="0.2" flood-opacity="0.35" /></filter>
      <clipPath id="loupe-clip"><circle r={LOUPE_R} /></clipPath>
    </defs>

    <g id="scene">
      {#each lab.project.breadboards as inst (inst.id)}
        {@const bb = breadboard(inst.type)}
        {#if bb}
          <g transform="translate({inst.x},{inst.y})">
            <BreadboardView id={inst.id} {bb} net={hoverNet} here={hereHole && hereHole.bb === inst.id ? hereHole.hole : null} fillFor={holeFill} />
          </g>
        {/if}
      {/each}

      {#if bbGhost}
        {@const bb = breadboard(bbGhost.type)}
        {#if bb}
          <g transform="translate({bbGhost.at.x},{bbGhost.at.y})" opacity="0.6" pointer-events="none">
            <BreadboardView id="ghost" {bb} net={new Set()} here={null} />
          </g>
        {/if}
      {/if}

      <g transform="translate({lab.project.board.x},{lab.project.board.y})" filter="url(#lift)">
        <BoardView board={b} net={hoverNet} observables={lab.observables} {pinFill} {pinHint}
          onpress={(id) => lab.press(id)} onrelease={(id) => lab.release(id)} />
      </g>

      <!-- Selected breadboard or board: drag it to move it -->
      {#if lab.selection?.kind === 'board' || lab.selection?.kind === 'breadboard'}
        {@const sel = lab.selection}
        {@const inst = sel.kind === 'breadboard' ? lab.project.breadboards.find((q) => q.id === sel.id) : undefined}
        {@const at = sel.kind === 'board' ? lab.project.board : inst}
        {@const box = sel.kind === 'board' ? boardBox(b) : inst && breadboardBox(inst.type)}
        {#if at && box}
          <rect x={at.x + box.x - 0.3} y={at.y + box.y - 0.3} width={box.w + 0.6} height={box.h + 0.6} rx="0.8"
            class="outline" class:moving={!!shifting} pointer-events="none" />
        {/if}
      {/if}

      {#each lab.project.parts as part (part.id)}
        {@const anchor = partAnchor(lab.project, part)}
        {#if anchor}
          {@const at = anchor.at}
          {@const rot = anchor.rot}
          <!-- While moving, the part is hidden but stays in the DOM: on touch screens the finger's
               events keep going to the element the drag started on -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g transform="translate({at.x},{at.y}) rotate({rot})" class="part" filter="url(#lift)"
            opacity={moving?.id === part.id && moving.moved ? 0 : 1}
            class:selected={lab.selection?.kind === 'part' && lab.selection.id === part.id}
            class:emph={lab.emphasis.includes(part.id)}
            onpointerenter={() => (hoverPart = part.id)} onpointerleave={() => (hoverPart = null)}
            onpointerdown={(e) => { hoverPart = part.id; startMove(e, part.id); }}>
            <g bind:this={bodies[part.id]}>{@html partView(part.type, part.props ?? {}, lab.observables[part.id] ?? {})}</g>
          </g>
          {#if lab.selection?.kind === 'part' && lab.selection.id === part.id && !(moving?.id === part.id && moving.moved)}
            <g transform="translate({at.x},{at.y}) rotate({rot})" pointer-events="none">
              {#key part.props}<rect rx="0.4" class="outline" use:hug={bodies[part.id]} />{/key}
            </g>
          {/if}
          {@const ctls = [PARTS[part.type]?.control ?? []].flat()}
          {#if ctls.length}
            <!-- The part's controls (button cap, switch lever, keypad keys) act on it; the rest of the body drags it -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <g transform="translate({at.x},{at.y}) rotate({rot})">
              {#each ctls as ctl, i (i)}
                {#if ctl.kind === 'press'}
                  <circle cx={ctl.cx} cy={ctl.cy} r={ctl.r} fill="transparent" class="press"
                    onpointerdown={(e) => { e.stopPropagation(); capture(e); lab.press(part.id, ctl.key); }}
                    onpointerup={(e) => { e.stopPropagation(); lab.release(part.id, ctl.key); }}
                    onpointercancel={() => lab.release(part.id, ctl.key)} />
                {:else}
                  <circle cx={ctl.cx} cy={ctl.cy} r={ctl.r} fill="transparent" class="press"
                    onpointerdown={(e) => { e.stopPropagation(); lab.toggleProp(part.id, ctl.prop); }} />
                {/if}
              {/each}
            </g>
          {/if}
        {/if}
      {/each}

      {#each lab.project.wires as w (w.id)}
        {@const a = endpointPos(lab.project, w.a)}
        {@const z = endpointPos(lab.project, w.b)}
        {#if a && z}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g class="wire" class:selected={lab.selection?.kind === 'wire' && lab.selection.id === w.id}
            onpointerenter={() => (hoverWire = w.id)} onpointerleave={() => (hoverWire = null)}
            onpointerdown={(e) => {
              if (wireFrom) return; // the wire being drawn bends or ends here
              hoverWire = w.id;
              lab.selection = { kind: 'wire', id: w.id };
              // On a hole / pin under the wire's end: let the svg start another wire from it
              if (!endpointAt(lab.project, toWorld(e.clientX, e.clientY))) e.stopPropagation();
            }}>
            <!-- Wide transparent stroke: easy to tap -->
            <path d={wirePath(a, z, w.points)} stroke="transparent" stroke-width="1" fill="none" />
            <path d={wirePath(a, z, w.points)} stroke="#00000045" stroke-width="0.44" fill="none" stroke-linecap="round" transform="translate(0.06,0.1)" />
            <path d={wirePath(a, z, w.points)} stroke={w.color} stroke-width="0.3" fill="none" stroke-linecap="round" />
            <path d={wirePath(a, z, w.points)} stroke="#ffffff" stroke-opacity="0.3" stroke-width="0.08" fill="none" stroke-linecap="round" transform="translate(-0.04,-0.06)" />
            {#if lab.overlay === 'voltage'}
              <path d={wirePath(a, z, w.points)} stroke={voltColor(lab.voltages[endpointKey(w.a)])} stroke-width="0.14" fill="none" stroke-linecap="round" />
            {/if}
            {#each [a, z] as p}<rect x={p.x - 0.18} y={p.y - 0.18} width="0.36" height="0.36" rx="0.06" fill="#3a3d42" />{/each}
          </g>
        {/if}
      {/each}

      <!-- Selected wire: a grip on every segment slides it sideways (the ends stay free to start
           another wire from) -->
      {#if lab.selection?.kind === 'wire' && !wireFrom}
        {@const sel = lab.selection}
        {@const w = lab.project.wires.find((q) => q.id === sel.id)}
        {@const a = w && endpointPos(lab.project, w.a)}
        {@const z = w && endpointPos(lab.project, w.b)}
        {#if w && a && z}
          {@const route = wireRoute(a, z, w.points)}
          {#each route.slice(1) as q, i}
            {@const p = route[i]!}
            {@const horizontal = p.y === q.y}
            {@const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)}
            {#if len > 0.8}
              {@const k = 0.4 / len}
              {@const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <g class="wire-seg" class:h={horizontal} onpointerdown={(e) => startBend(e, w.id, i, route)}>
                <line x1={p.x + (q.x - p.x) * k} y1={p.y + (q.y - p.y) * k} x2={q.x - (q.x - p.x) * k} y2={q.y - (q.y - p.y) * k} stroke="transparent" stroke-width="0.8" />
                <rect x={m.x - (horizontal ? 0.45 : 0.16)} y={m.y - (horizontal ? 0.16 : 0.45)} width={horizontal ? 0.9 : 0.32} height={horizontal ? 0.32 : 0.9} rx="0.16" class="grip" />
              </g>
            {/if}
          {/each}
        {/if}
      {/if}

      <!-- Legs of parts on the bench: drag from one to run a wire (the svg handler finds the leg) -->
      {#each lab.project.parts.filter((q) => !q.placement && q.bench) as part (part.id)}
        {#each PARTS[part.type]?.manifest.terminals ?? [] as t (t.name)}
          {@const p = terminalPos(lab.project, part, t.name)}
          {#if p}
            <circle cx={p.x} cy={p.y} r="0.3" class="leg" class:on={hoverNet.has(`p:${part.id}:${t.name}`)}><title>{t.label ?? t.name}</title></circle>
          {/if}
        {/each}
      {/each}

      <!-- Current: dots moving from + to − along every conductor that carries current -->
      <g class="streams" pointer-events="none">
        {#each streams as st (st.key)}
          <path d={st.d} class="stream-glow" />
          <!-- Dark rim under a bright core: readable on every wire colour -->
          <path d={st.d} class="stream rim" style="animation-duration: {st.dur}s" />
          <path d={st.d} class="stream" style="animation-duration: {st.dur}s" />
        {/each}
      </g>

      {#if wireFrom && pointer}
        {@const a = endpointPos(lab.project, wireFrom)}
        {@const end = (hover && endpointPos(lab.project, hover)) || pointer}
        {#if a}<path d={wirePath(a, end, corners)} stroke="#f76b15" stroke-width="0.26" fill="none" stroke-dasharray="0.5 0.3" stroke-linecap="round" />{/if}
      {/if}

      {#if ghost}
        <g transform="translate({ghost.at.x},{ghost.at.y}) rotate({moving?.rot ?? dragRot})" opacity="0.8" class:bad={!ghost.ok} pointer-events="none">
          {@html partView(ghost.type, moving ? (lab.part(moving.id)?.props ?? {}) : {}, {})}
        </g>
      {/if}
    </g>

    {#if loupe}
      <!-- Magnified copy of the scene around the finger, drawn above it -->
      <g transform="translate({loupe.x},{loupe.y - LOUPE_R - 1.6})" pointer-events="none">
        <circle r={LOUPE_R + 0.15} fill="#fff" stroke="#f76b15" stroke-width="0.12" />
        <g clip-path="url(#loupe-clip)">
          <use href="#scene" transform="scale({LOUPE_ZOOM}) translate({-loupe.x},{-loupe.y})" />
        </g>
        <circle r="0.25" fill="none" stroke="#f76b15" stroke-width="0.06" />
      </g>
    {/if}
  </svg>

  <div class="overlay-bar">
    <div class="seg" role="group" aria-label="Hiển thị">
      <button class:on={lab.overlay === 'current'} onclick={() => (lab.overlay = 'current')}>Dòng điện</button>
      <button class:on={lab.overlay === 'voltage'} onclick={() => (lab.overlay = 'voltage')}>Điện áp</button>
      <button class:on={lab.overlay === 'off'} onclick={() => (lab.overlay = 'off')}>Tắt</button>
    </div>
    {#if lab.overlay === 'current'}
      <div class="legend"><span class="dot"></span> chấm chạy theo chiều dòng điện, từ + về − (GND). Càng nhanh = dòng càng lớn.</div>
    {:else if lab.overlay === 'voltage'}
      <div class="legend"><span class="scale"></span> 0 V → 3,3 V · <span class="chip" style="background:#8e4ec6"></span> 5 V · <span class="chip" style="background:#b9bbc6"></span> thả nổi</div>
    {/if}
  </div>

  {#if probe}
    <div class="probe" class:touch={pointerType === 'touch'}>🔎 {probe}</div>
  {/if}

  <div class="zoom">
    <button onclick={() => zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 0.8)} aria-label="Phóng to">+</button>
    <button onclick={() => zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 1.25)} aria-label="Thu nhỏ">−</button>
    <button onclick={fit} aria-label="Vừa màn hình">⤢</button>
    <div class="tidy">
      <button onclick={tidy} disabled={!lab.project.wires.length} aria-label="Sắp xếp lại dây: {next.name}"
        title="Sắp xếp lại dây: {next.name} ({next.hint}). Bấm tiếp để đổi kiểu.">
        <!-- The mode next in turn: pins as dots, a wire around or over them -->
        <svg viewBox="0 0 20 20" width="20" height="20">
          {#each [[4, 4], [10, 4], [16, 4], [10, 10], [4, 16], [10, 16], [16, 16]] as [x, y]}<circle cx={x} cy={y} r="1.3" fill="currentColor" opacity="0.45" />{/each}
          <path d={TIDY_ICONS[TIDY_MODES.indexOf(next)]} fill="none" stroke="#f76b15" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if tidyNote}<div class="tidy-note" role="status">{tidyNote}</div>{/if}
    </div>
    <button onclick={() => lab.undo()} disabled={!lab.canUndo} aria-label="Hoàn tác (Ctrl+Z)" title="Hoàn tác (Ctrl+Z)">↶</button>
    <button onclick={() => lab.redo()} disabled={!lab.canRedo} aria-label="Làm lại (Ctrl+Y)" title="Làm lại (Ctrl+Y / Ctrl+Shift+Z)">↷</button>
  </div>
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .bench {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at 50% 40%, #f5f6f3, var(--bg));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: default;
  }
  .bench.grabbing {
    cursor: grabbing;
  }
  .part {
    cursor: grab;
  }
    .press {
    cursor: pointer;
  }
  .outline {
    fill: none;
    stroke: var(--accent-hi);
    stroke-width: 0.14;
    stroke-dasharray: 0.6 0.35;
    animation: march 0.6s linear infinite;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -0.95;
    }
  }
  .outline.moving {
    fill: #f76b1510;
  }
  .wire {
    cursor: pointer;
  }
  .tidy {
    position: relative;
  }
  .tidy-note {
    position: absolute;
    right: 48px;
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    font: 12px var(--font-mono);
    padding: 6px 10px;
    background: var(--bezel);
    color: var(--ink-inv);
    border: 1px solid var(--bezel-line);
    box-shadow: var(--shadow-float);
    pointer-events: none;
  }
  .wire-seg {
    cursor: ew-resize;
  }
  .wire-seg.h {
    cursor: ns-resize;
  }
  .grip {
    fill: #fff;
    stroke: var(--accent-hi);
    stroke-width: 0.1;
  }
  .wire.selected path:nth-child(3) {
    stroke-dasharray: 0.6 0.3;
    animation: march-wire 0.6s linear infinite;
  }
  @keyframes march-wire {
    to {
      stroke-dashoffset: -0.9;
    }
  }
  .bad {
    filter: grayscale(1) opacity(0.55);
  }
  .stream {
    fill: none;
    stroke: #fff6c2;
    stroke-width: 0.2;
    stroke-linecap: round;
    stroke-dasharray: 0.02 0.6;
    animation: flow linear infinite;
  }
  .stream.rim {
    stroke: #3b2a00;
    stroke-opacity: 0.75;
    stroke-width: 0.32;
  }
  .stream-glow {
    fill: none;
    stroke: #ffd43b;
    stroke-opacity: 0.18;
    stroke-width: 0.34;
    stroke-linecap: round;
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -0.62;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .outline,
    .wire.selected path:nth-child(3) {
      animation: none;
    }
    .stream {
      animation: none;
      stroke-dasharray: none;
      stroke-opacity: 0.7;
    }
  }
  .part.emph {
    filter: drop-shadow(0 0 0.35px #f5a524) drop-shadow(0 0 0.35px #f5a524) drop-shadow(0 0 0.35px #f5a524);
  }
  .overlay-bar {
    position: absolute;
    left: 12px;
    top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }
  .seg {
    display: inline-flex;
    pointer-events: auto;
    box-shadow: var(--shadow-float);
    border-radius: 0;
    width: max-content;
  }
  .seg button {
    border-radius: 0;
    margin-left: -1px;
  }
  .seg button:first-child {
    border-radius: 0;
  }
  .seg button:last-child {
    border-radius: 0;
  }
  .seg button {
    font: 600 11.5px var(--font-mono);
    letter-spacing: .02em;
  }
  .seg button.on {
    background: var(--bezel);
    color: var(--ink-inv);
    border-color: var(--bezel);
    box-shadow: inset 0 -2px 0 var(--accent-hi);
  }
  .legend {
    font-size: 12px;
    color: var(--ink-2);
    background: #ffffffe6;
    border: 1px solid var(--line);
    padding: 4px 8px;
    border-radius: 0;
    max-width: 330px;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 0;
    background: #ffd43b;
    box-shadow: 0 0 4px #f5a524;
  }
  .scale {
    display: inline-block;
    width: 48px;
    height: 8px;
    border-radius: 0;
    background: linear-gradient(90deg, #3e63dd, #e5484d);
  }
  .chip {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 0;
  }
  .probe {
    position: absolute;
    left: 12px;
    bottom: 12px;
    background: var(--bezel);
    color: #9ee6bd;
    font: 13px var(--font-mono);
    font-variant-numeric: tabular-nums;
    padding: 6px 10px;
    border: 1px solid var(--bezel-line);
    border-radius: 0;
    box-shadow: var(--shadow-float);
    pointer-events: none;
    max-width: calc(100% - 90px);
  }
  .leg {
    fill: #ffffff01;
    stroke: var(--accent-hi);
    stroke-width: 0;
    cursor: crosshair;
  }
  .leg:hover,
  .leg.on {
    stroke-width: 0.1;
  }
  .zoom {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .zoom button {
    width: 40px;
    height: 40px;
    font-size: 18px;
    border-radius: 0;
    box-shadow: var(--shadow-float);
  }
</style>
