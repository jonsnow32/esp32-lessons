<script lang="ts" module>
  /* The app's icon set, drawn like board artwork: a 16-unit grid, 1.5 strokes with square ends and
     mitred corners, traces that only turn at 90° or 45°, a solder pad where a trace starts, and at
     most one copper detail per icon (class "a" strokes it, "af" fills it). "f" is a solid fill. */
  const PAD = (x: number, y: number) => `<circle class="f" cx="${x}" cy="${y}" r="1.6"/>`;
  export const ICONS = {
    play: '<path class="f" d="M4.5 2.5v11L13 8z"/>',
    pause: '<path class="f" d="M4 3h3v10H4zM9 3h3v10H9z"/>',
    // A chip with its die lit: the sketch is being built
    build: '<path d="M4.5 4.5h7v7h-7z"/><path d="M6.5 1.5v2M9.5 1.5v2M6.5 12.5v2M9.5 12.5v2M1.5 6.5h2M1.5 9.5h2M12.5 6.5h2M12.5 9.5h2" stroke-linecap="butt"/><path class="af" d="M7 7h2v2H7z"/>',
    reset: `<path d="M9 3.5H6L3.5 6v4L6 12.5h4l2.5-2.5V7"/><path class="af" d="M10 7.5l2.5-3.5 2.5 3.5z"/>${PAD(9, 3.5)}`,
    undo: `<path d="M12.5 12.5V9L10 6.5H6"/><path class="af" d="M6.5 3v7L2 6.5z"/>${PAD(12.5, 12.5)}`,
    redo: `<path d="M3.5 12.5V9L6 6.5h4"/><path class="af" d="M9.5 3v7L14 6.5z"/>${PAD(3.5, 12.5)}`,
    back: `<path d="M6 8h7"/><path class="f" d="M7 4v8L2 8z"/>${PAD(13, 8)}`,
    forward: `<path d="M3 8h7"/><path class="f" d="M9 4v8l5-4z"/>${PAD(3, 8)}`,
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    // Four parts squared up on a grid, one of them copper: lay the bench out again
    arrange: '<path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4z"/><path class="af" d="M9.5 9.5h4v4h-4z"/>',
    // A clock face with copper hands: earlier conversations
    history: '<path d="M5.5 2.5h5l3 3v5l-3 3h-5l-3-3v-5z"/><path class="a" d="M8 5v3.5h2.5"/>',
    minus: '<path d="M3 8h10"/>',
    more: `${PAD(3, 8)}${PAD(8, 8)}${PAD(13, 8)}`,
    // Crop marks around a copper square: frame everything
    fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/><path class="a" d="M6.5 6.5h3v3h-3z"/>',
    'select-many': '<path d="M2.5 2.5h11v11h-11z" stroke-dasharray="2.5 1.5"/><path class="af" d="M6 6h4v4H6z"/>',
    layout: '<path d="M2.5 2.5h11v11h-11zM6.5 2.5v11M6.5 9.5h7"/>',
    'dock-left': '<path d="M2.5 2.5h11v11h-11z"/><path class="af" d="M3.5 3.5h3v9h-3z"/>',
    'dock-right': '<path d="M2.5 2.5h11v11h-11z"/><path class="af" d="M9.5 3.5h3v9h-3z"/>',
    'dock-bottom': '<path d="M2.5 2.5h11v11h-11z"/><path class="af" d="M3.5 9.5h9v3h-9z"/>',
    edit: '<path d="M3 13l.75-3.25 7-7 2.5 2.5-7 7zM9.25 4.25l2.5 2.5"/>',
    trash: '<path d="M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.75 9h6.5l.75-9M6.75 7v4M9.25 7v4" stroke-linecap="butt"/>',
    // Multimeter probe: the copper tip touches the net
    probe: '<path d="M5 9.5L11 3.5l2 2-6 6z"/><path d="M8.5 6l2 2" stroke-linecap="butt"/><path class="a" d="M5.75 10.25L2.5 13.5"/>',
    search: '<path d="M5 2h3l2.5 2.5v3L8 10H5L2.5 7.5v-3zM10 10l3.5 3.5"/>',
    // A breadboard with a fresh column: start an empty bench
    bench: `<path d="M1.5 5.5h10v8h-10z"/>${[4, 6.5, 9].flatMap((x) => [8, 11].map((y) => `<circle class="f" cx="${x}" cy="${y}" r=".9"/>`)).join('')}<path class="a" d="M12.5 1v5M10 3.5h5"/>`,
    'chevron-left': '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
    'chevron-right': '<path d="M6 3.5L10.5 8 6 12.5"/>',
    'chevron-down': '<path d="M3.5 6L8 10.5 12.5 6"/>',
    'chevron-up': '<path d="M3.5 10L8 5.5l4.5 4.5"/>',
    check: '<path d="M2.5 8.5l3.5 3.5 7.5-7.5"/>',
    // Note levels, shaped so they read without colour: octagon, triangle, a bolt of current, a square
    error: `<path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5z"/><path d="M8 4.75v4"/><circle class="f" cx="8" cy="11.25" r="1"/>`,
    warn: `<path d="M8 2l6.5 11.5h-13z" stroke-linejoin="bevel"/><path d="M8 6.25v3.5"/><circle class="f" cx="8" cy="11.75" r="1"/>`,
    ok: '<path d="M9.5 1.5L4 9h4l-1.5 5.5L12 7H8z"/>',
    info: `<path d="M2.5 2.5h11v11h-11z"/><path d="M8 7v4.5"/><circle class="f" cx="8" cy="4.75" r="1"/>`,
  } as const;
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name, size = 16, label }: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg class="ico" viewBox="0 0 16 16" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>{@html ICONS[name]}</svg>

<style>
  .ico { display: inline-block; flex: 0 0 auto; vertical-align: -0.2em; overflow: visible; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: square; stroke-linejoin: miter; }
  .ico :global(.f) { fill: currentColor; stroke: none; }
  .ico :global(.a) { stroke: var(--icon-accent); }
  .ico :global(.af) { fill: var(--icon-accent); stroke: none; }
</style>
