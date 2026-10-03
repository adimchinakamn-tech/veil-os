/**
 * Veil — persisted user settings (localStorage: "veil.settings").
 * Contract shared by page.tsx, settings-section, wallpapers-section.
 */

export interface VeilSettings {
  /** Active wallpaper id (see wallpapers.ts). */
  wallpaper: string;
  /** true (default): a new tab opens the start page. false: minimal blank tab. */
  newTabStart: boolean;
  /** true (default): app resets to the start page when restarted/reloaded. */
  resetOnRestart: boolean;
}

export const DEFAULT_SETTINGS: VeilSettings = {
  wallpaper: "neon-aurora",
  newTabStart: true,
  resetOnRestart: true,
};

const KEY = "veil.settings";

export function loadSettings(): VeilSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VeilSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: VeilSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full/blocked — settings stay in-memory for this session */
  }
}
