<script lang="ts">
  // The workbench: breadboards, the board and parts drawn in pitch units. Drag from the
  // library to place, drag a part to move it, drag from a hole/pin to another to wire.

  import type { Endpoint, Rotation } from '@esp32lab/project-model';
  import { ESP32_PADS } from '@esp32lab/mcu-esp32';
  import { endpointKey, keyOf } from '@esp32lab/sim-core';
  import { PARTS } from '../lib/catalog';
  import { board, breadboard, endpointAt, endpointPos, holePos, sameEndpoint, type Pt } from '../lib/geometry';
  import { lab } from '../lib/lab.svelte';

  let { dragType = $bindable<string | null>(null) } = $props();

  let svg: SVGSVGElement;
  let pointer = $state<Pt | null>(null);
  let hover = $state<Endpoint | null>(null);
  let wireFrom = $state<Endpoint | null>(null);
  let moving = $state<{ id: string; type: string; rot: Rotation; moved: boolean } | null>(null);
  let pressedBoardPart = $state<string | null>(null);

  const VIEW = { x: -2, y: -1, w: 50, h: 25 };

  function toWorld(ev: PointerEvent): Pt {
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  /** Anchor hole for a part being dragged: the hole under the pointer. */
  let ghost = $derived.by(() => {
    const type = dragType ?? moving?.type;
    if (!type || !pointer) return null;
    const e = endpointAt(lab.project, pointer);
    if (!e || e.kind !== 'hole') return { type, at: pointer, ok: false, hole: null as null | { bb: string; hole: string } };
    const rot = moving?.rot ?? 0;
    const ok = lab.canPlace(type, e.bb, e.hole, rot, moving?.id);
    return { type, at: holePos(lab.project, e.bb, e.hole)!, ok, hole: { bb: e.bb, hole: e.hole } };
  });

  /** Keys on the hovered net, for highlighting connected holes and pins. */
  let hoverNet = $derived(hover ? lab.netOf(hover) : new Set<string>());

  function onMove(ev: PointerEvent) {
    pointer = toWorld(ev);
    hover = endpointAt(lab.project, pointer);
    if (moving) moving.moved = true;
  }

  function onDown(ev: PointerEvent) {
    const e = endpointAt(lab.project, toWorld(ev));
    if (e) {
      wireFrom = e;
      svg.setPointerCapture(ev.pointerId);
    } else {
      lab.selection = null;
    }
  }

  function onUp(ev: PointerEvent) {
    const p = toWorld(ev);
    if (dragType && ghost?.ok && ghost.hole) lab.addPart(dragType, ghost.hole.bb, ghost.hole.hole, 0);
    dragType = null;
    if (moving) {
      if (moving.moved && ghost?.ok && ghost.hole) lab.movePart(moving.id, ghost.hole.bb, ghost.hole.hole);
      else if (!moving.moved) lab.selection = { kind: 'part', id: moving.id };
      moving = null;
    }
    if (wireFrom) {
      const to = endpointAt(lab.project, p);
      if (to && !sameEndpoint(to, wireFrom)) lab.addWire(wireFrom, to);
      wireFrom = null;
    }
  }

  function startMove(ev: PointerEvent, id: string) {
    ev.stopPropagation();
    const part = lab.part(id);
    if (!part?.placement) return;
    moving = { id, type: part.type, rot: part.placement.rot, moved: false };
    svg.setPointerCapture(ev.pointerId);
  }

  function onKey(ev: KeyboardEvent) {
    if ((ev.target as HTMLElement).closest('input, select, textarea')) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') lab.deleteSelected();
    if (ev.key === 'r' || ev.key === 'R') lab.rotateSelected();
    if (ev.key === 'Escape') {
      dragType = null;
      wireFrom = null;
      lab.selection = null;
    }
  }

  function partView(type: string, props: Record<string, unknown>, obs: Record<string, unknown>): string {
    const m = PARTS[type];
    if (!m?.view) return '';
    const full: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(m.manifest.props)) full[k] = props[k] ?? s.default;
    return m.view(full as never, obs as never);
  }

  function wirePath(a: Pt, b: Pt): string {
    // A gentle sag, like a jumper wire
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + Math.min(3, Math.hypot(b.x - a.x, b.y - a.y) * 0.15);
    return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  }

  /** Pin colour from the pad's live drive state. */
  function pinFill(pin: string): string {
    const pad = lab.padOfPin(pin);
    const o = pad ? lab.observables[`mcu.${pad}`] : undefined;
    if (!o) return '#c9c9c9';
    if (o.damaged) return '#000';
    if (o.output === 'high') return '#e5484d';
    if (o.output === 'low') return '#3e63dd';
    return '#c9c9c9';
  }

  function pinHint(pin: string): string {
    const pad = lab.padOfPin(pin);
    if (!pad) return pin;
    const c = ESP32_PADS[pad];
    const bits = [pad, c?.adc, c?.touch, c?.dac, c?.inputOnly ? 'input only' : '', c?.strapping ? 'strapping' : '', c?.note].filter(Boolean);
    return bits.join(' · ');
  }

  let b = $derived(board(lab.project));
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg
  bind:this={svg}
  class="bench"
  viewBox="{VIEW.x} {VIEW.y} {VIEW.w} {VIEW.h}"
  onpointermove={onMove}
  onpointerdown={onDown}
  onpointerup={onUp}
  onpointerleave={() => (pointer = null)}
>
  <defs>
    <filter id="glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="0.35" /></filter>
  </defs>

  <!-- Breadboards -->
  {#each lab.project.breadboards as inst (inst.id)}
    {@const bb = breadboard(inst.type)}
    {#if bb}
      <g transform="translate({inst.x},{inst.y})">
        <rect x="-1.2" y="-5.2" width={bb.def.columns + 1.4} height="21.4" rx="0.5" fill="#f4f1ea" stroke="#d8d2c4" stroke-width="0.08" />
        <rect x="-1.2" y="4.6" width={bb.def.columns + 1.4} height="1.8" fill="#e6e1d6" />
        {#each bb.def.rails as rail}
          <line x1="1.4" x2={bb.def.columns - 2.4} y1={rail.y + (rail.polarity === '+' ? -0.55 : 0.55)} y2={rail.y + (rail.polarity === '+' ? -0.55 : 0.55)}
            stroke={rail.polarity === '+' ? '#e5484d' : '#3e63dd'} stroke-width="0.1" />
        {/each}
        {#each bb.def.blocks as block}
          {#each block.rows as row, i}
            <text x="-0.9" y={block.y0 + i + 0.18} font-size="0.5" fill="#a39e93">{row}</text>
          {/each}
        {/each}
        {#each [...bb.holes.values()] as h (h.name)}
          {@const key = keyOf.hole(inst.id, h.name)}
          <rect x={h.x - 0.2} y={h.y - 0.2} width="0.4" height="0.4" rx="0.06"
            class="hole" class:net={hoverNet.has(key)} class:here={hover?.kind === 'hole' && hover.bb === inst.id && hover.hole === h.name} />
        {/each}
      </g>
    {/if}
  {/each}

  <!-- Board -->
  <g transform="translate({lab.project.board.x},{lab.project.board.y})">
    <rect x="-0.9" y="-1.6" width={b.width - 0.2} height={b.height} rx="0.6" fill="#1d2b3a" stroke="#0f1720" stroke-width="0.1" />
    <rect x="2" y="0.2" width="6" height="7.5" rx="0.3" fill="#b8bcc2" stroke="#8a8f96" stroke-width="0.08" />
    <text x="5" y="3.6" font-size="0.75" text-anchor="middle" fill="#4a4f57" font-weight="600">ESP32-WROOM</text>
    <text x="5" y="4.6" font-size="0.5" text-anchor="middle" fill="#5b6068">{b.name.split('(')[0]}</text>
    <rect x="3.6" y={b.height - 2.8} width="2.8" height="1.6" rx="0.2" fill="#9aa0a6" />
    {#each b.pins as pin (pin.name)}
      {@const key = endpointKey({ kind: 'board', pin: pin.name })}
      <g>
        <title>{pinHint(pin.name)}</title>
        <rect x={pin.x - 0.32} y={pin.y - 0.32} width="0.64" height="0.64" rx="0.1" fill={pinFill(pin.name)}
          class="pin" class:net={hoverNet.has(key)} />
        <text x={pin.x + (pin.x === 0 ? 0.6 : -0.6)} y={pin.y + 0.18} font-size="0.45" fill="#d7dee8"
          text-anchor={pin.x === 0 ? 'start' : 'end'}>{pin.name.replace(/\.[LR]$/, '')}</text>
      </g>
    {/each}
    {#each b.onboard.filter((p) => p.x !== undefined) as op (op.id)}
      {@const id = `board.${op.id}`}
      {#if op.type === 'pushbutton'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g transform="translate({op.x},{op.y})" class="board-button"
          onpointerdown={(e) => { e.stopPropagation(); pressedBoardPart = id; lab.press(id); }}
          onpointerup={(e) => { e.stopPropagation(); if (pressedBoardPart) lab.release(pressedBoardPart); pressedBoardPart = null; }}
          onpointerleave={() => { if (pressedBoardPart === id) { lab.release(id); pressedBoardPart = null; } }}>
          <rect x="-0.7" y="-0.5" width="1.4" height="1" rx="0.15" fill="#2b2d31" />
          <rect x="-0.4" y="-0.3" width="0.8" height="0.6" rx="0.1" fill={lab.observables[id]?.pressed ? '#555' : '#888'} />
          <text y="1.1" font-size="0.42" text-anchor="middle" fill="#d7dee8">{op.label?.split(' ')[0]}</text>
        </g>
      {:else if op.type === 'led'}
        {@const glow = Number(lab.observables[id]?.current ?? 0) > 5e-5}
        <g transform="translate({op.x},{op.y})">
          {#if glow}<circle r="1.1" fill="#3e8ef7" opacity="0.55" filter="url(#glow)" />{/if}
          <rect x="-0.35" y="-0.22" width="0.7" height="0.44" rx="0.08" fill={glow ? '#8fc1ff' : '#6b7c93'} />
          <text y="0.95" font-size="0.4" text-anchor="middle" fill="#d7dee8">IO2</text>
        </g>
      {/if}
    {/each}
  </g>

  <!-- Parts -->
  {#each lab.project.parts as part (part.id)}
    {@const at = part.placement ? holePos(lab.project, part.placement.bb, part.placement.hole) : undefined}
    {#if at && moving?.id !== part.id}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g transform="translate({at.x},{at.y}) rotate({part.placement?.rot ?? 0})" class="part"
        class:selected={lab.selection?.kind === 'part' && lab.selection.id === part.id}
        onpointerdown={(e) => startMove(e, part.id)}
        ondblclick={() => part.type === 'pushbutton' && lab.press(part.id)}>
        {@html partView(part.type, part.props ?? {}, lab.observables[part.id] ?? {})}
      </g>
      {#if part.type === 'pushbutton'}
        <!-- Press the cap; the rest of the body drags -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle cx={at.x + 1} cy={at.y + 1.5} r="0.8" fill="transparent" class="press"
          transform="rotate({part.placement?.rot ?? 0} {at.x} {at.y})"
          onpointerdown={(e) => { e.stopPropagation(); lab.press(part.id); }}
          onpointerup={(e) => { e.stopPropagation(); lab.release(part.id); }}
          onpointerleave={() => lab.release(part.id)} />
      {/if}
    {/if}
  {/each}

  <!-- Wires -->
  {#each lab.project.wires as w (w.id)}
    {@const a = endpointPos(lab.project, w.a)}
    {@const z = endpointPos(lab.project, w.b)}
    {#if a && z}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g class="wire" class:selected={lab.selection?.kind === 'wire' && lab.selection.id === w.id}
        onpointerdown={(e) => { e.stopPropagation(); lab.selection = { kind: 'wire', id: w.id }; }}>
        <path d={wirePath(a, z)} stroke="#00000055" stroke-width="0.42" fill="none" stroke-linecap="round" />
        <path d={wirePath(a, z)} stroke={w.color} stroke-width="0.3" fill="none" stroke-linecap="round" />
        <circle cx={a.x} cy={a.y} r="0.18" fill="#444" /><circle cx={z.x} cy={z.y} r="0.18" fill="#444" />
      </g>
    {/if}
  {/each}

  <!-- Wire being drawn -->
  {#if wireFrom && pointer}
    {@const a = endpointPos(lab.project, wireFrom)}
    {#if a}<path d={wirePath(a, pointer)} stroke="#f76b15" stroke-width="0.25" fill="none" stroke-dasharray="0.5 0.3" />{/if}
  {/if}

  <!-- Part being placed or moved -->
  {#if ghost}
    <g transform="translate({ghost.at.x},{ghost.at.y}) rotate({moving?.rot ?? 0})" opacity="0.75" class:bad={!ghost.ok} pointer-events="none">
      {@html partView(ghost.type, moving ? (lab.part(moving.id)?.props ?? {}) : {}, {})}
    </g>
  {/if}
</svg>

<style>
  .bench {
    width: 100%;
    height: 100%;
    background: #fbfaf7;
    touch-action: none;
    user-select: none;
  }
  .hole {
    fill: #3b3b3b;
    opacity: 0.55;
  }
  .hole.net {
    fill: #12a594;
    opacity: 1;
  }
  .hole.here {
    fill: #f76b15;
    opacity: 1;
  }
  .pin {
    stroke: #0f1720;
    stroke-width: 0.06;
    cursor: crosshair;
  }
  .pin.net {
    stroke: #12a594;
    stroke-width: 0.18;
  }
  .part {
    cursor: grab;
  }
  .part.selected {
    filter: drop-shadow(0 0 0.25px #f76b15) drop-shadow(0 0 0.25px #f76b15);
  }
  .press,
  .board-button {
    cursor: pointer;
  }
  .wire {
    cursor: pointer;
  }
  .wire.selected path:last-of-type {
    stroke-dasharray: 0.6 0.3;
  }
  .bad {
    filter: grayscale(1) opacity(0.6);
  }
</style>
