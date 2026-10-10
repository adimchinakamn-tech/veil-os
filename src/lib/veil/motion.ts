"use client";

/**
 * Veil motion — the "More animations" preference (Settings › Appearance).
 *
 * Default ON: the veiled browser gets the full treatment — pages glide in
 * with a soft blur, a light-sweep follows every navigation, tabs spring,
 * buttons breathe. Off keeps the chrome calm and lean (the handful of
 * baseline fades stay).
 *
 * All consumers are client-only components (they mount after user
 * interaction — BrowserView, the tab strip, the new-tab page), so the
 * lazy useState initializer can touch localStorage without SSR trouble.
 * The hook re-reads on every "veil:settings-changed" so flipping the
 * switch in Settings applies live, mid-session.
 */

import * as React from "react";
import { useReducedMotion } from "framer-motion";

const STORAGE_KEY = "veil:more-animations";
const CHANGE_EVENT = "veil:settings-changed";

/** Raw read — missing key means ON (the default). Never throws. */
export function moreAnimationsOn(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    /* private mode — default ON */
    return true;
  }
}

/** Mirror the preference onto <html data-veil-fancy="on">.
 *
 * The MEGA motion tier in globals.css is entirely gated behind the
 * `html[data-veil-fancy="on"]` selector — components sprinkle the veil-*
 * classes unconditionally and the CSS decides whether they animate.
 * One attribute, one toggle, every effect on the site. */
export function syncFancyDomAttr(): void {
  if (typeof document === "undefined") return;
  if (moreAnimationsOn()) {
    document.documentElement.setAttribute("data-veil-fancy", "on");
  } else {
    document.documentElement.removeAttribute("data-veil-fancy");
  }
}

/** Live "More animations" state (listens for Settings changes).
 *
 * SSR-safe: starts false and reads the real preference in an effect —
 * the start page is server-rendered and its first client render must
 * match that HTML (the same pattern the clock/weather settings use).
 * One frame of calm, then the fancy tier kicks in. */
export function useMoreAnimations(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const sync = () => {
      setOn(moreAnimationsOn());
      syncFancyDomAttr();
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  return on;
}

/**
 * Effective fancy-motion state: the user's preference AND the OS-level
 * reduced-motion request. When the visitor asked the OS for less motion,
 * Veil respects it no matter what the setting says.
 */
export function useFancyMotion(): boolean {
  const more = useMoreAnimations();
  const reduced = useReducedMotion();
  return more && !reduced;
}

/* ------------------------------------------------------------------ */
/* Shared motion language                                              */
/* ------------------------------------------------------------------ */

/** The signature Veil glide: opacity + a hint of scale + blur burn-off. */
export const FANCY_GLIDE_EASE = [0.22, 1, 0.36, 1] as const;

/** Entrances that should feel "expensive" — soft landing, tiny overshoot. */
export const FANCY_SPRING = { type: "spring", stiffness: 320, damping: 26 } as const;

/** Snappy micro-interactions (buttons, chips). */
export const POP_SPRING = { type: "spring", stiffness: 520, damping: 22 } as const;
