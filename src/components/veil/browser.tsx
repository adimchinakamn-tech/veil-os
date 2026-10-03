"use client";

/**
 * Veil — full-screen browsing overlay with multi-tab support.
 *
 * Takes over the entire viewport (fixed inset-0) with an auto-hiding glass
 * control bar. The remote page renders edge-to-edge underneath it. When the
 * active tab has no target yet, a compact start page is shown instead.
 */

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Home,
  Lock,
  Maximize,
  Minimize,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeyboardHelp } from "@/components/veil/keyboard-help";
import { NewTab } from "@/components/veil/new-tab";
import {
  engineFrameSrc,
  faviconUrls,
  isVeilAppUrl,
  normalizeInput,
  veilAppFrameSrc,
  type HistoryResponse,
} from "@/lib/veil/shared";

export interface Tab {
  id: string;
  stack: string[];
  idx: number;
  reloadKey: number;
  title: string;
}

const BAR_IDLE_MS = 2600;

/** Veil's local programs (freetube.veil.local) load from the same-origin
 *  /ft mount instead of the WISP route — their favicon is a play glyph. */
function TabFavicon({ target, title }: { target: string; title: string }) {
  const [failed, setFailed] = React.useState(false);
  const host = React.useMemo(() => {
    if (!target) return "";
    try {
      return new URL(target).hostname;
    } catch {
      return "";
    }
  }, [target]);
  const isFt = isVeilAppUrl(target);
  const urls = React.useMemo(() => (host && !isFt ? faviconUrls(host) : []), [host, isFt]);
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    setFailed(false);
    setIdx(0);
  }, [host, isFt]);

  if (!target) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500">
        <Sparkles aria-hidden className="h-3 w-3" />
      </span>
    );
  }
  if (isFt) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-emerald-500/20 text-emerald-300">
        <Play aria-hidden className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (failed || idx >= urls.length) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-emerald-500/20 text-[9px] font-semibold text-emerald-300">
        {(title || host || "?").charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={urls[idx]}
      alt=""
      width={16}
      height={16}
      onError={() => setIdx((i) => i + 1)}
      className="h-4 w-4 shrink-0 rounded-sm bg-zinc-800 object-contain p-px"
    />
  );
}

export function BrowserView({
  tabs,
  activeId,
  target,
  title,
  loading,
  canBack,
  canForward,
  reloadKey,
  history,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  onUrlChange,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  onOpenInNewTab,
}: {
  tabs: Tab[];
  activeId: string;
  target: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  reloadKey: number;
  history: HistoryResponse | null;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onNavigate: (url: string) => void;
  onUrlChange: (url: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onSwitchTab: (id: string) => void;
  /** Open a URL as a NEW tab (target=_blank / middle-click inside engine pages). */
  onOpenInNewTab: (url: string) => void;
}) {
  const [barVisible, setBarVisible] = React.useState(true);
  /* Manually hidden via the corner-arrow/chevron — while true, the usual
     mouse-near-top reveal stays silent: the corner arrow is the ONLY way
     back (mirrors the offline file's veilHideBar → veilCorner pairing). */
  const [barManual, setBarManualState] = React.useState(false);
  const barManualRef = React.useRef(false);
  const setBarManual = React.useCallback((v: boolean) => {
    barManualRef.current = v;
    setBarManualState(v);
  }, []);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [editValue, setEditValue] = React.useState(target);
  const [editing, setEditing] = React.useState(false);
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    if (!editing) setEditValue(target);
  }, [target, editing]);

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const revealBar = React.useCallback(() => {
    // Manually hidden: stay hidden — the corner arrow (or a key like
    // Ctrl+L that needs the input) is the way back, never a stray
    // mouse-leave/mouse-move near the top edge.
    if (barManualRef.current) return;
    setBarVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Keep the bar parked while the active tab is a start page (no target).
    if (target === "") return;
    hideTimer.current = setTimeout(() => {
      if (document.activeElement !== urlInputRef.current) setBarVisible(false);
    }, BAR_IDLE_MS);
  }, [target]);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (barManualRef.current) return; // manually hidden — corner arrow owns the reveal
      if (e.clientY <= 96) revealBar();
    };
    const onVeilMouse = (e: MessageEvent) => {
      const d = e.data as { __veil?: 1; type?: string; d?: { y?: number } } | undefined;
      if (d && d.__veil === 1 && d.type === "mouse" && typeof d.d?.y === "number" && d.d.y <= 120) {
        revealBar();
      }
    };
    const onKey = () => revealBar();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("message", onVeilMouse);
    window.addEventListener("keydown", onKey);
    revealBar();
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("message", onVeilMouse);
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [revealBar]);

  const toggleFullscreen = React.useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* sandboxed preview may deny — full-viewport layout still applies */
    }
  }, []);

  React.useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "f" || e.key === "F") {
        if (!typing) {
          e.preventDefault();
          void toggleFullscreen();
        }
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        onBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        onForward();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        // Keyboard access to the URL bar always un-hides the controls
        // (even from manual-hide mode).
        setBarManual(false);
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
        setEditing(true);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        onNewTab();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        if (activeId) onCloseTab(activeId);
      } else if (e.ctrlKey && e.key === "Tab") {
        // Cycle tabs
        e.preventDefault();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeId);
        if (idx === -1) return;
        const next = e.shiftKey
          ? tabs[(idx - 1 + tabs.length) % tabs.length]
          : tabs[(idx + 1) % tabs.length];
        onSwitchTab(next.id);
      } else if (e.key === "?") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("veil:open-shortcuts"));
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [onBack, onForward, onHome, toggleFullscreen, onNewTab, onCloseTab, onSwitchTab, activeId, tabs]);

  const submitUrl = (e?: React.FormEvent) => {
    e?.preventDefault();
    const next = normalizeInput(editValue);
    if (next) {
      setEditing(false);
      urlInputRef.current?.blur();
      onNavigate(next);
    } else {
      setEditValue(target);
      setEditing(false);
    }
  };

  /* The corner-arrow pair (ported from the offline file's veilCorner /
   * veilHideBar): chev-up in the bar's right cluster parks the controls
   * away; the chev-down corner button pinned top-LEFT brings them back
   * (user pick: top-left corner, not top-right). */
  const hideBarManually = React.useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setBarManual(true);
    setBarVisible(false);
  }, [setBarManual]);
  const showBarFromCorner = React.useCallback(() => {
    setBarManual(false);
    revealBar();
  }, [revealBar, setBarManual]);

  const host = React.useMemo(() => {
    try {
      return new URL(target).hostname;
    } catch {
      return target;
    }
  }, [target]);

  // Veil-local programs load from the same-origin /ft mount; everything
  // else goes through whichever proxy engine is selected (Settings ›
  // Browsing › Proxy engine) — engineFrameSrc decides the lane.
  const isFt = isVeilAppUrl(target);
  const frameSrc = isFt ? veilAppFrameSrc(target) : engineFrameSrc(target);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[100] bg-white"
      role="region"
      aria-label="Full-screen browsing"
    >
      {/* ------- Remote page OR start page (edge-to-edge) ------- */}
      {target ? (
        <iframe
          key={`${activeId}:${reloadKey}`}
          id="veil-frame"
          ref={frameRef}
          src={frameSrc}
          title={title || target}
          className="absolute inset-0 h-full w-full border-0 bg-white"
          allow="fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-read; clipboard-write"
          /* The FreeTube program is same-origin and needs its API calls to
           * carry the page's Referer — the service reads it to bake
           * *reachable* absolute media URLs (the visitor's real origin, not
           * localhost:3031). Remote/proxied lanes keep no-referrer. */
          referrerPolicy={isFt ? "same-origin" : "no-referrer"}
          onLoad={() => onUrlChange(target)}
        />
      ) : (
        <NewTab onNavigate={onNavigate} history={history} onHome={onHome} />
      )}

      {/* ------- Loading progress ------- */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-[3px] overflow-hidden bg-emerald-500/10"
          >
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "0%" }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              className="h-full w-1/2 bg-gradient-to-r from-transparent via-emerald-500 to-transparent"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------- Auto-hiding control bar (with tab strip when >1 tab) ------- */}
      <motion.header
        animate={{ y: barVisible ? 0 : "-105%" }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="absolute left-0 right-0 top-0 z-30"
        onMouseEnter={() => {
          if (hideTimer.current) clearTimeout(hideTimer.current);
        }}
        onMouseLeave={revealBar}
      >
        <div className="bg-zinc-950/92 shadow-2xl shadow-black/30 backdrop-blur-xl">
          {/* Tab strip (only when more than one tab) */}
          {tabs.length > 1 && (
            <div className="veil-scroll-slim mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-2 pt-1.5">
              {tabs.map((t) => {
                const tTarget = t.idx >= 0 ? t.stack[t.idx] : "";
                const tTitle = t.idx === -1 ? "New tab" : t.title || (loading && t.id === activeId ? "Loading…" : tTarget);
                const active = t.id === activeId;
                return (
                  <div
                    key={t.id}
                    role="tab"
                    aria-selected={active}
                    tabIndex={0}
                    onClick={() => onSwitchTab(t.id)}
                    onMouseDown={(e) => {
                      // Middle-click closes the tab (browser convention).
                      if (e.button === 1) {
                        e.preventDefault();
                        onCloseTab(t.id);
                      }
                    }}
                    className={
                      "group relative flex h-9 min-w-[140px] max-w-[220px] cursor-pointer items-center gap-2 rounded-t-lg border-t-2 px-3 transition " +
                      (active
                        ? "border-t-emerald-400 bg-zinc-900 text-zinc-100"
                        : "border-t-transparent bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200")
                    }
                  >
                    <TabFavicon target={tTarget} title={t.title} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{tTitle || "New tab"}</span>
                    <button
                      type="button"
                      aria-label="Close tab"
                      title="Close tab (Ctrl+W)"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(t.id);
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-100 group-hover:opacity-100"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Main control row */}
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-1.5 px-2.5 sm:gap-2 sm:px-4">
            {/* Left cluster */}
            <div className="flex items-center gap-0.5">
              <IconBtn label="Back (Alt+←)" onClick={onBack} disabled={!canBack}>
                <ArrowLeft aria-hidden />
              </IconBtn>
              <IconBtn label="Forward (Alt+→)" onClick={onForward} disabled={!canForward}>
                <ArrowRight aria-hidden />
              </IconBtn>
              <IconBtn label="Reload" onClick={onReload} disabled={!target}>
                <RotateCw aria-hidden className={loading ? "animate-spin" : undefined} />
              </IconBtn>
            </div>

            {/* URL pill */}
            <form onSubmit={submitUrl} className="mx-1 min-w-0 flex-1 sm:mx-2">
              <div className="group flex h-10 items-center gap-2.5 rounded-xl border border-zinc-700/80 bg-zinc-800/60 px-3 transition focus-within:border-emerald-500/60 focus-within:bg-zinc-800 focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.18)]">
                {isFt ? (
                  <>
                    <Play aria-hidden className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span className="hidden shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-400 sm:inline-flex">
                      private tube
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span className="hidden shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-400 sm:inline-flex">
                      <Lock aria-hidden className="h-3 w-3" />
                      veiled
                    </span>
                  </>
                )}
                <input
                  ref={urlInputRef}
                  value={editValue}
                  onChange={(e) => {
                    setEditing(true);
                    setEditValue(e.target.value);
                  }}
                  onFocus={(e) => {
                    setEditing(true);
                    revealBar();
                    requestAnimationFrame(() => e.target.select());
                  }}
                  onBlur={() => {
                    setEditing(false);
                    setEditValue(target);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setEditing(false);
                      setEditValue(target);
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Enter a URL to keep browsing…"
                  aria-label="Current page URL"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
                <span className="hidden max-w-[180px] shrink-0 truncate text-[11px] text-zinc-500 lg:block">
                  {host}
                </span>
              </div>
            </form>

            {/* Right cluster */}
            <div className="flex items-center gap-0.5">
              <IconBtn label="New tab (Ctrl+T)" onClick={onNewTab}>
                <Plus aria-hidden />
              </IconBtn>
              <KeyboardHelp
                trigger={
                  <button
                    type="button"
                    aria-label="Keyboard shortcuts (?)"
                    title="Keyboard shortcuts (?)"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    ?
                  </button>
                }
              />
              <IconBtn
                label={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
              </IconBtn>
              <IconBtn
                label="Open this page in a new tab"
                onClick={() => target && window.open(frameSrc, "_blank", "noopener")}
                disabled={!target}
              >
                <ExternalLink aria-hidden />
              </IconBtn>
              <div className="mx-1 hidden h-6 w-px bg-zinc-700 sm:block" aria-hidden />
              <Button
                size="sm"
                onClick={onHome}
                className="h-9 rounded-lg bg-emerald-500/15 px-3 text-[13px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25"
              >
                <Home aria-hidden className="sm:hidden" />
                <span className="hidden sm:inline">Exit veil</span>
              </Button>
              {/* Hide the controls — the chev-down corner button (top-left)
                  brings them back. Ports the offline file's veilHideBar. */}
              <IconBtn
                label="Hide controls — the arrow in the top-left corner brings them back"
                onClick={hideBarManually}
              >
                <ChevronUp aria-hidden />
              </IconBtn>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Corner arrow pinned top-LEFT while the bar is hidden — click to
          bring the controls back. Replaces the old slim center handle; in
          manual mode this is the only reveal (mouse-near-top stays silent).
          Ports the offline file's veilCorner, moved to the top-left corner
          (user pick). */}
      <AnimatePresence>
        {!barVisible && (
          <motion.button
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            type="button"
            aria-label="Show the control bar"
            title="Show the control bar"
            onClick={showBarFromCorner}
            onMouseEnter={barManual ? undefined : revealBar}
            className="absolute left-3 top-3 z-40 flex size-9 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-950/85 text-zinc-300 shadow-xl shadow-black/30 backdrop-blur-md transition hover:border-emerald-500/60 hover:bg-zinc-900 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
          >
            <ChevronDown aria-hidden className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ------- Fullscreen nudge (only when not OS-fullscreen) ------- */}
      <AnimatePresence>
        {!isFullscreen && target && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ delay: 0.8, duration: 0.35 }}
            onClick={() => void toggleFullscreen()}
            className="absolute bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-950/85 px-4 py-2.5 text-[12.5px] font-medium text-zinc-300 shadow-xl shadow-black/30 backdrop-blur-md transition hover:border-emerald-500/50 hover:text-emerald-300"
          >
            <Maximize aria-hidden className="h-3.5 w-3.5" />
            Go true fullscreen <span className="font-mono text-[10.5px] text-zinc-500">F</span>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
