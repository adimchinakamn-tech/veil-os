"use client";

import * as React from "react";
import { Bug, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/* Vertical scrollbar styling for the request table. */
const SCROLL_Y =
  "scrollbar-thin [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700/80";

interface DebugRequest {
  t: number;
  method: string;
  target: string;
  status: number;
  contentType: string;
  ms: number;
  /** memhit | 304hit | stale | miss | blocked | - */
  cache: string;
  container: string;
  egress: string;
  fix: string;
}

interface DebugData {
  version: string;
  uptimeSec: number;
  upstreamProxy: "configured" | "none";
  requests: DebugRequest[];
  stats: { total: number; dropped: number; byCache: Record<string, number>; avgMs: number };
  httpCache: { entries: number; bytes: number; maxBytes: number };
  cookieJars: { container: string; origin: string; cookies: number }[];
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-300";
  if (status >= 300 && status < 400) return "text-amber-300";
  return "text-rose-300";
}

const CACHE_CHIP: Record<string, string> = {
  memhit: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  "304hit": "border-teal-500/30 bg-teal-500/10 text-teal-300",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  miss: "border-zinc-600/40 bg-zinc-700/20 text-zinc-400",
  blocked: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

function cacheChipClass(cache: string): string {
  return CACHE_CHIP[cache] ?? "border-zinc-600/40 bg-zinc-700/20 text-zinc-500";
}

function hostPathOf(target: string): string {
  try {
    const u = new URL(target);
    return u.host + u.pathname + u.search;
  } catch {
    return target;
  }
}

function Chip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-zinc-200">
        {value}
        {sub ? <span className="ml-1 text-[10px] font-normal text-zinc-500">{sub}</span> : null}
      </div>
    </div>
  );
}

/**
 * Quasar v2.1.0 — engine debug slide-over. Polls /api/debug every 2s while
 * open and mirrors the request ring + engine stats. Overlays via fixed
 * positioning so the browsing overlay is untouched.
 */
export function QuasarDebugPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = React.useState<DebugData | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const r = await fetch("/api/debug", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as DebugData;
        if (!alive) return;
        setData(d);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void poll();
    timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [open]);

  // Esc closes the panel.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const byCache = data?.stats.byCache ?? {};
  const requests = data?.requests ?? [];

  return (
    <>
      <div
        role="presentation"
        className="fixed inset-0 z-[190] bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Engine debug"
        className="fixed bottom-0 right-0 top-0 z-[200] flex w-[420px] max-w-full flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-emerald-300" aria-hidden="true" />
            <h2 className="flex-1 text-sm font-semibold text-zinc-100">Quasar engine debug</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close debug panel"
              className="size-8 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-300">
              v{data?.version ?? "—"}
            </span>
            <span className="rounded-full border border-zinc-700/70 bg-zinc-900 px-2 py-0.5 text-zinc-400 tabular-nums">
              up {data ? fmtUptime(data.uptimeSec) : "—"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 font-medium ${
                data?.upstreamProxy === "configured"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700/70 bg-zinc-900 text-zinc-400"
              }`}
            >
              upstream: {data?.upstreamProxy ?? "—"}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 ${SCROLL_Y}`}>
          {failed ? (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              debug API unavailable
            </p>
          ) : null}

          {/* Stat chips */}
          <div className="grid grid-cols-2 gap-2">
            <Chip
              label="Requests seen"
              value={String(data?.stats.total ?? 0)}
              sub={data?.stats.dropped ? `(${data.stats.dropped} dropped)` : undefined}
            />
            <Chip label="Avg latency" value={`${data?.stats.avgMs ?? 0} ms`} />
            <Chip label="Mem hits" value={String(byCache.memhit ?? 0)} />
            <Chip label="304 hits" value={String(byCache["304hit"] ?? 0)} />
            <Chip label="Stale" value={String(byCache.stale ?? 0)} />
            <Chip label="Misses" value={String(byCache.miss ?? 0)} />
            <Chip label="Blocked" value={String(byCache.blocked ?? 0)} />
            <Chip
              label="HTTP cache"
              value={data ? `${fmtMB(data.httpCache.bytes)} / ${fmtMB(data.httpCache.maxBytes)} MB` : "—"}
              sub={data ? `${data.httpCache.entries} entries` : undefined}
            />
            <Chip label="Cookie jars" value={String(data?.cookieJars.length ?? 0)} />
          </div>

          {/* Request table */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              <Bug className="size-3" aria-hidden="true" />
              Recent requests
              <span className="font-normal normal-case tracking-normal text-zinc-600">(newest first)</span>
            </div>
            <div className={`max-h-96 overflow-y-auto rounded-md border border-zinc-800 ${SCROLL_Y}`}>
              <div className="min-w-[380px]">
                <div className="sticky top-0 z-10 grid grid-cols-[58px_38px_30px_1fr] items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <span>Time</span>
                  <span>Method</span>
                  <span>St</span>
                  <span>Request</span>
                </div>
                {requests.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-zinc-600">
                    {failed ? "" : "No proxied requests yet."}
                  </p>
                ) : (
                  requests.map((r, i) => (
                    <div
                      key={`${r.t}-${i}`}
                      className="grid grid-cols-[58px_38px_30px_1fr] items-center gap-1.5 border-b border-zinc-800/50 px-2 py-1.5 text-xs last:border-b-0 odd:bg-zinc-900/30"
                    >
                      <span className="tabular-nums text-zinc-500">
                        {new Date(r.t).toTimeString().slice(0, 8)}
                      </span>
                      <span className="truncate font-medium text-zinc-400" title={r.method}>
                        {r.method}
                      </span>
                      <span className={`tabular-nums ${statusColor(r.status)}`}>{r.status}</span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded border px-1 py-px text-[9px] font-medium ${cacheChipClass(r.cache)}`}
                          title={`cache: ${r.cache}`}
                        >
                          {r.cache}
                        </span>
                        {r.container && r.container !== "default" ? (
                          <span
                            className="max-w-16 shrink-0 truncate text-[10px] text-zinc-400"
                            title={`container: ${r.container}`}
                          >
                            {r.container}
                          </span>
                        ) : null}
                        {r.egress && r.egress !== "auto" && r.egress !== "-" ? (
                          <span
                            className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-px text-[9px] text-emerald-300"
                            title={`egress: ${r.egress}`}
                          >
                            {r.egress}
                          </span>
                        ) : null}
                        {r.fix && r.fix !== "-" ? (
                          <span
                            className="shrink-0 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1 py-px text-[9px] text-fuchsia-300"
                            title={`site fix: ${r.fix}`}
                          >
                            {r.fix}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300" title={r.target}>
                          {hostPathOf(r.target)}
                        </span>
                        <span className="w-10 shrink-0 text-right tabular-nums text-[10px] text-zinc-500">
                          {r.ms}ms
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
