/**
 * Veil — Takeout extraction Web Worker.
 *
 * A multi-GB Takeout walk is pure CPU (gunzip + tar header parsing) for
 * minutes. On the main thread that froze the whole app ("website freezes
 * and nothing works"); here it burns on a worker thread while the UI
 * stays at 60fps. The File object is transferred cheaply (blobs are
 * structured-cloneable by reference), progress streams back as messages,
 * and cancellation rides a MessageChannel port (AbortController isn't
 * transferable).
 *
 * Spawned by takeout-extract.ts's runArchiveExtraction() — never import
 * this module from app code.
 */

import { sniffFileKind, extractTarLocal, extractZipLocal } from "@/lib/veil/takeout-extract";

interface WorkerRequest {
  type: "extract";
  file: File;
  /** MessagePort for progress + cancellation (worker side). */
  port?: MessagePort;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "extract" || !msg.file) return;
  const file = msg.file;
  const port = msg.port;

  /* Cancellation: the port carries {type:"abort"} from the main thread;
   * we surface it through the same AbortSignal contract the inline
   * extractors already understand. */
  const ac = new AbortController();
  if (port) {
    port.onmessage = (pm: MessageEvent) => {
      if (pm.data && pm.data.type === "abort") ac.abort();
    };
  }

  const post = (m: unknown) => {
    try {
      if (port) port.postMessage(m);
      else (self as unknown as Worker).postMessage(m);
    } catch {
      /* main thread gone — nothing to report to */
    }
  };

  try {
    const kind = await sniffFileKind(file);
    const result =
      kind === "text"
        ? { texts: [{ name: file.name, text: await file.text() }], historyRows: [], truncated: false, entries: 1 }
        : kind === "zip"
          ? await extractZipLocal(file, ac.signal, (p) => post({ type: "progress", progress: p }))
          : await extractTarLocal(file, kind === "gzip", ac.signal, (p) =>
              post({ type: "progress", progress: p }),
            );
    post({ type: "done", result: { ...result, kind } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      post({ type: "cancelled" });
      return;
    }
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
