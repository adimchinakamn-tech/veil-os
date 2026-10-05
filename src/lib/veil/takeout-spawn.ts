/**
 * Veil — Takeout extraction orchestrator (main-thread side).
 *
 * Chooses the execution lane for an archive: INLINE for small files,
 * WEB WORKER for everything else (a multi-GB walk is minutes of pure
 * CPU and must never touch the main thread). Lives in its own module —
 * NOT inside takeout-extract.ts — so the worker (which imports the
 * extractors) and this spawner never form a bundler cycle.
 */

import {
  sniffFileKind,
  extractTarLocal,
  extractZipLocal,
  type YouTubeImportProgress,
  type LocalExtractResult,
} from "@/lib/veil/takeout-extract";

/* ------------------------------------------------------------------ */
/* orchestration — inline for small files, Web Worker for big ones     */
/* ------------------------------------------------------------------ */

/** Files under this size extract inline (worker spawn would cost more
 * than the walk itself). Above it, the worker keeps the main thread —
 * and the whole UI — at 60fps no matter how long the walk takes. */
const WORKER_THRESHOLD = 8 * 1024 * 1024;

export interface ArchiveExtraction extends LocalExtractResult {
  kind: "gzip" | "zip" | "tar" | "text";
}

/** Extract a Takeout archive — sniffed, then either run inline (small
 * files) or on a dedicated Web Worker (everything else). The promise
 * rejects with an AbortError DOMException on cancellation, matching the
 * inline extractors' contract. */
export async function runArchiveExtraction(
  file: File,
  onProgress: ((p: YouTubeImportProgress) => void) | undefined,
  signal?: AbortSignal,
): Promise<ArchiveExtraction> {
  const kind = await sniffFileKind(file);

  if (kind === "text") {
    return { texts: [{ name: file.name, text: await file.text() }], historyRows: [], truncated: false, entries: 1, kind };
  }

  if (file.size < WORKER_THRESHOLD || typeof Worker === "undefined") {
    const r =
      kind === "zip"
        ? await extractZipLocal(file, signal, onProgress)
        : await extractTarLocal(file, kind === "gzip", signal, onProgress);
    return { ...r, kind };
  }

  /* ---- the big one: off the main thread ---- */
  return new Promise<ArchiveExtraction>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./takeout-worker.ts", import.meta.url), { type: "module" });
    } catch {
      /* worker construction failed (odd environment) — inline fallback */
      (kind === "zip" ? extractZipLocal(file, signal, onProgress) : extractTarLocal(file, kind === "gzip", signal, onProgress))
        .then((r) => resolve({ ...r, kind }))
        .catch(reject);
      return;
    }

    /* progress + cancellation ride a MessageChannel — the port is the
     * worker's lifeline for abort (AbortSignals aren't transferable). */
    const channel = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
    const mainPort = channel?.port1 ?? null;
    const workerPort = channel?.port2 ?? undefined;

    const cleanup = () => {
      try {
        mainPort?.close();
      } catch {
        /* already closed */
      }
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      try {
        mainPort?.postMessage({ type: "abort" });
      } catch {
        /* worker may already be gone */
      }
      /* terminate shortly after — the walk stops at the next signal
       * check; the grace window lets the cancelled message arrive */
      setTimeout(() => {
        try {
          worker.terminate();
        } catch {
          /* ignore */
        }
      }, 150);
    };

    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as
        | { type: "done"; result: ArchiveExtraction }
        | { type: "cancelled" }
        | { type: "error"; error: string };
      if (!m || typeof m !== "object") return;
      if (m.type === "done") {
        cleanup();
        resolve(m.result);
      } else if (m.type === "cancelled") {
        cleanup();
        reject(new DOMException("import cancelled", "AbortError"));
      } else if (m.type === "error") {
        cleanup();
        reject(new Error(m.error));
      }
    };
    worker.onerror = () => {
      /* script/load failure — fall back to an inline walk */
      cleanup();
      (kind === "zip" ? extractZipLocal(file, signal, onProgress) : extractTarLocal(file, kind === "gzip", signal, onProgress))
        .then((r) => resolve({ ...r, kind }))
        .catch(reject);
    };

    if (mainPort) {
      mainPort.onmessage = (pm: MessageEvent) => {
        const m = pm.data as { type: string; progress?: YouTubeImportProgress } | null;
        if (m?.type === "progress" && m.progress) onProgress?.(m.progress);
      };
    } else {
      /* no MessageChannel (ancient browser): progress rides the worker's
       * own messages instead of the port */
      const realOnMessage = worker.onmessage;
      worker.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { type: string; progress?: YouTubeImportProgress } | null;
        if (m?.type === "progress" && m.progress) {
          onProgress?.(m.progress);
          return;
        }
        if (realOnMessage) realOnMessage.call(worker, ev);
      };
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ type: "extract", file, port: workerPort }, workerPort ? [workerPort] : []);
  });
}
