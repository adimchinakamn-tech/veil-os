"use client";

/**
 * GN-Math — a 60-second mental-math trainer built into Veil Arcade.
 *
 * Deliberately its own visual world, distinct from the rest of Veil
 * (which is dark zinc + emerald): a deep "graph paper" backdrop with
 * faint amber grid lines, oversized monospace numerals, a big custom
 * keypad, and an amber + emerald accent pair. No indigo, no blue.
 *
 * Modes: addition / subtraction / multiplication / division / mixed.
 * Difficulty scales the number ranges (division always resolves to a
 * whole number, subtraction never goes negative).
 * High scores persist in localStorage per mode + difficulty.
 */

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  CornerDownLeft,
  Delete,
  Play,
  RotateCcw,
  Trophy,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types & tuning                                                      */
/* ------------------------------------------------------------------ */

type Mode = "add" | "sub" | "mul" | "div" | "mixed";
type Diff = "easy" | "normal" | "hard";

const ROUND_MS = 60_000;
const MAX_INPUT_LEN = 7;

const MODES: { id: Mode; label: string; symbol: string }[] = [
  { id: "add", label: "Addition", symbol: "+" },
  { id: "sub", label: "Subtraction", symbol: "−" },
  { id: "mul", label: "Multiplication", symbol: "×" },
  { id: "div", label: "Division", symbol: "÷" },
  { id: "mixed", label: "Mixed", symbol: "±×÷" },
];

const DIFFS: { id: Diff; label: string; base: number; hint: string }[] = [
  { id: "easy", label: "Easy", base: 10, hint: "warm-up ranges" },
  { id: "normal", label: "Normal", base: 20, hint: "standard ranges" },
  { id: "hard", label: "Hard", base: 30, hint: "big-number ranges" },
];

interface Question {
  a: number;
  b: number;
  op: string;
  answer: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeQuestion(mode: Mode, diff: Diff): Question {
  const actual: Exclude<Mode, "mixed"> =
    mode === "mixed"
      ? (["add", "sub", "mul", "div"] as const)[randInt(0, 3)]
      : mode;

  switch (actual) {
    case "add": {
      const max = diff === "easy" ? 20 : diff === "normal" ? 99 : 999;
      const a = randInt(1, max);
      const b = randInt(1, max);
      return { a, b, op: "+", answer: a + b };
    }
    case "sub": {
      const max = diff === "easy" ? 20 : diff === "normal" ? 99 : 999;
      let a = randInt(1, max);
      let b = randInt(1, max);
      if (b > a) [a, b] = [b, a]; // never negative
      return { a, b, op: "−", answer: a - b };
    }
    case "mul": {
      const [min, max] =
        diff === "easy" ? [1, 10] : diff === "normal" ? [2, 12] : [6, 25];
      const a = randInt(min, max);
      const b = randInt(min, max);
      return { a, b, op: "×", answer: a * b };
    }
    case "div": {
      const [min, max] =
        diff === "easy" ? [2, 9] : diff === "normal" ? [2, 12] : [3, 20];
      const b = randInt(min, max);
      const q = randInt(min, max);
      return { a: b * q, b, op: "÷", answer: q };
    }
  }
}

function diffBase(diff: Diff): number {
  return DIFFS.find((d) => d.id === diff)?.base ?? 20;
}

function hsKey(mode: Mode, diff: Diff): string {
  return `veil:gn-math:hs:${mode}:${diff}`;
}

function readHighScore(mode: Mode, diff: Diff): number {
  try {
    return Number(localStorage.getItem(hsKey(mode, diff)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeHighScore(mode: Mode, diff: Diff, score: number): void {
  try {
    localStorage.setItem(hsKey(mode, diff), String(score));
  } catch {
    /* storage unavailable — scores just won't persist */
  }
}

/* ------------------------------------------------------------------ */
/* Local styles — the graph-paper identity                             */
/* ------------------------------------------------------------------ */

const GNM_CSS = `
.gnm-root {
  background-color: #0a0907;
  background-image:
    linear-gradient(rgba(245, 158, 11, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 158, 11, 0.05) 1px, transparent 1px),
    linear-gradient(rgba(245, 158, 11, 0.09) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 158, 11, 0.09) 1px, transparent 1px);
  background-size: 26px 26px, 26px 26px, 130px 130px, 130px 130px;
}
.gnm-vignette {
  background:
    radial-gradient(ellipse at 50% 28%, rgba(255, 251, 235, 0.03), transparent 55%),
    radial-gradient(ellipse at 50% 115%, rgba(0, 0, 0, 0.55), transparent 65%);
}
@keyframes gnm-shake {
  10%, 90% { transform: translateX(-2px); }
  20%, 80% { transform: translateX(4px); }
  30%, 50%, 70% { transform: translateX(-6px); }
  40%, 60% { transform: translateX(6px); }
}
.gnm-shake { animation: gnm-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
@keyframes gnm-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.gnm-urgent { animation: gnm-pulse 1s ease-in-out infinite; }
@keyframes gnm-caret {
  0%, 45% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.gnm-caret { animation: gnm-caret 1.1s step-end infinite; }
@media (prefers-reduced-motion: reduce) {
  .gnm-shake, .gnm-urgent, .gnm-caret { animation: none; }
}
`;

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function TimerRing({ timeLeftMs, urgent }: { timeLeftMs: number; urgent: boolean }) {
  const R = 25;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, timeLeftMs / ROUND_MS));
  const seconds = Math.ceil(timeLeftMs / 1000);
  return (
    <div className={cn("relative", urgent && "gnm-urgent")}>
      <svg viewBox="0 0 60 60" className="size-12 sm:size-14" role="img" aria-label={`${seconds} seconds left`}>
        <circle
          cx="30" cy="30" r={R} fill="none"
          stroke="rgba(255,255,255,0.09)" strokeWidth="5"
        />
        <circle
          cx="30" cy="30" r={R} fill="none"
          stroke={urgent ? "#fbbf24" : "#34d399"}
          strokeWidth="5" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          transform="rotate(-90 30 30)"
          style={{ transition: "stroke-dashoffset 0.25s linear" }}
        />
        <text
          x="30" y="31" textAnchor="middle" dominantBaseline="central"
          fontSize="17" fontFamily="ui-monospace, monospace"
          className={urgent ? "fill-amber-300" : "fill-zinc-200"}
        >
          {seconds}
        </text>
      </svg>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "amber" | "emerald" | "zinc";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5",
        tone === "amber" && "border-amber-500/25 bg-amber-500/5",
        tone === "emerald" && "border-emerald-500/25 bg-emerald-500/5",
        tone === "zinc" && "border-zinc-700/70 bg-zinc-900/60"
      )}
    >
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.16em]",
          tone === "amber" && "text-amber-400",
          tone === "emerald" && "text-emerald-400",
          tone === "zinc" && "text-zinc-400"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-base font-bold tabular-nums sm:text-lg",
          tone === "amber" && "text-amber-300",
          tone === "emerald" && "text-emerald-300",
          tone === "zinc" && "text-zinc-300"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The trainer                                                         */
/* ------------------------------------------------------------------ */

export function GnMath() {
  const [phase, setPhase] = React.useState<"menu" | "playing" | "over">("menu");
  const [mode, setMode] = React.useState<Mode>("add");
  const [diff, setDiff] = React.useState<Diff>("normal");

  const [question, setQuestion] = React.useState<Question | null>(null);
  const [qIndex, setQIndex] = React.useState(0);
  const [input, setInput] = React.useState("");
  const [feedback, setFeedback] = React.useState<{
    ok: boolean;
    answer: number;
    points: number;
  } | null>(null);

  const [timeLeftMs, setTimeLeftMs] = React.useState(ROUND_MS);
  const [score, setScore] = React.useState(0);
  const [streak, setStreak] = React.useState(0);
  const [bestStreak, setBestStreak] = React.useState(0);
  const [answered, setAnswered] = React.useState(0);
  const [correct, setCorrect] = React.useState(0);
  const [highScore, setHighScore] = React.useState(0);
  const [newBest, setNewBest] = React.useState(false);

  const phaseRef = React.useRef(phase);
  const endsAtRef = React.useRef(0);
  const advanceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const playAreaRef = React.useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /* Load the persisted high score for the current combo. */
  React.useEffect(() => {
    setHighScore(readHighScore(mode, diff));
  }, [mode, diff]);

  /* Cleanup the auto-advance timer on unmount. */
  React.useEffect(() => {
    return () => {
      if (advanceRef.current) clearTimeout(advanceRef.current);
    };
  }, []);

  const startRound = React.useCallback(() => {
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setAnswered(0);
    setCorrect(0);
    setInput("");
    setFeedback(null);
    setNewBest(false);
    setQuestion(makeQuestion(mode, diff));
    setQIndex(1);
    endsAtRef.current = Date.now() + ROUND_MS;
    setTimeLeftMs(ROUND_MS);
    setPhase("playing");
  }, [mode, diff]);

  const endRound = React.useCallback(() => {
    if (phaseRef.current !== "playing") return;
    if (advanceRef.current) {
      clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    const prev = readHighScore(mode, diff);
    if (score > prev && score > 0) {
      writeHighScore(mode, diff, score);
      setNewBest(true);
    } else {
      setNewBest(false);
    }
    setHighScore(Math.max(prev, score));
    setPhase("over");
  }, [mode, diff, score]);

  /* 60-second countdown while playing. */
  React.useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      setTimeLeftMs(Math.max(0, endsAtRef.current - Date.now()));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  React.useEffect(() => {
    if (phase === "playing" && timeLeftMs <= 0) endRound();
  }, [timeLeftMs, phase, endRound]);

  /* Focus the play area when a round starts. */
  React.useEffect(() => {
    if (phase === "playing") playAreaRef.current?.focus();
  }, [phase]);

  const pressDigit = React.useCallback(
    (d: string) => {
      if (phaseRef.current !== "playing" || feedback) return;
      setInput((i) => (i.length >= MAX_INPUT_LEN ? i : i + d));
    },
    [feedback]
  );

  const backspace = React.useCallback(() => {
    if (phaseRef.current !== "playing" || feedback) return;
    setInput((i) => i.slice(0, -1));
  }, [feedback]);

  const submit = React.useCallback(() => {
    if (phaseRef.current !== "playing" || !question || feedback) return;
    if (input.length === 0) return;
    const ok = Number(input) === question.answer;
    setAnswered((n) => n + 1);

    if (ok) {
      const multiplier = 1 + Math.min(streak, 20) * 0.05;
      const pts = Math.round(diffBase(diff) * multiplier);
      const nextStreak = streak + 1;
      setCorrect((c) => c + 1);
      setBestStreak((b) => Math.max(b, nextStreak));
      setScore((s) => s + pts);
      setStreak(nextStreak);
      setFeedback({ ok: true, answer: question.answer, points: pts });
    } else {
      setStreak(0);
      setFeedback({ ok: false, answer: question.answer, points: 0 });
    }

    /* Auto-advance: quickly on a hit, linger on a miss so the right
       answer can be read. */
    advanceRef.current = setTimeout(
      () => {
        advanceRef.current = null;
        setFeedback(null);
        setInput("");
        setQuestion(makeQuestion(mode, diff));
        setQIndex((n) => n + 1);
      },
      ok ? 350 : 900
    );
  }, [question, feedback, input, streak, mode, diff]);

  /* Physical keyboard: digits, Backspace, Enter. */
  React.useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        pressDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pressDigit, backspace, submit]);

  const currentMode = MODES.find((m) => m.id === mode);
  const currentDiff = DIFFS.find((d) => d.id === diff);
  const urgent = phase === "playing" && timeLeftMs < 10_000;
  const accuracy =
    answered > 0 ? Math.round((correct / answered) * 100) : 0;

  /* ---------------------------------------------------------------- */

  return (
    <div className="gnm-root relative flex h-full w-full flex-col overflow-hidden font-sans text-zinc-100">
      <style>{GNM_CSS}</style>
      <div aria-hidden className="gnm-vignette pointer-events-none absolute inset-0" />

      {/* top bar */}
      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-amber-500/10 bg-black/40 px-4 py-2.5 backdrop-blur-sm">
        <span className="font-mono text-sm font-black tracking-[0.22em] text-amber-400">
          GN·MATH
        </span>
        <span className="hidden text-xs text-zinc-500 sm:inline">
          mental math trainer
        </span>
        <span
          aria-hidden
          className="ml-1 hidden font-mono text-xs text-zinc-600 md:inline"
        >
          {currentMode?.symbol} · {currentDiff?.label.toLowerCase()}
        </span>
        {phase === "playing" && (
          <button
            type="button"
            onClick={endRound}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700/70 px-3 text-xs font-medium text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80"
          >
            <X className="size-3.5" aria-hidden />
            End round
          </button>
        )}
      </header>

      {/* ---------------- menu ---------------- */}
      {phase === "menu" && (
        <div className="veil-scroll-slim relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:py-8">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-auto w-full max-w-2xl space-y-7"
          >
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-500/80">
                60-second drill
              </p>
              <p className="mt-1.5 text-sm text-zinc-400">
                Answer as many as you can. Streaks multiply your points.
              </p>
            </div>

            <section aria-labelledby="gnm-mode-heading">
              <h2
                id="gnm-mode-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500"
              >
                Operation
              </h2>
              <div
                role="radiogroup"
                aria-labelledby="gnm-mode-heading"
                className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5"
              >
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => setMode(m.id)}
                    className={cn(
                      "rounded-xl border p-3 text-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80",
                      mode === m.id
                        ? "border-amber-400 bg-amber-400/10 shadow-[0_0_24px_-8px_rgba(251,191,36,0.6)]"
                        : "border-zinc-700/60 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-900"
                    )}
                  >
                    <span className="block font-mono text-2xl font-bold leading-tight text-zinc-100">
                      {m.symbol}
                    </span>
                    <span className="mt-1 block text-xs font-medium text-zinc-400">
                      {m.label}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section aria-labelledby="gnm-diff-heading">
              <h2
                id="gnm-diff-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500"
              >
                Difficulty
              </h2>
              <div
                role="radiogroup"
                aria-labelledby="gnm-diff-heading"
                className="mt-3 grid grid-cols-3 gap-2"
              >
                {DIFFS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={diff === d.id}
                    onClick={() => setDiff(d.id)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80",
                      diff === d.id
                        ? "border-amber-400 bg-amber-400/10 shadow-[0_0_24px_-8px_rgba(251,191,36,0.6)]"
                        : "border-zinc-700/60 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-900"
                    )}
                  >
                    <span className="block text-sm font-semibold text-zinc-100">
                      {d.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-zinc-500">
                      {d.hint}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <div className="flex flex-col items-center gap-4 pt-1">
              {highScore > 0 && (
                <p className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                  <Trophy className="size-3.5 text-amber-400/80" aria-hidden />
                  Personal best for this setup:
                  <span className="font-mono font-bold tabular-nums text-amber-300">
                    {highScore.toLocaleString()}
                  </span>
                </p>
              )}
              <button
                type="button"
                onClick={startRound}
                className="inline-flex h-12 items-center gap-2.5 rounded-full bg-amber-400 px-8 font-semibold text-zinc-950 shadow-[0_0_36px_-10px_rgba(251,191,36,0.8)] transition-all duration-150 hover:bg-amber-300 hover:shadow-[0_0_44px_-8px_rgba(251,191,36,0.9)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                <Play className="size-4" aria-hidden />
                Start the drill
              </button>
              <p className="text-[11px] text-zinc-600">
                Keypad or keyboard — Enter submits, Backspace edits.
              </p>
            </div>
          </motion.div>
        </div>
      )}

      {/* ---------------- playing ---------------- */}
      {phase === "playing" && question && (
        <div
          ref={playAreaRef}
          tabIndex={-1}
          aria-label="GN-Math round in progress"
          className="relative z-10 flex min-h-0 flex-1 flex-col outline-none lg:flex-row lg:items-center lg:justify-center lg:gap-14"
        >
          {/* stats strip */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2.5 px-4 pt-4 sm:gap-4">
            <StatChip label="Score" value={score} tone="amber" />
            <StatChip
              label="Streak"
              value={streak}
              tone={streak >= 3 ? "emerald" : "zinc"}
            />
            <TimerRing timeLeftMs={timeLeftMs} urgent={urgent} />
          </div>

          {/* question + answer */}
          <div className="veil-scroll-slim flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-4 py-4 text-center sm:gap-6">
            <motion.div
              key={qIndex}
              initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              aria-live="polite"
              className="select-none font-mono text-5xl font-black tabular-nums leading-none tracking-tight text-zinc-50 sm:text-6xl lg:text-7xl"
              style={{ textShadow: "0 2px 24px rgba(0,0,0,0.6)" }}
            >
              {question.a}
              <span className="mx-3 text-amber-400 sm:mx-4">
                {question.op}
              </span>
              {question.b}
            </motion.div>

            <div className="relative h-3 w-40 sm:w-56" aria-hidden>
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
            </div>

            {/* answer box */}
            <div
              className={cn(
                "flex h-16 min-w-[9rem] items-center justify-center rounded-2xl border-2 px-7 font-mono text-4xl font-bold tabular-nums sm:h-20 sm:text-5xl",
                feedback
                  ? feedback.ok
                    ? "border-emerald-400 text-emerald-300"
                    : "gnm-shake border-amber-500 text-amber-300"
                  : "border-zinc-700/80 bg-black/30 text-zinc-100"
              )}
              aria-label="Your answer"
            >
              {feedback && !feedback.ok ? feedback.answer : input}
              {!feedback && (
                <span
                  className="gnm-caret ml-1 inline-block h-8 w-[3px] bg-amber-400/80 sm:h-10"
                  aria-hidden
                />
              )}
            </div>

            {/* feedback line */}
            <p
              aria-live="assertive"
              className="flex h-7 items-center justify-center text-sm font-medium"
            >
              {feedback ? (
                feedback.ok ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-300">
                    {reduceMotion ? (
                      <span className="font-mono font-bold">
                        +{feedback.points}
                      </span>
                    ) : (
                      <motion.span
                        initial={{ opacity: 1, y: 0 }}
                        animate={{ opacity: 0, y: -22 }}
                        transition={{ duration: 0.7, ease: "easeOut" }}
                        className="font-mono font-bold"
                      >
                        +{feedback.points}
                      </motion.span>
                    )}
                    Correct
                  </span>
                ) : (
                  <span className="text-amber-300">
                    Answer: <span className="font-mono font-bold">{feedback.answer}</span>
                  </span>
                )
              ) : (
                <span className="text-zinc-600">
                  {input.length > 0 ? "Enter to submit" : "Type your answer"}
                </span>
              )}
            </p>
          </div>

          {/* keypad */}
          <div className="shrink-0 px-4 pb-4 sm:pb-6 lg:pb-0">
            <div
              role="group"
              aria-label="Answer keypad"
              className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2 sm:gap-2.5 lg:w-72"
            >
              {(
                [
                  "7",
                  "8",
                  "9",
                  "4",
                  "5",
                  "6",
                  "1",
                  "2",
                  "3",
                  "back",
                  "0",
                  "submit",
                ] as const
              ).map((key) => {
                if (key === "back") {
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={backspace}
                      aria-label="Backspace"
                      className="flex h-14 items-center justify-center rounded-xl border border-zinc-700/60 bg-zinc-900/70 text-amber-400/90 transition-all duration-100 hover:border-amber-500/50 hover:bg-zinc-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 sm:h-16"
                    >
                      <Delete className="size-5 sm:size-6" aria-hidden />
                    </button>
                  );
                }
                if (key === "submit") {
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={submit}
                      aria-label="Submit answer"
                      className="flex h-14 items-center justify-center rounded-xl border border-emerald-400 bg-emerald-500 text-zinc-950 shadow-[0_0_26px_-8px_rgba(52,211,153,0.7)] transition-all duration-100 hover:bg-emerald-400 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 sm:h-16"
                    >
                      <CornerDownLeft className="size-5 sm:size-6" aria-hidden />
                    </button>
                  );
                }
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pressDigit(key)}
                    aria-label={key}
                    className="flex h-14 items-center justify-center rounded-xl border border-zinc-700/60 bg-zinc-900/70 font-mono text-xl font-bold text-zinc-100 transition-all duration-100 hover:border-amber-500/50 hover:bg-zinc-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 sm:h-16 sm:text-2xl"
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- round over ---------------- */}
      {phase === "over" && (
        <div className="veil-scroll-slim relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-8">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-auto max-w-md text-center"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
              Round complete
            </p>
            <p
              className="mt-3 font-mono text-6xl font-black tabular-nums text-amber-300"
              style={{ textShadow: "0 0 44px rgba(251,191,36,0.35)" }}
            >
              {score.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-zinc-500">points</p>

            {newBest && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
                <Trophy className="size-3.5" aria-hidden />
                New high score
              </p>
            )}

            <dl className="mt-6 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-2 py-3">
                <dt className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                  Best streak
                </dt>
                <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-300">
                  {bestStreak}
                </dd>
              </div>
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-2 py-3">
                <dt className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                  Accuracy
                </dt>
                <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-100">
                  {accuracy}%
                </dd>
              </div>
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-2 py-3">
                <dt className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                  Answered
                </dt>
                <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-100">
                  {answered}
                </dd>
              </div>
            </dl>

            <p className="mt-5 text-xs text-zinc-500">
              {currentMode?.label} · {currentDiff?.label} — best{" "}
              <span className="font-mono font-bold tabular-nums text-amber-300">
                {highScore.toLocaleString()}
              </span>
            </p>

            <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={startRound}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-amber-400 px-6 font-semibold text-zinc-950 shadow-[0_0_30px_-10px_rgba(251,191,36,0.8)] transition-all duration-150 hover:bg-amber-300 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:w-auto"
              >
                <RotateCcw className="size-4" aria-hidden />
                Play again
              </button>
              <button
                type="button"
                onClick={() => setPhase("menu")}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-zinc-700/70 px-6 font-medium text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 sm:w-auto"
              >
                <ChevronLeft className="size-4" aria-hidden />
                Change mode
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
