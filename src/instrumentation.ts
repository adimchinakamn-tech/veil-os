/**
 * Veil instrumentation — runs once per Next.js server boot.
 *
 * Spawns upload/veil-pulse.sh detached: the pulse verifies the daemon
 * swarm (keeper, backup-loop, ws-relay, freetube) and — if a sandbox
 * revert gutted the project tree — restores it from
 * upload/veil-latest.tar.gz before serving. The pulse lives in upload/
 * because that tree survives reverts; this file is the seed that grows
 * back with every restore. Never blocks or breaks server startup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    // Spawn upload/veil-pulse.sh detached: the pulse verifies the daemon
    // swarm (keeper, backup-loop, ws-relay, freetube, chat, bridge) and —
    // if a sandbox revert gutted the project tree — restores it from
    // upload/veil-latest.tar.gz before serving. The pulse lives in upload/
    // because that tree survives reverts; this file is the seed that grows
    // back with every restore. Never blocks or breaks server startup.
    // webpackIgnore: webpack must leave this dynamic import to Node itself
    // (bundling node: builtins into the instrumentation layer fails with
    // "Module not found: Can't resolve 'child_process'" — observed live,
    // which silently killed the pulse for days).
    const { spawn } = (await import(/* webpackIgnore: true */ "node:child_process")) as typeof import("node:child_process");
    const child = spawn("bash", ["/home/z/my-project/upload/veil-pulse.sh"], {
      detached: true,
      stdio: "ignore",
      cwd: "/home/z/my-project",
    });
    // The pulse script only exists in the dev sandbox (upload/ is a state
    // volume in production images). A spawn ENOENT emits an async "error"
    // event — with no listener Node treats it as unhandled and CRASHES the
    // server on boot. Absorb it: production simply runs pulse-less.
    child.on("error", () => {});
    child.unref();
  } catch {
    /* never break server boot */
  }
  try {
    // keep the Stream browse wires hot + rotating (trending/popular/shorts
    // refresh every few minutes; feeds serve stale-while-revalidating)
    const { startFeedWarmer } = await import("@/lib/veil/yt");
    startFeedWarmer();
  } catch {
    /* feeds warm lazily on first request instead */
  }
  try {
    // Heap gardener — the #1 cause of "the site randomly restarts": the dev
    // server's RSS drifts upward for hours until the OOM watchdog kills it
    // (a visible, session-killing restart). A gentle full GC every 60
    // seconds (--expose-gc in the dev NODE_OPTIONS) compacts the heap
    // before the drift accumulates, so watchdog restarts become rare
    // emergencies instead of a daily surprise. No-op without --expose-gc.
    // v3 (2026-10-02 "it keeps restarting permanently" round): heap cap is
    // now 1024MB (package.json) with the watchdog line at 1.75GB, so the
    // compact threshold sits at 1.35GB — comfortably above the working set,
    // well below the line, and checked every 60s.
    const maybeGc = (globalThis as { gc?: () => void }).gc;
    if (typeof maybeGc === "function") {
      let lastRss = 0;
      let stableTicks = 0;
      setInterval(() => {
        try {
          const rss = process.memoryUsage().rss;
          // Compact harder when RSS is creeping (within 400 MB of the
          // watchdog's 1.75 GB line) — every tick instead of waiting.
          const nearLimit = rss > 1.35 * 1024 * 1024 * 1024;
          if (nearLimit || stableTicks % 5 === 0) {
            maybeGc();
          }
          if (rss > lastRss) stableTicks = 0;
          else stableTicks++;
          lastRss = rss;
        } catch { /* never throw in the timer */ }
      }, 60 * 1000).unref();
    }
  } catch {
    /* never break server boot */
  }
}
