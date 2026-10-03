"use client";

/**
 * Veil — tab cloak presets (the "look like homework" kit).
 *
 * One tap in Settings › Security disguises the tab: the title AND the
 * favicon switch to a school-work look (Classroom, Gmail, Drive, Docs,
 * Calendar) or a blank tab. Everything is local — the favicons are inline
 * SVG data: URLs (no network fetch, no leak, works offline) and the state
 * lives in localStorage:
 *
 *   veil:tab-cloak   "off" (default) | preset id
 *   veil:cloak-title custom title override (the Blank preset and the
 *                    about:blank cloak window both wear it)
 *
 * `applyTabCloak()` is idempotent and re-runs on `veil:settings-changed`,
 * so a preset change takes effect instantly, everywhere, without a reload.
 * The about:blank cloak window (panic.ts) reads the same keys when it
 * builds its document, so a popped cloak matches the disguise too.
 */

import * as React from "react";

export interface CloakPreset {
  id: string;
  name: string;
  title: string;
  /** inline SVG favicon (data: URL) */
  icon: string;
  blurb: string;
}

/* --- the icons ------------------------------------------------------- */

function svg(fg: string, bg: string, body: string): string {
  const raw =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="${bg}"/>${body}</svg>`;
  return (
    "data:image/svg+xml," +
    raw.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/"/g, "'")
  );
}

export const CLOAK_PRESETS: CloakPreset[] = [
  {
    id: "classroom",
    name: "Classroom",
    title: "Classes",
    blurb: "Google Classroom look",
    icon: svg(
      "#ffffff",
      "#0f9d58",
      `<rect x="12" y="18" width="40" height="28" rx="4" fill="#0b8043"/>` +
        `<rect x="18" y="24" width="12" height="4" rx="2" fill="#ffffff"/>` +
        `<rect x="18" y="32" width="20" height="4" rx="2" fill="#8fd6b0"/>` +
        `<circle cx="44" cy="26" r="4" fill="#fbbc04"/>` +
        `<rect x="28" y="10" width="8" height="10" rx="2" fill="#0b8043"/>` +
        `<rect x="24" y="8" width="16" height="6" rx="3" fill="#0f9d58"/>`
    ),
  },
  {
    id: "gmail",
    name: "Gmail",
    title: "Inbox (3) - Gmail",
    blurb: "mail inbox look",
    icon: svg(
      "#ffffff",
      "#ffffff",
      `<rect x="4" y="14" width="56" height="36" rx="6" fill="#ffffff" stroke="#dadce0" stroke-width="2"/>` +
        `<path d="M6 20 L32 40 L58 20" fill="none" stroke="#ea4335" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M6 18 L32 38 L58 18 L58 14 Q58 10 54 10 L10 10 Q6 10 6 14 Z" fill="#ea4335"/>` +
        `<circle cx="50" cy="14" r="9" fill="#ffffff"/>` +
        `<text x="50" y="19" font-family="Arial" font-size="13" font-weight="bold" fill="#ea4335" text-anchor="middle">3</text>`
    ),
  },
  {
    id: "drive",
    name: "Drive",
    title: "My Drive - Google Drive",
    blurb: "file storage look",
    icon: svg(
      "#ffffff",
      "#ffffff",
      `<path d="M22 10 L42 10 L58 38 L38 38 Z" fill="#fbbc04"/>` +
        `<path d="M22 10 L42 10 L26 38 L6 38 Z" fill="#4285f4"/>` +
        `<path d="M6 38 L26 38 L34 52 L16 54 Z" fill="#34a853"/>` +
        `<path d="M26 38 L58 38 L44 54 L16 54 Z" fill="#0f9d58" opacity="0.85"/>`
    ),
  },
  {
    id: "docs",
    name: "Docs",
    title: "Untitled document - Google Docs",
    blurb: "essay doc look",
    icon: svg(
      "#ffffff",
      "#4285f4",
      `<rect x="16" y="10" width="32" height="44" rx="4" fill="#ffffff"/>` +
        `<rect x="22" y="22" width="20" height="4" rx="2" fill="#dadce0"/>` +
        `<rect x="22" y="30" width="20" height="4" rx="2" fill="#dadce0"/>` +
        `<rect x="22" y="38" width="12" height="4" rx="2" fill="#dadce0"/>` +
        `<path d="M16 10 Q16 6 20 6 L36 6 L48 18 L20 18 Q16 18 16 14 Z" fill="#4285f4" opacity="0.25"/>` +
        `<path d="M36 6 L48 18 L36 18 Z" fill="#a1c2fa"/>`
    ),
  },
  {
    id: "calendar",
    name: "Calendar",
    title: "Calendar",
    blurb: "today's date look",
    icon: svg(
      "#ffffff",
      "#ffffff",
      `<rect x="6" y="8" width="52" height="48" rx="6" fill="#ffffff" stroke="#dadce0" stroke-width="2"/>` +
        `<rect x="6" y="8" width="52" height="14" rx="6" fill="#4285f4"/>` +
        `<rect x="6" y="16" width="52" height="6" fill="#4285f4"/>` +
        `<text x="32" y="46" font-family="Arial" font-size="24" font-weight="bold" fill="#4285f4" text-anchor="middle">23</text>`
    ),
  },
  {
    id: "blank",
    name: "Blank",
    title: "New Tab",
    blurb: "empty-tab look",
    icon: "data:,",
  },
];

/* --- state ----------------------------------------------------------- */

export const DEFAULT_TAB_TITLE = "Veil — Full-Screen Web Viewer";
const CLOAK_KEY = "veil:tab-cloak";
const CLOAK_TITLE_KEY = "veil:cloak-title";

export function readTabCloakId(): string {
  try {
    const v = window.localStorage.getItem(CLOAK_KEY);
    return v === null ? "off" : v;
  } catch {
    return "off";
  }
}

export function readCustomCloakTitle(): string {
  try {
    return (
      (window.localStorage.getItem(CLOAK_TITLE_KEY) || "Home").slice(0, 60) ||
      "Home"
    );
  } catch {
    return "Home";
  }
}

export function writeTabCloakId(id: string): void {
  try {
    window.localStorage.setItem(CLOAK_KEY, id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("veil:settings-changed"));
}

/** The title the tab should wear right now. */
export function cloakTitleFor(id: string): string {
  if (id === "off") return DEFAULT_TAB_TITLE;
  const p = CLOAK_PRESETS.find((x) => x.id === id);
  if (!p) return DEFAULT_TAB_TITLE;
  if (p.id === "blank") return readCustomCloakTitle() || "New Tab";
  return p.title;
}

/** Swap the tab's favicon: remember the site's own icon links so "off"
 *  restores them exactly. Browsers resolve competing icon links by
 *  last-wins for equal rel/sizes, so we remove the others while the
 *  disguise is on. */
let savedIcons: { rel: string; href: string; type: string | null }[] | null = null;

function setFavicon(href: string): void {
  const head = document.head;
  if (!head) return;
  const links = Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'));
  if (savedIcons === null) {
    savedIcons = links.map((l) => ({
      rel: l.rel,
      href: l.href,
      type: l.getAttribute("type"),
    }));
  }
  for (const l of links) l.remove();
  const el = document.createElement("link");
  el.rel = "icon";
  el.href = href;
  if (href.startsWith("data:image/svg")) el.type = "image/svg+xml";
  head.appendChild(el);
}

function restoreFavicon(): void {
  const head = document.head;
  if (!head) return;
  Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')).forEach((l) => l.remove());
  if (savedIcons) {
    for (const s of savedIcons) {
      const el = document.createElement("link");
      el.rel = s.rel;
      el.href = s.href;
      if (s.type) el.setAttribute("type", s.type);
      head.appendChild(el);
    }
  }
  savedIcons = null;
}

/** Apply the currently-configured disguise to THIS document. Idempotent;
 *  call again after settings change. */
export function applyTabCloak(): void {
  const id = readTabCloakId();
  if (id === "off") {
    if (document.title !== DEFAULT_TAB_TITLE) document.title = DEFAULT_TAB_TITLE;
    restoreFavicon();
    return;
  }
  const preset = CLOAK_PRESETS.find((x) => x.id === id);
  if (!preset) {
    if (document.title !== DEFAULT_TAB_TITLE) document.title = DEFAULT_TAB_TITLE;
    restoreFavicon();
    return;
  }
  document.title = cloakTitleFor(id);
  setFavicon(preset.icon);
}

/** Mount once at the app root: applies the cloak on load and keeps it
 *  live-synced with Settings changes. */
export function useTabCloak(): void {
  React.useEffect(() => {
    applyTabCloak();
    const onChange = () => applyTabCloak();
    window.addEventListener("veil:settings-changed", onChange);
    return () => window.removeEventListener("veil:settings-changed", onChange);
  }, []);
}
