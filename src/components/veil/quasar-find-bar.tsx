"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FindBarProps {
  query: string;
  /** Total matches reported by the frame's find-result message. */
  count: number;
  /** 1-based current match index (approximated client-side). */
  index: number;
  /** Whether the last navigation found a match (styles the input when not). */
  found: boolean;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/**
 * Quasar v2.1.0 — compact find-in-page bar floating over the Veil browsing
 * overlay. The actual search runs inside the proxied document (window.find
 * via the injected engine hooks); this bar only mirrors the protocol:
 * query changes / next / prev are posted into the frame, match counts come
 * back as find-result messages (see quasar hooks find relay).
 */
export function FindBar({ query, count, index, found, onQueryChange, onNext, onPrev, onClose }: FindBarProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      role="search"
      aria-label="Find in page"
      className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900/95 px-1.5 py-1 shadow-xl backdrop-blur"
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        placeholder="Find in page…"
        aria-label="Find in page"
        autoComplete="off"
        spellCheck={false}
        className={`h-8 w-40 border-zinc-700 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50 sm:w-52 ${
          query && !found ? "border-rose-500/60" : ""
        }`}
      />
      <span
        aria-live="polite"
        className={`w-12 shrink-0 select-none text-center text-[11px] tabular-nums ${
          query && count === 0 ? "text-rose-300" : "text-zinc-400"
        }`}
      >
        {query ? (count > 0 ? `${Math.min(Math.max(index, 1), count)}/${count}` : "0/0") : ""}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onPrev}
        disabled={count === 0}
        aria-label="Previous match"
        className="size-8 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onNext}
        disabled={count === 0}
        aria-label="Next match"
        className="size-8 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close find bar"
        className="size-8 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
