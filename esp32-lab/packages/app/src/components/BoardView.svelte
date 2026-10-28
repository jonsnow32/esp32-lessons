<script lang="ts">
  // ESP32 DevKit drawn from board.json: PCB, WROOM module with shield and antenna, pin headers
  // coloured by live pad state, USB connector, onboard LED and the BOOT/EN buttons.
  import type { BoardDef } from '@esp32lab/project-model';
  import { endpointKey } from '@esp32lab/sim-core';

  let {
    board,
    net,
    observables,
    pinFill,
    pinHint,
    onpress,
    onrelease,
  }: {
    board: BoardDef;
    net: Set<string>;
    observables: Record<string, Record<string, unknown>>;
    pinFill: (pin: string) => string;
    pinHint: (pin: string) => string;
    onpress: (part: string) => void;
    onrelease: (part: string) => void;
  } = $props();

  let right = $derived(Math.max(...board.pins.map((p) => p.x)));
  let rows = $derived(Math.max(...board.pins.map((p) => p.y)) + 1);
  let held = $state<string | null>(null);

  function down(e: PointerEvent, id: string) {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* pointer not active (synthetic event) */
    }
    held = id;
    onpress(id);
  }
  function up(e: PointerEvent) {
    e.stopPropagation();
    if (held) onrelease(held);
    held = null;
  }
</script>

<!-- PCB -->
<rect x="-1.1" y="-1.5" width={right + 2.2} height={board.height + 0.6} rx="0.5" fill="url(#pcb)" stroke="#0b0f14" stroke-width="0.08" />
{#each [[-0.55, -0.95], [right + 0.55, -0.95], [-0.55, board.height - 2.05], [right + 0.55, board.height - 2.05]] as [x, y]}
  <circle cx={x} cy={y} r="0.32" fill="#0b0f14" stroke="#b9a35c" stroke-width="0.1" />
{/each}

<!-- Pin headers -->
{#each [0, right] as hx}
  <rect x={hx - 0.48} y="-0.5" width="0.96" height={rows} rx="0.1" fill="#16181b" />
{/each}

<!-- ESP32-WROOM module: antenna area, then the metal shield -->
<g transform="translate({right / 2 - 3.1},-3.4)">
  <rect width="6.2" height="11.8" rx="0.15" fill="#1e2a20" stroke="#0e1410" stroke-width="0.06" />
  <path d="M0.6,0.6 h4.4 v0.5 h-4 v0.5 h4 v0.5 h-4 v0.5 h4.4" fill="none" stroke="#c8a64b" stroke-width="0.14" />
  <rect x="0.35" y="3.1" width="5.5" height="8.3" rx="0.2" fill="url(#shield)" stroke="#8b9097" stroke-width="0.06" />
  <text x="3.1" y="6.2" font-size="0.5" text-anchor="middle" fill="#5b6068" font-weight="700">ESP32-WROOM-32</text>
  <text x="3.1" y="7.1" font-size="0.42" text-anchor="middle" fill="#6d727a">Wi-Fi · BT · 4 MB flash</text>
  <text x="3.1" y="10.6" font-size="0.36" text-anchor="middle" fill="#7d828a">CE · FCC</text>
</g>

<!-- Regulator, USB-UART chip, USB connector -->
<rect x={right / 2 - 3.6} y={rows - 4.2} width="1.6" height="1.1" rx="0.1" fill="#222" />
<rect x={right / 2 + 1.6} y={rows - 4.4} width="1.8" height="1.8" rx="0.1" fill="#1c1c1c" />
<text x={right / 2 + 2.5} y={rows - 3.35} font-size="0.3" text-anchor="middle" fill="#888">CP2102</text>
<rect x={right / 2 - 1.7} y={board.height - 3} width="3.4" height="2" rx="0.25" fill="url(#usb)" stroke="#6b7076" stroke-width="0.06" />
<rect x={right / 2 - 1.1} y={board.height - 2.55} width="2.2" height="0.7" rx="0.3" fill="#2d3035" />

{#each board.pins as pin (pin.name)}
  {@const key = endpointKey({ kind: 'board', pin: pin.name })}
  {@const fill = pinFill(pin.name)}
  {@const driven = !fill.startsWith('url(')}
  <g>
    <title>{pinHint(pin.name)}</title>
    <rect x={pin.x - 0.34} y={pin.y - 0.34} width="0.68" height="0.68" rx="0.08" fill="#2a2c30" />
    <!-- Driven pins light up the whole pad; idle pins show the gold square pin -->
    <rect x={pin.x - (driven ? 0.3 : 0.2)} y={pin.y - (driven ? 0.3 : 0.2)} width={driven ? 0.6 : 0.4} height={driven ? 0.6 : 0.4}
      rx="0.06" fill={fill} stroke={net.has(key) ? '#12a594' : 'none'} stroke-width="0.22" />
    <text x={pin.x + (pin.x === 0 ? 0.62 : -0.62)} y={pin.y + 0.16} font-size="0.42" fill="#e4e9f0" font-family="ui-monospace, monospace"
      text-anchor={pin.x === 0 ? 'start' : 'end'}>{pin.name.replace(/\.[LR]$/, '')}</text>
  </g>
{/each}

{#each board.onboard.filter((p) => p.x !== undefined) as op (op.id)}
  {@const id = `board.${op.id}`}
  {#if op.type === 'pushbutton'}
    {@const pressed = observables[id]?.pressed === true}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g transform="translate({op.x},{op.y})" class="button" onpointerdown={(e) => down(e, id)} onpointerup={up} onpointercancel={up}>
      <!-- Generous invisible hit area for fingers -->
      <rect x="-1.1" y="-0.9" width="2.2" height="2.2" fill="transparent" />
      <rect x="-0.75" y="-0.55" width="1.5" height="1.1" rx="0.12" fill="url(#btn-frame)" />
      <rect x="-0.45" y="-0.32" width="0.9" height="0.64" rx="0.12" fill={pressed ? '#1a1b1e' : '#3a3c41'} />
      <text y="1.05" font-size="0.42" text-anchor="middle" fill="#e4e9f0" font-weight="600">{op.label?.split(' ')[0]}</text>
    </g>
  {:else if op.type === 'led'}
    {@const on = Number(observables[id]?.current ?? 0) > 5e-5}
    <g transform="translate({op.x},{op.y})">
      {#if on}<circle r="1.6" fill="url(#led-glow-blue)" />{/if}
      <rect x="-0.35" y="-0.22" width="0.7" height="0.44" rx="0.06" fill={on ? '#cfe3ff' : '#8796ab'} stroke="#e8edf3" stroke-width="0.05" />
      <text y="0.95" font-size="0.36" text-anchor="middle" fill="#e4e9f0">IO2</text>
    </g>
  {/if}
{/each}

<style>
  .button {
    cursor: pointer;
  }
</style>
