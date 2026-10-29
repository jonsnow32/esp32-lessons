import type { PartBehavior, PartControl, PartEnv, PartModule, PartProps } from '@esp32lab/part-sdk';
import { doc } from './doc';
import manifest from './part.json';

/** Key labels by row (R1 at the top) and column (C1 on the left), as printed on the keypad. */
export const KEYS = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
] as const;

/** Membrane contact when pressed: carbon pads, a little resistance. */
const R_CLOSED = 100;

/** Row and column of a key label. */
export function keyAt(key: string): [number, number] | undefined {
  for (let r = 0; r < 4; r++) {
    const c = (KEYS[r] as readonly string[]).indexOf(key);
    if (c >= 0) return [r, c];
  }
  return undefined;
}

/** Each held key joins its row line to its column line; any number of keys can be held. */
function create(_props: PartProps, env: PartEnv): PartBehavior {
  const held = new Set<string>();

  return {
    damaged: false,
    stamp(ctx) {
      for (const k of held) {
        const [r, c] = keyAt(k)!;
        ctx.conductance(`r${r + 1}`, `c${c + 1}`, 1 / R_CLOSED);
      }
    },
    onEvent(ev) {
      if ((ev.kind !== 'press' && ev.kind !== 'release') || !ev.key || !keyAt(ev.key)) return;
      const had = held.has(ev.key);
      if (ev.kind === 'press') held.add(ev.key);
      else held.delete(ev.key);
      if (had !== held.has(ev.key)) env.invalidate();
    },
    observables: () => ({ pressed: [...held].join(''), count: held.size }),
  };
}

/** Key centres in pitch units; the 8-pin ribbon tail ends at the pins along y = 0. */
const keyX = (c: number) => 0.6 + c * 1.95;
const keyY = (r: number) => -9.6 + r * 1.95;

/** Black membrane keypad: white number keys, red letter keys; held keys look pushed in. */
function view(_props: PartProps, obs: Record<string, unknown>): string {
  const down = new Set(String(obs.pressed ?? ''));
  const keys = KEYS.flatMap((row, r) =>
    row.map((k, c) => {
      const x = keyX(c), y = keyY(r);
      const letter = c === 3;
      const pressed = down.has(k);
      return `<rect x="${x - 0.75}" y="${y - 0.75}" width="1.5" height="1.5" rx="0.25" fill="${pressed ? (letter ? '#a3242b' : '#b8bcc2') : letter ? '#d8343a' : '#f2f3f5'}" stroke="#00000055" stroke-width="0.05"/>
        <text x="${x}" y="${y + 0.28}" font-size="0.8" font-weight="700" text-anchor="middle" fill="${letter ? '#fff' : '#1c2024'}" font-family="ui-sans-serif, system-ui">${k}</text>`;
    }),
  ).join('');
  const pins = Array.from({ length: 8 }, (_, x) => `<circle cx="${x}" cy="0" r="0.13" fill="#5f646b"/>`).join('');
  return `
    <path d="M-0.35,-1.2 H7.35 V-0.25 H-0.35 Z" fill="#2a2c30"/>
    ${Array.from({ length: 8 }, (_, x) => `<path d="M${x},-1.2 V0" stroke="#c9a227" stroke-width="0.16"/>`).join('')}
    ${pins}
    <rect x="-0.6" y="-11" width="8.2" height="9.9" rx="0.3" fill="#1f2023" stroke="#000" stroke-width="0.05"/>
    ${keys}`;
}

const control: PartControl[] = KEYS.flatMap((row, r) => row.map((key, c) => ({ kind: 'press' as const, key, cx: keyX(c), cy: keyY(r), r: 0.8 })));

export const keypad: PartModule = {
  manifest: manifest as unknown as PartModule['manifest'],
  create,
  view,
  icon: '-0.9 -11.3 8.8 11.7',
  control,
  doc,
};
export default keypad;
