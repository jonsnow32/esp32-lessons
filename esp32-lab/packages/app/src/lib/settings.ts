// The user's own settings, kept in the browser. One object behind one key, with a version and
// the time it last changed, so the whole of it can later be synced with a profile in the cloud
// (the newer copy wins).

export interface Settings {
  /** Tidy mode last chosen for the wires (a TIDY_MODES id), null for none yet. */
  wireMode: 'grid' | 'free' | null;
  /** How the bench shows the solved circuit. */
  overlay: 'current' | 'voltage' | 'off';
  /** The circuit cannot be edited while the program runs (pause it first). */
  lockWhileRunning: boolean;
}

interface Stored {
  version: 1;
  /** When the settings last changed, ms since the epoch. */
  updated: number;
  settings: Partial<Settings> & {
    /** Before there were two tidy modes: an index into the five there were (the last one free). */
    tidyMode?: number;
  };
}

const KEY = 'esp32lab.settings';

export const DEFAULT_SETTINGS: Settings = { wireMode: null, overlay: 'current', lockWhileRunning: false };

/** The stored settings over the defaults; the defaults alone if none or unreadable. */
export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    const { tidyMode, ...settings } = stored?.settings ?? {};
    const wireMode = tidyMode === undefined || tidyMode < 0 ? null : tidyMode === 4 ? 'free' : 'grid';
    return { ...DEFAULT_SETTINGS, ...(tidyMode !== undefined && { wireMode }), ...settings };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Store the settings, stamped with the time, unless they are what is stored already. */
export function saveSettings(settings: Settings) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (stored && !('tidyMode' in stored.settings) && JSON.stringify({ ...DEFAULT_SETTINGS, ...stored.settings }) === JSON.stringify(settings)) return;
  } catch {
    /* unreadable: overwrite it */
  }
  const next: Stored = { version: 1, updated: Date.now(), settings };
  localStorage.setItem(KEY, JSON.stringify(next));
}
