"use client";

/**
 * PresenceHeartbeat — a null-render component mounted ONCE in page.tsx
 * (outside the AnimatePresence mode switch) so presence tracking survives
 * start-page ↔ browsing transitions. It heartbeats every 15s (plus an
 * immediate beat when the tab becomes visible again) and publishes each
 * returned snapshot to the presence store.
 */

import * as React from "react";
import { presenceBeat } from "@/lib/veil/presence-store";

const BEAT_MS = 15_000;

export function PresenceHeartbeat() {
  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const beat = () => {
      if (stopped) return;
      void presenceBeat();
    };

    // An interval that re-arms itself — survives a beat being slow, and
    // naturally re-syncs after background-tab throttling.
    const arm = () => {
      timer = setTimeout(() => {
        beat();
        arm();
      }, BEAT_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };

    beat();
    arm();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", beat);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", beat);
    };
  }, []);

  return null;
}
