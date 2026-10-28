<script lang="ts">
  // The workbench, in breadboard-pitch units.
  //
  // One pointer (mouse, pen or finger):
  //   on a part      → move it            on a hole / pin → draw a wire
  //   on empty space → pan                tap             → select
  // Two fingers pinch to zoom and pan; the mouse wheel / trackpad pinch zooms at the cursor.
  // While a finger drags a part or wire, a loupe above the finger shows what is underneath.
  //
  // Drags are tracked on the window, not on the element where they started: on touch screens
  // the browser keeps sending a finger's events to its first target, so a drag from the parts
  // library would otherwise never reach the workbench.

  import type { Endpoint, Rotation } from '@esp32lab/project-model';
  import { ESP32_PADS } from '@esp32lab/mcu-esp32';
  import { PARTS } from '../lib/catalog';
  import { board, breadboard, endpointAt, endpointPos, holePos, onBreadboard, partAnchor, pinPos, sameEndpoint, terminalPos, type Pt } from '../lib/geometry';
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
  let moving = $state<{ id: string; type: string; rot: Rotation; moved: boolean } | null>(null);
  /** Rotation of a new part being dragged in from the library (R while dragging turns it). */
  let dragRot = $state<Rotation>(0);
  let pan: { start: Pt; view: typeof view; moved: boolean } | null = null;
  let downAt: Pt | null = null;

  /** Active touch points on the workbench, for pinch. */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; mid: Pt; view: typeof view } | null = null;

  const TAP = 0.35;
  const allDefs = Object.values(PARTS)
    .map((m) => m.defs ?? '')
    .join('');

  function toWorld(clientX: number, clientY: number): Pt {
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(clientX, clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  function inside(ev: PointerEvent): boolean {
    const r = svg.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }

  let dragging = $derived(!!dragType || !!moving || !!wireFrom);

  /**
   * Where a part being placed or moved would go: the hole under the pointer (its first leg), or,
   * away from the breadboard, a spot on the bench.
   */
  let ghost = $derived.by(() => {
    const type = dragType ?? moving?.type;
    if (!type || !pointer || (moving && !moving.moved)) return null;
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
        moving = null;
        pan = null;
        startPinch();
        return;
      }
    }
    const p = toWorld(ev.clientX, ev.clientY);
    pointer = p;
    downAt = p;
    const e = endpointAt(lab.project, p);
    if (e) wireFrom = e;
    else pan = { start: { x: ev.clientX, y: ev.clientY }, view: { ...view }, moved: false };
  }

  function startMove(ev: PointerEvent, id: string) {
    if (ev.pointerType === 'touch' && touches.size >= 1) return; // second finger of a pinch
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
      if (over && ghost?.ok && ghost.hole) lab.addPart(dragType, ghost.hole.bb, ghost.hole.hole, dragRot);
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
      if (to && !sameEndpoint(to, wireFrom)) lab.addWire(wireFrom, to);
      wireFrom = null;
    }
    if (pan) {
      if (!pan.moved) lab.selection = null;
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

  function fit() {
    view = { x: -5, y: -6, w: 54, h: 30 };
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
    if (ev.key === 'Delete' || ev.key === 'Backspace') lab.deleteSelected();
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

  function wirePath(a: Pt, b: Pt): string {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + Math.min(3, Math.hypot(b.x - a.x, b.y - a.y) * 0.15);
    return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
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
      const d = f.kind === 'wire' ? wirePath(pa, pb) : `M${pa.x},${pa.y} L${pb.x},${pb.y}`;
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

  let hoverPart = $state<string | null>(null);
  let hoverWire = $state<string | null>(null);

  /** What the probe chip says about whatever is under the pointer (or was last tapped). */
  let probe = $derived.by((): string | null => {
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
      const where = hover.kind === 'board' ? hover.pin.replace(/\.[LR]$/, '') : hover.kind === 'hole' ? `Lỗ ${hover.hole}` : key;
      const tail = pinOnNet && pinOnNet !== key ? ` · cùng mạch với ${pinOnNet.slice(3).replace(/\.[LR]$/, '')}` : '';
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
      <linearGradient id="bb-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf9f4" /><stop offset="1" stop-color="#ece7dc" /></linearGradient>
      <radialGradient id="bb-hole" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#6b6b6b" /><stop offset="1" stop-color="#2b2b2b" /></radialGradient>
      <linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22344a" /><stop offset="1" stop-color="#16222f" /></linearGradient>
      <linearGradient id="shield" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6e9ec" /><stop offset="0.5" stop-color="#c4c9cf" /><stop offset="1" stop-color="#a7adb4" /></linearGradient>
      <linearGradient id="usb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e1e4e8" /><stop offset="1" stop-color="#9aa0a7" /></linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3dc8a" /><stop offset="1" stop-color="#b8923a" /></linearGradient>
      <filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0.15" dy="0.25" stdDeviation="0.2" flood-opacity="0.35" /></filter>
      <clipPath id="loupe-clip"><circle r={LOUPE_R} /></clipPath>
      {@html allDefs}
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

      <g transform="translate({lab.project.board.x},{lab.project.board.y})" filter="url(#lift)">
        <BoardView board={b} net={hoverNet} observables={lab.observables} {pinFill} {pinHint}
          onpress={(id) => lab.press(id)} onrelease={(id) => lab.release(id)} />
      </g>

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
            {@html partView(part.type, part.props ?? {}, lab.observables[part.id] ?? {})}
          </g>
          {@const ctl = PARTS[part.type]?.control}
          {#if ctl}
            <!-- The part's control (button cap, switch lever) acts on it; the rest of the body drags it -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <g transform="translate({at.x},{at.y}) rotate({rot})">
              {#if ctl.kind === 'press'}
                <circle cx={ctl.cx} cy={ctl.cy} r={ctl.r} fill="transparent" class="press"
                  onpointerdown={(e) => { e.stopPropagation(); capture(e); lab.press(part.id); }}
                  onpointerup={(e) => { e.stopPropagation(); lab.release(part.id); }}
                  onpointercancel={() => lab.release(part.id)} />
              {:else}
                <circle cx={ctl.cx} cy={ctl.cy} r={ctl.r} fill="transparent" class="press"
                  onpointerdown={(e) => { e.stopPropagation(); lab.toggleProp(part.id, ctl.prop); }} />
              {/if}
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
            onpointerdown={(e) => { e.stopPropagation(); hoverWire = w.id; lab.selection = { kind: 'wire', id: w.id }; }}>
            <!-- Wide transparent stroke: easy to tap -->
            <path d={wirePath(a, z)} stroke="transparent" stroke-width="1" fill="none" />
            <path d={wirePath(a, z)} stroke="#00000045" stroke-width="0.44" fill="none" stroke-linecap="round" transform="translate(0.06,0.1)" />
            <path d={wirePath(a, z)} stroke={w.color} stroke-width="0.3" fill="none" stroke-linecap="round" />
            <path d={wirePath(a, z)} stroke="#ffffff" stroke-opacity="0.3" stroke-width="0.08" fill="none" stroke-linecap="round" transform="translate(-0.04,-0.06)" />
            {#if lab.overlay === 'voltage'}
              <path d={wirePath(a, z)} stroke={voltColor(lab.voltages[endpointKey(w.a)])} stroke-width="0.14" fill="none" stroke-linecap="round" />
            {/if}
            {#each [a, z] as p}<rect x={p.x - 0.18} y={p.y - 0.18} width="0.36" height="0.36" rx="0.06" fill="#3a3d42" />{/each}
          </g>
        {/if}
      {/each}

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
        {#if a}<path d={wirePath(a, pointer)} stroke="#f76b15" stroke-width="0.26" fill="none" stroke-dasharray="0.5 0.3" stroke-linecap="round" />{/if}
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
    background: radial-gradient(circle at 50% 40%, #fdfcf9, #f1eee7);
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
  .part.selected {
    filter: drop-shadow(0 0 0.3px #f76b15) drop-shadow(0 0 0.3px #f76b15);
  }
  .press {
    cursor: pointer;
  }
  .wire {
    cursor: pointer;
  }
  .wire.selected path:nth-child(3) {
    stroke-dasharray: 0.6 0.3;
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
    box-shadow: 0 1px 3px #0002;
    border-radius: 8px;
    width: max-content;
  }
  .seg button {
    border-radius: 0;
    margin-left: -1px;
  }
  .seg button:first-child {
    border-radius: 8px 0 0 8px;
  }
  .seg button:last-child {
    border-radius: 0 8px 8px 0;
  }
  .seg button.on {
    background: #1c2024;
    color: #fff;
    border-color: #1c2024;
  }
  .legend {
    font-size: 12px;
    color: #4b4d57;
    background: #ffffffd9;
    padding: 4px 8px;
    border-radius: 6px;
    max-width: 330px;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ffd43b;
    box-shadow: 0 0 4px #f5a524;
  }
  .scale {
    display: inline-block;
    width: 48px;
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(90deg, #3e63dd, #e5484d);
  }
  .chip {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .probe {
    position: absolute;
    left: 12px;
    bottom: 12px;
    background: #1c2024;
    color: #fff;
    font: 13px ui-monospace, 'JetBrains Mono', monospace;
    padding: 6px 10px;
    border-radius: 8px;
    box-shadow: 0 2px 8px #0003;
    pointer-events: none;
    max-width: calc(100% - 90px);
  }
  .leg {
    fill: #ffffff01;
    stroke: #f76b15;
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
    border-radius: 10px;
    box-shadow: 0 1px 3px #0002;
  }
</style>
