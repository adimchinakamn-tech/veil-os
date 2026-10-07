"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Circle,
  Copy,
  Ghost,
  History,
  Pin,
  PinOff,
  Plus,
  RotateCw,
  Sparkles,
  Tag,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Tab, TabEgress } from "@/components/veil/browser";

/* Custom scrollbar (same language as the rest of the chrome). */
const SCROLLBAR = "veil-scroll-slim";

/* Fixed 6-color palette, deterministically assigned per container name. */
const CONTAINER_COLORS = [
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-violet-400",
  "bg-teal-400",
  "bg-orange-400",
];

export function containerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CONTAINER_COLORS[h % CONTAINER_COLORS.length];
}

const CONTAINER_RE = /^[A-Za-z0-9_-]{1,40}$/;
const INCOGNITO_RE = /^incognito-\d+$/;

export function isIncognitoContainer(name: string): boolean {
  return INCOGNITO_RE.test(name);
}

/** Smallest free "incognito-<n>" id among the currently open tabs. */
function firstFreeIncognito(tabs: Tab[]): string {
  const used = new Set(tabs.map((t) => t.container));
  for (let n = 1; n <= 99; n++) {
    const id = `incognito-${n}`;
    if (!used.has(id)) return id;
  }
  return "incognito-" + Date.now().toString(36);
}

export interface UaPreset {
  id: string;
  label: string;
  ua: string;
}

export const UA_PRESETS: UaPreset[] = [
  { id: "native", label: "Native", ua: "" },
  {
    id: "chrome-mac",
    label: "Chrome · macOS",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
  {
    id: "chrome-win",
    label: "Chrome · Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
  {
    id: "firefox-win",
    label: "Firefox · Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  },
  {
    id: "safari-ios",
    label: "Safari · iOS",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  {
    id: "googlebot",
    label: "Googlebot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
];

export type TabMenuAction =
  | { type: "toggle-pin" }
  | { type: "toggle-mute" }
  | { type: "duplicate" }
  | { type: "close" }
  | { type: "close-others" }
  | { type: "container"; container: string }
  | { type: "drop-container"; container: string }
  | { type: "egress"; egress: TabEgress }
  | { type: "ua"; ua: string };

interface TabStripProps {
  tabs: Tab[];
  activeId: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  /** HTML5 drag reorder: move dragId next to targetId. */
  onReorder: (dragId: string, targetId: string, place: "before" | "after") => void;
  onAction: (tabId: string, action: TabMenuAction) => void;
  onReopen: () => void;
  canReopen: boolean;
  /** Renders a tab's favicon (Veil's multi-source favicon logic). */
  renderFavicon: (target: string, title: string) => React.ReactNode;
}

const EGRESS_OPTIONS: { value: TabEgress; label: string; title: string }[] = [
  { value: "auto", label: "Auto", title: "Auto — engine picks the route" },
  { value: "direct", label: "Direct", title: "Direct — bypass the upstream proxy" },
  { value: "upstream", label: "Upstream", title: "Upstream — force the upstream proxy" },
];

function actionRowClass(disabled?: boolean): string {
  return `flex min-h-[44px] w-full items-center gap-2.5 px-3 text-left text-xs transition-colors ${
    disabled
      ? "pointer-events-none opacity-40"
      : "text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
  }`;
}

/**
 * Quasar v2.1.0 tab strip for the Veil browsing overlay — drag reorder,
 * pinning, mute, and the per-tab context menu (containers / egress / UA).
 * Adapted from the standalone Quasar chrome to Veil's stack-based Tab model.
 */
export function QuasarTabStrip({
  tabs,
  activeId,
  loading,
  onSelect,
  onClose,
  onNewTab,
  onReorder,
  onAction,
  onReopen,
  canReopen,
  renderFavicon,
}: TabStripProps) {
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropMark, setDropMark] = React.useState<{ id: string; side: "before" | "after" } | null>(null);
  const [menu, setMenu] = React.useState<{ tabId: string; x: number; y: number } | null>(null);
  const [naming, setNaming] = React.useState(false);
  const [nameVal, setNameVal] = React.useState("");
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);

  // Pinned tabs always lead the strip (stable partition, order preserved).
  const displayTabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  const menuTab = menu ? tabs.find((t) => t.id === menu.tabId) ?? null : null;

  // Distinct non-default containers currently in use (menu options, capped).
  const knownContainers: string[] = [];
  for (const t of tabs) {
    if (t.container && t.container !== "default" && !knownContainers.includes(t.container)) {
      knownContainers.push(t.container);
    }
  }

  const closeMenu = React.useCallback(() => {
    setMenu(null);
    setNaming(false);
    setNameVal("");
  }, []);

  // Focus the inline "new container" input when it appears.
  React.useEffect(() => {
    if (naming) nameInputRef.current?.focus();
  }, [naming]);

  // Esc closes the context menu.
  React.useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeMenu]);

  // Static viewport clamp (menu is w-72 with max-h min(560px, 100vh-16px)).
  let menuXY: { x: number; y: number } | null = null;
  if (menu) {
    const maxH = Math.min(560, window.innerHeight - 16);
    menuXY = {
      x: Math.max(8, Math.min(menu.x, window.innerWidth - 288 - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - maxH - 8)),
    };
  }

  const run = (action: TabMenuAction) => {
    if (!menu) return;
    onAction(menu.tabId, action);
    closeMenu();
  };

  const submitName = () => {
    const name = nameVal.trim();
    if (!menu || !CONTAINER_RE.test(name)) return;
    run({ type: "container", container: name });
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Open tabs"
        className={`flex items-center gap-1 overflow-x-auto px-2 pt-1.5 ${SCROLLBAR}`}
      >
        {/* AnimatePresence + layout: new tabs spring in, closed tabs
            shrink out, and the survivors glide to fill the gap — the same
            physics as a native browser chrome. */}
        <AnimatePresence initial={false}>
          {displayTabs.map((t) => {
            const tTarget = t.idx >= 0 ? t.stack[t.idx] : "";
            const tTitle = t.idx === -1 ? "New tab" : t.title || (loading && t.id === activeId ? "Loading…" : tTarget);
            const active = t.id === activeId;
            const isPinned = t.pinned;
            const mark = dropMark?.id === t.id ? dropMark.side : null;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, scale: 0.72 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.72, transition: { duration: 0.16, ease: "easeOut" } }}
                transition={{ type: "spring", stiffness: 520, damping: 34 }}
                style={{ transformOrigin: "top center" }}
                role="tab"
              tabIndex={0}
              aria-selected={active}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", t.id);
                e.dataTransfer.effectAllowed = "move";
                setDragId(t.id);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === t.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                setDropMark({ id: t.id, side: e.clientX - rect.left < rect.width / 2 ? "before" : "after" });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dropMark && dropMark.id === t.id) {
                  onReorder(dragId, dropMark.id, dropMark.side);
                }
                setDragId(null);
                setDropMark(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropMark(null);
              }}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(t.id);
                }
              }}
              onAuxClick={(e) => {
                // Middle-click closes the tab, like a real browser.
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setNaming(false);
                setNameVal("");
                setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
              }}
              title={tTarget || "New Tab"}
              className={`group relative flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-lg border-t border-x text-xs transition-colors ${
                isPinned
                  ? "w-11 justify-center px-0 py-2"
                  : "min-w-[140px] max-w-[220px] px-3 py-2"
              } ${
                active
                  ? "border-zinc-700/80 bg-zinc-900 text-zinc-100 shadow-[0_1px_10px_rgba(0,0,0,0.35)]"
                  : "border-transparent bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200"
              } ${dragId === t.id ? "opacity-40" : ""}`}
            >
              {/* Active tab — emerald top accent line */}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1 top-0 h-[2px] rounded-full bg-gradient-to-r from-emerald-400/0 via-emerald-400 to-emerald-400/0"
                />
              ) : null}
              {/* Drop indicator lines */}
              {mark === "before" ? (
                <span
                  aria-hidden="true"
                  className="absolute -left-px top-0 z-10 h-full w-0.5 rounded-full bg-emerald-400"
                />
              ) : null}
              {mark === "after" ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-px top-0 z-10 h-full w-0.5 rounded-full bg-emerald-400"
                />
              ) : null}

              {/* Container color dot (v2.1.0) */}
              {t.container !== "default" ? (
                <span
                  aria-hidden="true"
                  title={`Container: ${t.container}`}
                  className={`absolute right-1 top-1 size-1.5 rounded-full ${containerColor(t.container)}`}
                />
              ) : null}

              {loading && t.id === activeId ? (
                <RotateCw
                  className={`shrink-0 animate-spin text-emerald-400 ${isPinned ? "size-4" : "size-3.5"}`}
                  aria-hidden="true"
                />
              ) : tTarget ? (
                <span className={`flex shrink-0 items-center justify-center overflow-hidden ${isPinned ? "size-4" : "size-4"}`}>
                  {renderFavicon(tTarget, t.title)}
                </span>
              ) : (
                <Sparkles aria-hidden className="shrink-0 size-3.5 text-zinc-500" />
              )}
              {!isPinned ? (
                <>
                  <span className="truncate flex-1 text-[12.5px]">{tTitle || "New tab"}</span>
                  {t.muted ? <VolumeX className="size-3 shrink-0 text-amber-300" aria-label="Muted" /> : null}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(t.id);
                    }}
                    aria-label="Close tab"
                    title="Close tab (Ctrl+W)"
                    className="rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-200 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </motion.div>
          );
          })}
        </AnimatePresence>
        <motion.button
          whileTap={{ scale: 0.86 }}
          onClick={onNewTab}
          aria-label="New tab (Ctrl+T)"
          title="New tab (Ctrl+T)"
          className="mb-0.5 ml-1 shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-emerald-300"
        >
          <Plus className="size-4" aria-hidden="true" />
        </motion.button>
      </div>

      {/* Tab context menu */}
      {menu && menuTab ? (
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-40"
            onClick={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div
            role="menu"
            aria-label={`Tab menu: ${menuTab.title || "New Tab"}`}
            style={{ left: menuXY!.x, top: menuXY!.y }}
            className="fixed z-50 max-h-[min(560px,calc(100vh-16px))] w-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-2xl"
          >
            {/* Actions */}
            <button role="menuitem" className={actionRowClass()} onClick={() => run({ type: "toggle-pin" })}>
              {menuTab.pinned ? <PinOff className="size-3.5 text-zinc-400" /> : <Pin className="size-3.5 text-zinc-400" />}
              {menuTab.pinned ? "Unpin tab" : "Pin tab"}
            </button>
            <button role="menuitem" className={actionRowClass()} onClick={() => run({ type: "toggle-mute" })}>
              {menuTab.muted ? (
                <Volume2 className="size-3.5 text-emerald-300" />
              ) : (
                <VolumeX className="size-3.5 text-zinc-400" />
              )}
              {menuTab.muted ? "Unmute tab" : "Mute tab"}
            </button>
            <button role="menuitem" className={actionRowClass()} onClick={() => run({ type: "duplicate" })}>
              <Copy className="size-3.5 text-zinc-400" />
              Duplicate tab
            </button>
            <button
              role="menuitem"
              className={actionRowClass(!canReopen)}
              onClick={() => {
                onReopen();
                closeMenu();
              }}
            >
              <History className="size-3.5 text-zinc-400" />
              Reopen closed tab
              <kbd className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-500">
                Ctrl+Shift+T
              </kbd>
            </button>
            <button role="menuitem" className={actionRowClass()} onClick={() => run({ type: "close" })}>
              <X className="size-3.5 text-zinc-400" />
              Close tab
            </button>
            <button
              role="menuitem"
              className={actionRowClass(tabs.length <= 1)}
              onClick={() => run({ type: "close-others" })}
            >
              <X className="size-3.5 text-zinc-400" />
              Close other tabs
            </button>

            {/* Container section */}
            <div className="mt-1 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Container
            </div>
            <button
              role="menuitemradio"
              aria-checked={menuTab.container === "default"}
              className={actionRowClass()}
              onClick={() => run({ type: "container", container: "default" })}
            >
              <Circle className="size-3.5 text-zinc-500" />
              Default
              {menuTab.container === "default" ? <Check className="ml-auto size-3.5 text-emerald-300" /> : null}
            </button>
            <button
              role="menuitemradio"
              aria-checked={isIncognitoContainer(menuTab.container)}
              className={actionRowClass()}
              title="Ephemeral container — cookies are wiped when its last tab closes"
              onClick={() => run({ type: "container", container: firstFreeIncognito(tabs) })}
            >
              <Ghost className="size-3.5 text-zinc-400" />
              Incognito
              {isIncognitoContainer(menuTab.container) ? (
                <Check className="ml-auto size-3.5 text-emerald-300" />
              ) : null}
            </button>
            {knownContainers.slice(0, 6).map((c) => (
              <button
                key={c}
                role="menuitemradio"
                aria-checked={menuTab.container === c}
                className={actionRowClass()}
                title={`Container: ${c}`}
                onClick={() => run({ type: "container", container: c })}
              >
                <span className={`size-2.5 shrink-0 rounded-full ${containerColor(c)}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{c}</span>
                {menuTab.container === c ? <Check className="size-3.5 shrink-0 text-emerald-300" /> : null}
              </button>
            ))}
            {naming ? (
              <div className="flex min-h-[44px] items-center gap-2 px-3">
                <Tag className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                <input
                  ref={nameInputRef}
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitName();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setNaming(false);
                      setNameVal("");
                    }
                  }}
                  placeholder="container name"
                  aria-label="New container name"
                  maxLength={40}
                  className="h-8 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                />
                <button
                  onClick={submitName}
                  aria-label="Use container"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-200"
                >
                  <Check className="size-3.5" />
                </button>
              </div>
            ) : (
              <button role="menuitem" className={actionRowClass()} onClick={() => setNaming(true)}>
                <Tag className="size-3.5 text-zinc-400" />
                New container…
                <span className="ml-auto text-[9px] text-zinc-600">a-z 0-9 - _</span>
              </button>
            )}
            {menuTab.container !== "default" ? (
              <button
                role="menuitem"
                className={actionRowClass()}
                title="Wipe this container's cookie jars and switch this tab back to Default"
                onClick={() => run({ type: "drop-container", container: menuTab.container })}
              >
                <Trash2 className="size-3.5 text-rose-400" />
                <span className="truncate">
                  Drop <span className="font-medium text-rose-300">{menuTab.container}</span> container
                </span>
              </button>
            ) : null}

            {/* Egress section */}
            <div className="mt-1 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Egress
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {EGRESS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  role="menuitemradio"
                  aria-checked={menuTab.egress === o.value}
                  title={o.title}
                  onClick={() => run({ type: "egress", egress: o.value })}
                  className={`min-h-[36px] rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                    menuTab.egress === o.value
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                      : "border-zinc-700/80 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {/* User-agent section */}
            <div className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              User agent
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {UA_PRESETS.map((p) => {
                const activeUa = menuTab.ua === p.ua;
                return (
                  <button
                    key={p.id}
                    role="menuitemradio"
                    aria-checked={activeUa}
                    title={p.ua ? p.ua : "Use the browser's native User-Agent"}
                    onClick={() => run({ type: "ua", ua: p.ua })}
                    className={`min-h-[36px] rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                      activeUa
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                        : "border-zinc-700/80 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
