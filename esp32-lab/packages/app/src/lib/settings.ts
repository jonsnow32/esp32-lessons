// The user's own settings, kept in the browser. One object behind one key, with a version and
// the time it last changed, so the whole of it can later be synced with a profile in the cloud
// (the newer copy wins).

export interface Settings {
  /** Tidy mode last chosen for the wires (index into TIDY_MODES), -1 for none yet. */
  tidyMode: number;
  /** How the bench shows the solved circuit. */
  overlay: 'current' | 'voltage' | 'off';
  /** The circuit cannot be edited while the program runs (pause it first). */
  lockWhileRunning: boolean;
}

interface Stored {
  version: 1;
  /** When the settings last changed, ms since the epoch. */
  updated: number;
  settings: Partial<Settings>;
}

const KEY = 'esp32lab.settings';

export const DEFAULT_SETTINGS: Settings = { tidyMode: -1, overlay: 'current', lockWhileRunning: false };

/** The stored settings over the defaults; the defaults alone if none or unreadable. */
export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    return { ...DEFAULT_SETTINGS, ...stored?.settings };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Store the settings, stamped with the time, unless they are what is stored already. */
export function saveSettings(settings: Settings) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (stored && JSON.stringify({ ...DEFAULT_SETTINGS, ...stored.settings }) === JSON.stringify(settings)) return;
  } catch {
    /* unreadable: overwrite it */
  }
  const next: Stored = { version: 1, updated: Date.now(), settings };
  localStorage.setItem(KEY, JSON.stringify(next));
}
