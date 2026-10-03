"use client";

/**
 * Veil Math — the Arcade's number rush.
 *
 * Three modes, one keypad:
 *  - SPRINT: 60 seconds, answer as many as you can. Speed + streaks
 *    stack; the level (and question difficulty) climbs every 5 correct.
 *  - SURVIVAL: 3 lives, no mercy. A shrinking timer per question and
 *    ranges that widen every level — one miss or timeout costs a heart.
 *  - ZEN: no clock, no lives — pick the operations, breathe, practice.
 *
 * Everything is typed (digits + minus) on the big keypad or a real
 * keyboard. Best scores per mode live in localStorage
 * ("veil:math:best:<mode>"), streaks catch fire, and every answer
 * flashes its verdict before the next question rolls in.
 *
 * Replaced the Blooks quiz platform at the owner's request.
 */

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Calculator,
  Flame,
  Heart,
  Infinity as InfinityIcon,
  RotateCw,
  Sparkles,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Question engine (pure)                                              */
/* ------------------------------------------------------------------ */

type Mode = "sprint" | "survival" | "zen";
type Op = "add" | "sub" | "mul" | "div" | "mixed";

interface Question {
  text: string;
  answer: number;
  /** difficulty tier the generator used (1+) */
  level: number;
}

function ri(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** One question at a difficulty tier. Integer answers only. */
function makeQuestion(level: number, op: Op): Question {
  const lvl = Math.max(1, Math.min(9, level));
  let a: number, b: number, c: number;
  // The operation actually asked (mixed rolls one of the big four,
  // weighted toward +- early and ×÷ later).
  let kind: Exclude<Op, "mixed"> =
    op === "mixed" ? pick<Exclude<Op, "mixed">>(lvl >= 3 ? ["add", "sub", "mul", "mul", "div"] : ["add", "add", "sub", "mul"]) : op;
  // Escape hatch: zen asks can be "mixed" per-question via op=mixed.

  switch (kind) {
    case "add":
      if (lvl >= 5) {
        // three-term sum
        a = ri(20, 99); b = ri(10, 89); c = ri(10, 89);
        return { text: `${a} + ${b} + ${c}`, answer: a + b + c, level: lvl };
      }
      a = lvl <= 1 ? ri(2, 12) : ri(10, 30 + lvl * 12);
      b = lvl <= 1 ? ri(2, 12) : ri(10, 30 + lvl * 12);
      return { text: `${a} + ${b}`, answer: a + b, level: lvl };
    case "sub":
      a = lvl <= 1 ? ri(4, 15) : ri(20, 60 + lvl * 15);
      b = lvl <= 1 ? ri(2, 9) : ri(10, a);
      // levels 4+ let it dip negative — that's what the ± key is for
      if (lvl >= 4 && Math.random() < 0.3) b = a + ri(1, 9);
      return { text: `${a} − ${b}`, answer: a - b, level: lvl };
    case "mul":
      if (lvl >= 6) {
        // two-digit × one-digit
        a = ri(12, 29 + lvl * 3); b = ri(3, 9);
        return { text: `${a} × ${b}`, answer: a * b, level: lvl };
      }
      if (lvl >= 4 && Math.random() < 0.25) {
        // squares
        a = ri(5, 12 + lvl);
        return { text: `${a}²`, answer: a * a, level: lvl };
      }
      a = ri(2, 6 + lvl * 2); b = ri(2, 9);
      return { text: `${a} × ${b}`, answer: a * b, level: lvl };
    case "div":
      // always exact — b × answer = a
      b = ri(2, 4 + lvl); c = ri(2, 9 + lvl);
      a = b * c;
      return { text: `${a} ÷ ${b}`, answer: c, level: lvl };
  }
}

/* ------------------------------------------------------------------ */
/* Bests                                                               */
/* ------------------------------------------------------------------ */

const BEST_KEY = (m: Mode) => `veil:math:best:${m}`;

function readBest(m: Mode): number | null {
  try {
    const v = window.localStorage.getItem(BEST_KEY(m));
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeBest(m: Mode, score: number): boolean {
  try {
    const prev = readBest(m);
    if (prev != null && prev >= score) return false;
    window.localStorage.setItem(BEST_KEY(m), String(score));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Mode metadata                                                        */
/* ------------------------------------------------------------------ */

const MODES: {
  id: Mode;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  detail: string;
}[] = [
  {
    id: "sprint",
    name: "Sprint",
    icon: Zap,
    blurb: "60 seconds. As many as you can.",
    detail: "Speed and streaks stack the score — difficulty climbs every 5 correct.",
  },
  {
    id: "survival",
    name: "Survival",
    icon: Heart,
    blurb: "3 lives. Escalating pressure.",
    detail: "The timer shrinks and the numbers widen every level. A miss costs a heart.",
  },
  {
    id: "zen",
    name: "Zen",
    icon: InfinityIcon,
    blurb: "No clock. No lives. Just math.",
    detail: "Pick your operations and practice as long as you like — leave whenever.",
  },
];

/* ------------------------------------------------------------------ */
/* The game                                                             */
/* ------------------------------------------------------------------ */

type Phase = "home" | "playing" | "flash" | "over";

interface Verdict {
  ok: boolean;
  answer: number;
  given: number | null;
}

interface Float {
  id: number;
  text: string;
  good: boolean;
}

export function MathGame({ active }: { active: boolean }) {
  const [phase, setPhase] = React.useState<Phase>("home");
  const [mode, setMode] = React.useState<Mode>("sprint");
  const [op, setOp] = React.useState<Op>("mixed");

  // run state
  const [question, setQuestion] = React.useState<Question | null>(null);
  const [input, setInput] = React.useState("");
  const [score, setScore] = React.useState(0);
  const [streak, setStreak] = React.useState(0);
  const [bestStreak, setBestStreak] = React.useState(0);
  const [lives, setLives] = React.useState(3);
  const [answered, setAnswered] = React.useState(0);
  const [correct, setCorrect] = React.useState(0);
  const [lastVerdict, setLastVerdict] = React.useState<Verdict | null>(null);
  const [timeLeft, setTimeLeft] = React.useState(60);
  const [floats, setFloats] = React.useState<Float[]>([]);
  const [newBest, setNewBest] = React.useState(false);
  const [bests, setBests] = React.useState<Record<Mode, number | null>>({ sprint: null, survival: null, zen: null });

  /** difficulty tier — derived from correct answers (every 5 climbs). */
  const level = 1 + Math.floor(correct / 5);

  const floatId = React.useRef(0);
  const opRef = React.useRef<Op>("mixed");
  opRef.current = op;

  React.useEffect(() => {
    setBests({ sprint: readBest("sprint"), survival: readBest("survival"), zen: readBest("zen") });
  }, [phase]);

  const nextQuestion = React.useCallback((lvl: number) => {
    setQuestion(makeQuestion(lvl, mode === "zen" ? opRef.current : "mixed"));
    setInput("");
  }, [mode]);

  const pushFloat = React.useCallback((text: string, good: boolean) => {
    const id = ++floatId.current;
    setFloats((f) => [...f, { id, text, good }]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 950);
  }, []);

  const startRun = React.useCallback(
    (m: Mode) => {
      setMode(m);
      setScore(0);
      setStreak(0);
      setBestStreak(0);
      setLives(3);
      setAnswered(0);
      setCorrect(0);
      setLastVerdict(null);
      setNewBest(false);
      setTimeLeft(m === "sprint" ? 60 : 0);
      setQuestion(makeQuestion(1, m === "zen" ? opRef.current : "mixed"));
      setInput("");
      setPhase("playing");
    },
    []
  );

  /* ---- sprint clock ---- */
  React.useEffect(() => {
    if (phase !== "playing" || mode !== "sprint") return;
    const t = window.setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) {
          setPhase("over");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase, mode]);

  /* ---- survival per-question timer ---- */
  const qTimerMax = React.useMemo(() => Math.max(5, 12 - (level - 1)), [level]);
  const [qTimer, setQTimer] = React.useState(12);
  React.useEffect(() => {
    if (phase !== "playing" || mode !== "survival") return;
    setQTimer(qTimerMax);
    const t = window.setInterval(() => {
      setQTimer((s) => Math.max(0, +(s - 0.1).toFixed(1)));
    }, 100);
    return () => window.clearInterval(t);
  }, [phase, mode, question, qTimerMax]);

  /* timeout = a wrong answer (the resolve below is fresh — its closure
     comes from this render, and the timer only zeroes while a question
     is up). */
  React.useEffect(() => {
    if (phase === "playing" && mode === "survival" && qTimer <= 0) resolveRef.current(null);
  }, [qTimer, phase, mode]);

  /* ---- submit an answer ---- */
  const submit = React.useCallback(() => {
    if (phase !== "playing" || !question) return;
    const given = Number(input);
    if (input === "" || input === "-" || !Number.isFinite(given)) return;
    resolve(given);
  }, [phase, question, input]);

  /** The verdict: everything reads state from THIS render (fresh — the
   *  survival timer captures it at question display, and all updates
   *  are pure functional ones). */
  function resolve(given: number | null) {
    if (!question || phase !== "playing") return;
    const ok = given != null && given === question.answer;
    setAnswered((n) => n + 1);
    setLastVerdict({ ok, answer: question.answer, given });

    if (ok) {
      const streakMult = Math.min(5, 1 + Math.floor((streak + 1) / 3));
      const gain = (10 + level * 2 + (mode === "sprint" ? 4 : 0)) * streakMult;
      setScore((s) => s + gain);
      setStreak(streak + 1);
      setBestStreak(Math.max(bestStreak, streak + 1));
      setCorrect(correct + 1);
      pushFloat(`+${gain}`, true);
      if ((correct + 1) % 5 === 0) pushFloat(`level ${level + 1}`, true);
      setPhase("flash");
    } else {
      setStreak(0);
      pushFloat(given == null ? "time!" : "miss", false);
      if (mode === "survival") {
        const nl = lives - 1;
        setLives(nl);
        if (nl <= 0) {
          window.setTimeout(() => setPhase("over"), 550);
          return; // stay on the reveal; the run ends from here
        }
      }
      setPhase("flash");
    }
  }

  const resolveRef = React.useRef(resolve);
  resolveRef.current = resolve;

  /* ---- flash → next question ---- */
  const flashOk = lastVerdict?.ok ?? false;
  React.useEffect(() => {
    if (phase !== "flash") return;
    const showFor = flashOk ? 420 : 900; // see the right answer before it's gone
    const t = window.setTimeout(() => {
      if (mode === "survival" && lives <= 0) {
        setPhase("over");
        return;
      }
      nextQuestion(level);
      setPhase("playing");
    }, showFor);
    return () => window.clearTimeout(t);
  }, [phase, flashOk, mode, lives, level, nextQuestion]);
  /* ---- end-of-run best bookkeeping ---- */
  React.useEffect(() => {
    if (phase !== "over") return;
    if (mode === "zen") return; // zen has no score
    setNewBest(writeBest(mode, score));
    setBests({ sprint: readBest("sprint"), survival: readBest("survival"), zen: readBest("zen") });
  }, [phase, mode, score]);

  /* ---- physical keyboard ---- */
  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (phase === "home" || phase === "over") {
        if (e.key === "Enter") {
          e.preventDefault();
          if (phase === "over") startRun(mode);
        }
        return;
      }
      if (phase === "playing") {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          setInput((s) => (s.replace("-", "").length >= 7 ? s : s + e.key));
        } else if (e.key === "-") {
          e.preventDefault();
          setInput((s) => (s.startsWith("-") ? s.slice(1) : "-" + s));
        } else if (e.key === "Backspace") {
          e.preventDefault();
          setInput((s) => s.slice(0, -1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, phase, mode, submit, startRun]);

  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
  const streakOnFire = streak >= 3;
  const sprintFrac = mode === "sprint" ? timeLeft / 60 : 1;
  const survivalFrac = mode === "survival" && phase === "playing" ? qTimer / qTimerMax : 1;

  /* ================================================================== */
  /* HOME                                                               */
  /* ================================================================== */
  if (phase === "home" || phase === "over") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        {phase === "over" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">
                  {mode === "zen" ? "session over" : "run over"}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-50">
                  {mode === "zen" ? `${correct} correct` : score.toLocaleString()}
                  {mode !== "zen" && <span className="ml-1 text-base font-medium text-zinc-400">pts</span>}
                </p>
                {newBest && mode !== "zen" && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-300">
                    <Trophy aria-hidden className="size-3.5" />
                    new personal best for {MODES.find((m) => m.id === mode)?.name}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                {[
                  { k: "answered", v: answered },
                  { k: "accuracy", v: `${accuracy}%` },
                  { k: "best streak", v: bestStreak },
                  { k: "level", v: level },
                ].map((s) => (
                  <div key={s.k} className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    <p className="text-lg font-bold tabular-nums text-zinc-100">{s.v}</p>
                    <p className="text-[10.5px] uppercase tracking-wider text-zinc-500">{s.k}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startRun(mode)}
                className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-[13.5px] font-semibold text-emerald-950 transition hover:bg-emerald-400"
              >
                <RotateCw aria-hidden className="size-4" />
                run it back
              </button>
              <button
                type="button"
                onClick={() => setPhase("home")}
                className="flex h-10 items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-5 text-[13.5px] font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                <ArrowLeft aria-hidden className="size-4" />
                change mode
              </button>
            </div>
          </motion.div>
        )}

        {/* title */}
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Calculator aria-hidden className="size-5.5 text-emerald-300" />
          </span>
          <div>
            <h2 className="text-[19px] font-semibold tracking-tight text-zinc-50">
              Veil Math<span className="text-emerald-400">.</span>
            </h2>
            <p className="text-[12.5px] text-zinc-400">
              the number rush — three modes, one keypad, zero mercy
            </p>
          </div>
        </div>

        {/* modes */}
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((m) => {
            const Icon = m.icon;
            const best = bests[m.id];
            return (
              <motion.button
                key={m.id}
                type="button"
                whileHover={{ y: -3 }}
                onClick={() => startRun(m.id)}
                className="group flex flex-col rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-4 text-left transition hover:border-emerald-500/40 hover:bg-zinc-900"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <p className="mt-3 text-[15px] font-semibold text-zinc-50">
                  {m.name}
                  {best != null && (
                    <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 align-middle text-[10.5px] font-bold tabular-nums text-amber-300">
                      best {best.toLocaleString()}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[12px] font-medium text-zinc-300">{m.blurb}</p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-zinc-500">{m.detail}</p>
                <p className="mt-3 text-[11.5px] font-semibold text-emerald-300/0 transition group-hover:text-emerald-300/90">
                  start →
                </p>
              </motion.button>
            );
          })}
        </div>

        {/* zen operations picker */}
        <div className="mt-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-4">
          <p className="text-[12.5px] font-medium text-zinc-300">
            Zen operations <span className="text-zinc-500">— what practice serves you</span>
          </p>
          <div role="radiogroup" aria-label="Zen operations" className="mt-2.5 flex flex-wrap gap-2">
            {(
              [
                { id: "mixed", label: "mixed" },
                { id: "add", label: "+" },
                { id: "sub", label: "−" },
                { id: "mul", label: "×" },
                { id: "div", label: "÷" },
              ] as { id: Op; label: string }[]
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={op === o.id}
                onClick={() => setOp(o.id)}
                className={cn(
                  "h-8 min-w-9 rounded-lg px-3 text-[13px] font-semibold transition",
                  op === o.id
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "bg-zinc-950/70 text-zinc-400 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-200"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-zinc-500">
            Sprint and Survival always mix everything — the difficulty does the talking.
          </p>
        </div>
      </div>
    );
  }

  /* ================================================================== */
  /* PLAYING / FLASH                                                    */
  /* ================================================================== */
  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col px-4 py-4 sm:px-6">
      {/* HUD */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPhase(mode === "zen" ? "over" : "over")}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          end
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {mode === "survival" && (
            <span className="flex items-center gap-1" role="img" aria-label={`${lives} lives left`}>
              {[0, 1, 2].map((i) => (
                <Heart
                  key={i}
                  aria-hidden
                  className={cn("size-4 transition", i < lives ? "fill-rose-400 text-rose-400" : "text-zinc-700")}
                />
              ))}
            </span>
          )}
          {streak >= 2 && (
            <motion.span
              key={streak}
              initial={{ scale: 1.25 }}
              animate={{ scale: 1 }}
              className={cn(
                "flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-bold",
                streakOnFire
                  ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
                  : "bg-zinc-800/80 text-zinc-300"
              )}
            >
              {streakOnFire && <Flame aria-hidden className="size-3 animate-pulse" />}
              {streak}×
            </motion.span>
          )}
          {mode !== "zen" && (
            <span className="flex h-7 items-center rounded-full bg-zinc-800/80 px-2.5 text-[12px] font-bold tabular-nums text-zinc-100">
              {score.toLocaleString()}
            </span>
          )}
          <span className="flex h-7 items-center rounded-full bg-emerald-500/10 px-2.5 text-[11.5px] font-semibold text-emerald-300 ring-1 ring-emerald-500/25">
            lvl {level}
          </span>
        </div>
      </div>

      {/* clock */}
      {mode === "sprint" && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800/80" role="progressbar" aria-label="Sprint clock" aria-valuenow={timeLeft} aria-valuemin={0} aria-valuemax={60}>
          <motion.div
            className={cn(
              "h-full rounded-full",
              timeLeft > 20 ? "bg-emerald-400" : timeLeft > 8 ? "bg-amber-400" : "bg-rose-400"
            )}
            animate={{ width: `${sprintFrac * 100}%` }}
            transition={{ duration: 0.25, ease: "linear" }}
          />
        </div>
      )}
      {mode === "sprint" && (
        <p className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-zinc-500">
          <span className="flex items-center gap-1">
            <Timer aria-hidden className="size-3" />
            {timeLeft}s left
          </span>
          <span>{correct} correct · {accuracy}%</span>
        </p>
      )}

      {/* the question */}
      <div className="relative mt-6 flex flex-1 flex-col items-center justify-center">
        {/* floating verdicts */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-6 z-10 flex flex-col items-center">
          <AnimatePresence>
            {floats.map((f) => (
              <motion.span
                key={f.id}
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: -18, scale: 1 }}
                exit={{ opacity: 0, y: -30 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
                className={cn(
                  "text-2xl font-black tabular-nums drop-shadow",
                  f.good ? "text-emerald-300" : "text-rose-400"
                )}
              >
                {f.text}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        {question && (
          <motion.div
            key={question.text + answered}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "w-full rounded-3xl border p-8 text-center transition-colors",
              phase === "flash"
                ? flashOk
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-rose-500/50 bg-rose-500/10"
                : "border-zinc-800/80 bg-zinc-900/50"
            )}
            role="group"
            aria-label={`Solve: ${question.text}`}
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-widest text-zinc-500">
              {mode === "zen" ? "zen · take your time" : `level ${question.level}`}
            </p>
            <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-zinc-50 sm:text-5xl">
              {question.text}
            </p>

            {/* survival per-question clock */}
            {mode === "survival" && phase === "playing" && (
              <div className="mx-auto mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label="Question timer" aria-valuenow={Math.round(qTimer)} aria-valuemin={0} aria-valuemax={qTimerMax}>
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-100 ease-linear",
                    survivalFrac > 0.5 ? "bg-emerald-400" : survivalFrac > 0.25 ? "bg-amber-400" : "bg-rose-400"
                  )}
                  style={{ width: `${survivalFrac * 100}%` }}
                />
              </div>
            )}

            {/* the answer display */}
            <div className="mt-5 flex min-h-16 items-center justify-center">
              <motion.span
                key={input + phase}
                initial={false}
                animate={
                  phase === "flash" && !flashOk
                    ? { x: [0, -7, 7, -5, 5, 0] }
                    : {}
                }
                transition={{ duration: 0.35 }}
                aria-live="polite"
                className={cn(
                  "min-w-24 rounded-2xl border px-5 py-2.5 font-mono text-3xl font-bold tabular-nums",
                  phase === "flash"
                    ? flashOk
                      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                      : "border-rose-500/50 bg-rose-500/10 text-rose-300"
                    : "border-zinc-700 bg-zinc-950/70 text-zinc-50"
                )}
              >
                {phase === "flash" && !flashOk && input === "" ? "—" : input || "0"}
              </motion.span>
            </div>

            {/* verdict strip */}
            {phase === "flash" && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={cn(
                  "mt-4 text-[13px] font-medium",
                  flashOk ? "text-emerald-300" : "text-rose-300"
                )}
              >
                {flashOk ? (
                    <span className="inline-flex items-center gap-1.5">
                    <Sparkles aria-hidden className="size-3.5" /> correct{streak >= 3 ? " — you're on fire" : ""}
                  </span>
                ) : (
                  <>
                    {lastVerdict?.given != null ? `${lastVerdict.given} — nope · ` : "time! · "}
                    it was <span className="font-bold tabular-nums">{question.answer}</span>
                  </>
                )}
              </motion.p>
            )}
          </motion.div>
        )}
      </div>

      {/* keypad */}
      <div className="mt-5 grid grid-cols-5 gap-2 sm:gap-2.5">
        {["7", "8", "9"].map((d) => key(d))}
        <button key="neg" type="button" onClick={() => setInput((s) => (s.startsWith("-") ? s.slice(1) : "-" + s))} aria-label="Toggle negative" className="h-12 rounded-2xl border border-zinc-800 bg-zinc-900/60 text-lg font-semibold text-zinc-300 transition hover:bg-zinc-800 active:scale-95 sm:h-14">
          ±
        </button>
        <button key="back" type="button" onClick={() => setInput((s) => s.slice(0, -1))} aria-label="Backspace" className="h-12 rounded-2xl border border-zinc-800 bg-zinc-900/60 text-lg font-semibold text-zinc-300 transition hover:bg-zinc-800 active:scale-95 sm:h-14">
          ⌫
        </button>

        {["4", "5", "6"].map((d) => key(d))}
        <button
          key="enter"
          type="button"
          onClick={submit}
          aria-label="Submit answer"
          className="col-span-2 h-12 rounded-2xl bg-emerald-500 text-lg font-bold text-emerald-950 transition hover:bg-emerald-400 active:scale-95 sm:h-14"
        >
          ↵
        </button>

        {["1", "2", "3"].map((d) => key(d))}
        <button key="zero" type="button" onClick={() => setInput((s) => (s.replace("-", "").length >= 7 ? s : s + "0"))} aria-label="0" className="col-span-2 h-12 rounded-2xl border border-zinc-800 bg-zinc-900/60 text-lg font-semibold text-zinc-100 transition hover:bg-zinc-800 active:scale-95 sm:h-14">
          0
        </button>

        <button key="c" type="button" onClick={() => setInput("")} aria-label="Clear" className="col-span-2 h-12 rounded-2xl border border-zinc-800 bg-zinc-900/60 text-[13px] font-semibold text-zinc-300 transition hover:bg-zinc-800 active:scale-95 sm:h-14">
          clear
        </button>
        <p className="col-span-3 self-center text-center text-[11px] leading-snug text-zinc-600">
          or just type — digits, minus, Backspace, Enter
        </p>
      </div>
    </div>
  );

  function key(d: string) {
    return (
      <button
        key={d}
        type="button"
        onClick={() => setInput((s) => (s.replace("-", "").length >= 7 ? s : s + d))}
        aria-label={d}
        className="h-12 rounded-2xl border border-zinc-800 bg-zinc-900/60 text-lg font-semibold tabular-nums text-zinc-100 transition hover:bg-zinc-800 active:scale-95 sm:h-14"
      >
        {d}
      </button>
    );
  }
}
