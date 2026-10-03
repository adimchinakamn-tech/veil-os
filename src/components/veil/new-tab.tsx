"use client";

/**
 * Veil — new-tab start page.
 * Shown inside the browsing overlay when the active tab has no target yet.
 * A compact, focused launcher: command bar + quick links + recent history.
 */

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Clock, History as HistoryIcon, Maximize2, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  faviconUrls,
  normalizeInput,
  QUICK_LINKS,
  timeAgo,
  type HistoryResponse,
} from "@/lib/veil/shared";

function FaviconImg({ host, name, className }: { host: string; name: string; className?: string }) {
  const urls = React.useMemo(() => faviconUrls(host), [host]);
  const [idx, setIdx] = React.useState(0);
  const failed = idx >= urls.length;
  if (failed) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center rounded-md bg-emerald-500/15 font-semibold text-emerald-300 ${className ?? "h-8 w-8"}`}
        style={{ fontSize: 13 }}
      >
        {name.replace(/^www\./, "").charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={urls[idx]}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      className={`rounded-md bg-zinc-800 object-contain p-0.5 ${className ?? "h-8 w-8"}`}
    />
  );
}

export function NewTab({
  onNavigate,
  history,
  onHome,
}: {
  onNavigate: (url: string) => void;
  history: HistoryResponse | null;
  onHome: () => void;
}) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const target = normalizeInput(input.trim());
    if (target) onNavigate(target);
  };

  const stats = history?.stats;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-zinc-950 pt-16 text-zinc-100 veil-scroll-slim">
      {/* Backdrop: floating orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="veil-orb-a absolute -top-32 left-1/2 h-[360px] w-[560px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="veil-orb-b absolute top-40 right-[14%] h-48 w-48 rounded-full bg-teal-500/10 blur-[90px]" />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #3f3f46 1px, transparent 1px), linear-gradient(to bottom, #3f3f46 1px, transparent 1px)",
            backgroundSize: "52px 52px",
            maskImage: "radial-gradient(ellipse 70% 55% at 50% 35%, black 30%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 50% 35%, black 30%, transparent 100%)",
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6"
      >
        {/* Brand mark */}
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Sparkles aria-hidden className="h-4.5 w-4.5 text-emerald-400" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Veil<span className="text-emerald-400">.</span>
          </span>
        </div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="text-center text-2xl font-bold tracking-tight sm:text-3xl"
        >
          Where to next?
        </motion.h2>

        {/* Command bar */}
        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          onSubmit={submit}
          className="mx-auto mt-7 flex w-full max-w-2xl items-center gap-2"
          role="search"
        >
          <div className="group relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-zinc-500 transition group-focus-within:text-emerald-400" />
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a URL — or search the web…"
              aria-label="URL or search query"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              className="h-13 rounded-2xl border-zinc-800 bg-zinc-900/90 pl-11 pr-4 text-[15px] text-zinc-100 shadow-2xl shadow-black/40 placeholder:text-zinc-500 focus-visible:border-emerald-500/60 focus-visible:ring-emerald-500/30"
            />
          </div>
          <button
            type="submit"
            className="flex h-13 items-center gap-1.5 rounded-2xl bg-emerald-500 px-5 text-[15px] font-semibold text-emerald-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
          >
            <Maximize2 aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">Browse</span>
          </button>
        </motion.form>

        {/* Quick links */}
        <div className="mt-10">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <Clock aria-hidden className="h-3.5 w-3.5" />
            Launch pads
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {QUICK_LINKS.map((s, i) => (
              <motion.button
                key={s.url}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.12 + i * 0.04 }}
                onClick={() => onNavigate(s.url)}
                className="group flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 text-left transition hover:-translate-y-0.5 hover:border-emerald-500/40 hover:bg-zinc-900"
              >
                <FaviconImg host={s.host} name={s.name} className="h-9 w-9 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-zinc-100">{s.name}</span>
                  <span className="block truncate text-[11px] text-zinc-500">{s.desc}</span>
                </span>
                <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-400" />
              </motion.button>
            ))}
          </div>
        </div>

        {/* Recent history (mini) */}
        {history && history.visits.length > 0 && (
          <div className="mt-9">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <HistoryIcon aria-hidden className="h-3.5 w-3.5" />
              Recently viewed
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {history.visits.slice(0, 6).map((v) => {
                const title = v.title || v.url.replace(/^https?:\/\//, "");
                return (
                  <li key={v.id}>
                    <button
                      onClick={() => onNavigate(v.url)}
                      className="flex w-full items-center gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition hover:border-emerald-500/40 hover:bg-zinc-900"
                    >
                      <FaviconImg host={v.host} name={v.host} className="h-8 w-8 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-200">{title}</span>
                        <span className="block truncate text-[11px] text-zinc-500">
                          {v.host} · {timeAgo(v.updatedAt)}
                          {v.visitCount > 1 && <span className="text-emerald-500/80"> · {v.visitCount}×</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Stats line */}
        {stats && (
          <p className="mt-9 text-center text-[12px] text-zinc-600">
            {stats.sites.toLocaleString()} sites visited · {stats.pageVisits.toLocaleString()} page loads · all server-side
          </p>
        )}

        {/* Home button */}
        <div className="mt-8 text-center">
          <button
            onClick={onHome}
            className="text-[12.5px] text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
          >
            Close all tabs and return to the start page
          </button>
        </div>
      </motion.div>
    </div>
  );
}
