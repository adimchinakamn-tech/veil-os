"use client";

/**
 * Client-side presence store — one heartbeat loop (mounted once, in
 * page.tsx) writes snapshots here; any number of consumers read them via
 * usePresence(). A window event ("veil:presence-changed") also fires for
 * non-React consumers.
 */

import * as React from "react";

export interface PresenceUser {
  accountId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarImage: string | null;
  lastSeen: number;
}

export interface PresenceSnapshot {
  total: number;
  guests: number;
  users: PresenceUser[];
  ts: number;
}

const EMPTY: PresenceSnapshot = { total: 0, guests: 0, users: [], ts: 0 };

let snapshot: PresenceSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  try {
    window.dispatchEvent(new Event("veil:presence-changed"));
  } catch {
    /* non-DOM env — ignore */
  }
}

export function setPresenceSnapshot(next: Partial<PresenceSnapshot> | null | undefined) {
  if (!next || typeof next !== "object") return;
  snapshot = {
    total: Number(next.total) || 0,
    guests: Number(next.guests) || 0,
    users: Array.isArray(next.users)
      ? next.users
          .filter((u) => u && typeof u.username === "string")
          .slice(0, 100)
          .map((u) => ({
            accountId: String(u.accountId ?? ""),
            username: String(u.username ?? "?"),
            displayName: String(u.displayName || u.username || "?"),
            avatarColor: String(u.avatarColor || "#f97316"),
            avatarImage:
              typeof u.avatarImage === "string" && /^(\/|data:image\/|https?:\/\/)/i.test(u.avatarImage)
                ? u.avatarImage
                : null,
            lastSeen: Number(u.lastSeen) || 0,
          }))
      : [],
    ts: Number(next.ts) || Date.now(),
  };
  emit();
}

export function getPresenceSnapshot(): PresenceSnapshot {
  return snapshot;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive read of the latest presence snapshot (SSR-safe). */
export function usePresence(): PresenceSnapshot {
  return React.useSyncExternalStore(subscribe, getPresenceSnapshot, () => EMPTY);
}

/**
 * One heartbeat: POST the (freshly re-read) chat account to /api/presence
 * and publish the returned snapshot.
 */
export async function presenceBeat(): Promise<void> {
  try {
    let account: Record<string, unknown> | null = null;
    try {
      const raw = window.localStorage.getItem("veil:chat-account");
      if (raw) {
        const parsed = JSON.parse(raw) as { account?: Record<string, unknown> };
        const a = parsed?.account;
        if (a && typeof a.id === "string" && typeof a.username === "string") {
          account = {
            accountId: a.id,
            username: a.username,
            displayName: a.displayName ?? a.username,
            avatarColor: a.avatarColor ?? "#f97316",
            avatarImage: a.avatarImage ?? null,
          };
        }
      }
    } catch {
      /* unreadable/corrupt session — beat as a guest */
    }
    const res = await fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account }),
      cache: "no-store",
    });
    if (!res.ok) return;
    setPresenceSnapshot(await res.json());
  } catch {
    /* offline / server hiccup — keep the last snapshot */
  }
}
