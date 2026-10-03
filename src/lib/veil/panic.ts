"use client";

/**
 * Veil — panic key + about:blank cloak (the quick-exit kit).
 *
 * PANIC KEY: a configurable combo (default Ctrl+Y) that instantly
 * navigates the whole veil away to a site of the owner's choosing —
 * `location.replace`, so the veil page is erased from the tab's history
 * (Back does not come back here). Works while typing, in every section,
 * and — through the control-script relay — even while a veiled page or
 * an arcade iframe holds keyboard focus.
 *
 * ABOUT:BLANK CLOAK: `openVeilInAboutBlank()` pops a new window whose
 * address bar stays `about:blank`, with the veil running fullscreen in
 * a same-origin iframe inside it. The window title is configurable
 * ("Home" by default), the favicon is blanked, and the panic key keeps
 * working inside the cloak (the cloak page runs its own listener, and
 * the in-iframe hook navigates `window.top` when embedded).
 *
 * Storage (localStorage, same keys readable by the cloak window —
 * about:blank inherits the opener's origin):
 *   veil:panic-enabled  "1"|"0"        (default "1")
 *   veil:panic-key      "ctrl+y"       (default)
 *   veil:panic-url      "https://www.google.com" (default)
 *   veil:cloak-key      "alt+b"        (default)
 *   veil:cloak-title    "Home"         (default)
 *   veil:tab-cloak      preset id      (tab disguise — see tab-cloak.ts;
 *                        the popped cloak window wears the same preset's
 *                        title + favicon when one is active)
 */

import * as React from "react";
import { CLOAK_PRESETS, cloakTitleFor, readTabCloakId } from "@/lib/veil/tab-cloak";

/* The tab-cloak helpers are localStorage-backed; about:blank inherits this
 * origin so the reads inside doc.write still resolve. These thin wrappers
 * keep openVeilInAboutBlank resilient if storage is blocked. */
function readTabCloakIdSafe(): string {
  try {
    return readTabCloakId();
  } catch {
    return "off";
  }
}
function cloakTitleForSafe(id: string): string {
  try {
    return cloakTitleFor(id);
  } catch {
    return "Home";
  }
}

export interface PanicConfig {
  panicEnabled: boolean;
  panicKey: string;
  panicUrl: string;
  cloakKey: string;
  cloakTitle: string;
}

const DEFAULT_URL = "https://www.google.com";

export function readPanicConfig(): PanicConfig {
  const g = (k: string): string | null => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  return {
    panicEnabled: g("veil:panic-enabled") !== "0",
    panicKey: (g("veil:panic-key") || "ctrl+y").toLowerCase(),
    panicUrl: sanitizeUrl(g("veil:panic-url") || DEFAULT_URL),
    cloakKey: (g("veil:cloak-key") || "alt+b").toLowerCase(),
    cloakTitle: (g("veil:cloak-title") || "Home").slice(0, 60) || "Home",
  };
}

/** Only http(s) URLs and same-site paths are panic targets. */
export function sanitizeUrl(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return DEFAULT_URL;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* not a URL */
  }
  return DEFAULT_URL;
}

const MODIFIERS = new Set(["control", "shift", "alt", "meta"]);

/** Normalize a keydown into "ctrl+shift+y"-style combo; null for pure
 *  modifier presses (recorders wait for a real key). */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = (e.key || "").toLowerCase();
  if (!key || MODIFIERS.has(key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.metaKey) mods.push("meta");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  return [...mods, key].join("+");
}

/** The act itself — navigate the top-most reachable window away.
 *  `replace` (not `assign`) so history doesn't remember the veil. */
export function panicNavigate(url: string): void {
  const target = sanitizeUrl(url);
  const go = (w: Window) => {
    try {
      w.location.replace(target);
      return true;
    } catch {
      return false;
    }
  };
  // Inside the about:blank cloak our iframe is same-origin with the
  // cloak window — take the WHOLE window with us, not just the iframe.
  try {
    if (window.top && window.top !== window.self && go(window.top)) return;
  } catch {
    /* cross-origin top — fall through */
  }
  go(window);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Pop the cloak: a new window whose URL bar reads about:blank, with
 *  the veil running fullscreen inside it. Returns false when the popup
 *  was blocked (callers should tell the user to allow popups). */
export function openVeilInAboutBlank(): boolean {
  let w: Window | null = null;
  try {
    w = window.open("about:blank", "_blank");
  } catch {
    return false;
  }
  if (!w) return false;
  const cfg = readPanicConfig();
  const src = window.location.origin + "/";
  // Match the active tab disguise (Settings › Security › Tab disguise):
  // the popped window wears the preset's title + favicon, or falls back
  // to the classic cloakTitle + blanked icon.
  const cloakId = readTabCloakIdSafe();
  const preset = cloakId ? CLOAK_PRESETS.find((p) => p.id === cloakId) : undefined;
  const winTitle = preset ? cloakTitleForSafe(cloakId) : cfg.cloakTitle;
  const winIcon = preset && preset.id !== "blank" ? preset.icon : "data:,";
  try {
    const doc = w.document;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8">` +
        `<title>${escapeHtml(winTitle)}</title>` +
        `<link rel="icon" href="${winIcon}">` +
        `<style>html,body{margin:0;height:100%;overflow:hidden;background:#09090b}` +
        `iframe{position:fixed;inset:0;width:100vw;height:100vh;border:0}</style>` +
        `</head><body>` +
        `<iframe src="${escapeHtml(src)}" allow="fullscreen;autoplay;clipboard-write;encrypted-media;picture-in-picture" title="${escapeHtml(winTitle)}"></iframe>` +
        // The cloak page runs its own panic listener — it reads the
        // settings live from localStorage (about:blank inherits this
        // origin, so the store is shared) and can kill the whole window
        // even when the cloak document itself has focus.
        `<script>(function(){` +
        `var D=function(){try{return{on:localStorage.getItem("veil:panic-enabled")!=="0",key:(localStorage.getItem("veil:panic-key")||"ctrl+y").toLowerCase(),url:localStorage.getItem("veil:panic-url")||"${DEFAULT_URL}"}}catch(e){return null}};` +
        `document.addEventListener("keydown",function(e){try{` +
        `var k=(e.key||"").toLowerCase();if(!k||k==="control"||k==="shift"||k==="alt"||k==="meta")return;` +
        `var m=[];if(e.ctrlKey)m.push("ctrl");if(e.metaKey)m.push("meta");if(e.altKey)m.push("alt");if(e.shiftKey)m.push("shift");m.push(k);` +
        `var c=D();if(c&&c.on&&m.join("+")===c.key){e.preventDefault();e.stopPropagation();` +
        `try{window.location.replace(c.url)}catch(x){}}` +
        `}catch(x){}},true);` +
        `})();</scr` +
        `ipt></body></html>`
    );
    doc.close();
    return true;
  } catch {
    // document.write on about:blank is universally supported, but if a
    // hardened browser blocks it, leave the blank window and bail.
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The global hook — mounted once, at the app root (page.tsx).        */
/* ------------------------------------------------------------------ */

/**
 * Listens on the WINDOW in the CAPTURE phase so the panic key fires
 * before any section handler — and works while typing in inputs. Also
 * answers `panic-ready` handshakes from veiled/arcade iframes (their
 * control script asks for the combo, then relays matches back as
 * `panic`), and honors `veil:cloak-open` requests.
 */
export function usePanicKeys(): void {
  // Keydown: panic + cloak combos. Fresh config on every keypress —
  // a combo changed in Settings takes effect on the very next press.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const cfg = readPanicConfig();
      if (cfg.panicEnabled && combo === cfg.panicKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        panicNavigate(cfg.panicUrl);
        return;
      }
      if (combo === cfg.cloakKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openVeilInAboutBlank();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // postMessage: iframes relay keypresses the parent window can't see
  // (a veiled page or arcade game holding focus). The control script
  // asks for its config (`panic-ready`); we answer point-to-point, and
  // act on `panic` relays. Same origin's about:blank cloak iframes
  // share this window's listener naturally.
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __veil?: number; type?: string } | undefined;
      if (!d || typeof d !== "object" || d.__veil !== 1) return;
      if (d.type === "panic-ready") {
        const src = e.source as Window | null;
        if (!src) return;
        const cfg = readPanicConfig();
        src.postMessage(
          {
            __veil: 1,
            type: "veil:panic-cfg",
            on: cfg.panicEnabled,
            key: cfg.panicKey,
            url: cfg.panicUrl,
          },
          "*"
        );
        return;
      }
      if (d.type === "panic") {
        panicNavigate(readPanicConfig().panicUrl);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Settings changes re-broadcast the combo to every live iframe (veiled
  // pages + arcade frames keep their relay config fresh).
  React.useEffect(() => {
    const broadcast = () => {
      const cfg = readPanicConfig();
      document.querySelectorAll("iframe").forEach((f) => {
        try {
          f.contentWindow?.postMessage(
            { __veil: 1, type: "veil:panic-cfg", on: cfg.panicEnabled, key: cfg.panicKey, url: cfg.panicUrl },
            "*"
          );
        } catch {
          /* cross-origin frame that dropped already */
        }
      });
    };
    window.addEventListener("veil:settings-changed", broadcast);
    return () => window.removeEventListener("veil:settings-changed", broadcast);
  }, []);
}
