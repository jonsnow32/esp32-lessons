// SVG <defs> shared by every drawing of the bench (the workbench and the project thumbnails):
// breadboard plastic and holes, the board's PCB, shield, USB and gold pins, then each part's own.

import { PARTS } from './catalog';

export const SCENE_DEFS = `
<linearGradient id="bb-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf9f4"/><stop offset="1" stop-color="#ece7dc"/></linearGradient>
<radialGradient id="bb-hole" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#6b6b6b"/><stop offset="1" stop-color="#2b2b2b"/></radialGradient>
<linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22344a"/><stop offset="1" stop-color="#16222f"/></linearGradient>
<linearGradient id="pcb-black" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2c30"/><stop offset="1" stop-color="#131417"/></linearGradient>
<linearGradient id="shield" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6e9ec"/><stop offset="0.5" stop-color="#c4c9cf"/><stop offset="1" stop-color="#a7adb4"/></linearGradient>
<linearGradient id="usb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e1e4e8"/><stop offset="1" stop-color="#9aa0a7"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3dc8a"/><stop offset="1" stop-color="#b8923a"/></linearGradient>
` + Object.values(PARTS).map((m) => m.defs ?? '').join('');
