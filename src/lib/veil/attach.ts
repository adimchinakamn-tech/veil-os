"use client";

/**
 * Veil — shared attachment helpers for the AI surfaces (Veil AI assistant
 * + Updates › Veil AI operator). Images ride inline as data URLs (the
 * model sees them), text-like files are inlined into the prompt, and
 * every file gets a durable vault URL via /api/ai-attachments.
 */

export interface PendingAtt {
  id: string;
  file: File;
  /** image → inline data URL for the model + local preview. */
  dataUrl?: string;
  /** text-like files are inlined into the prompt on send. */
  text?: string;
  /** durable vault URL (filled when the upload lands). */
  url?: string;
  uploading: boolean;
  error?: string;
}

export interface SentFile {
  name: string;
  size: number;
  type: string;
  url?: string;
}

export const MAX_ATTACH = 8;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB (base64 inflates ~33%)
export const MAX_TEXT_BYTES = 200 * 1024; // text files bigger than this stay metadata-only

export function isTextLikeFile(name: string, type: string): boolean {
  if (/^text\//i.test(type)) return true;
  if (/json|javascript|xml|csv|yaml/i.test(type)) return true;
  return /\.(txt|md|markdown|csv|json|js|mjs|cjs|ts|tsx|jsx|html?|css|py|rb|go|rs|java|c|h|cpp|hpp|sh|bash|zsh|yml|yaml|toml|ini|cfg|log|sql|env)$/i.test(name);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsText(file);
  });
}

export function uploadAttachment(file: File): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      "/api/ai-attachments?name=" +
        encodeURIComponent(file.name) +
        "&type=" +
        encodeURIComponent(file.type || ""),
    );
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText) as { ok?: boolean; url?: string; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && j.ok && j.url) resolve({ url: j.url });
        else reject(new Error(j.error || "upload failed"));
      } catch {
        reject(new Error("upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(file);
  });
}

export function fmtAttSize(n: number): string {
  if (!n) return "";
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

/** Start reading + uploading a batch of picked files, appending chips to
 *  the pending list. Shared by both AI composers. */
export function beginPick(
  list: FileList | null,
  setPending: (fn: (prev: PendingAtt[]) => PendingAtt[]) => void,
  setAttachError: (msg: string) => void,
  uid: () => string,
): void {
  if (!list || list.length === 0) return;
  setAttachError("");
  const incoming = Array.from(list);
  setPending((prev) => {
    const room = MAX_ATTACH - prev.length;
    if (room <= 0) {
      setAttachError("Up to " + MAX_ATTACH + " attachments per message.");
      return prev;
    }
    const take = incoming.slice(0, room);
    if (incoming.length > room) setAttachError("Up to " + MAX_ATTACH + " attachments per message.");
    let imagesSoFar = prev.filter((a) => a.dataUrl).length;
    const next = [...prev];
    for (const f of take) {
      const id = uid();
      const isImage = f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name);
      if (isImage) {
        if (f.size > MAX_IMAGE_BYTES) {
          setAttachError(f.name + " is over the 6 MB image limit.");
          continue;
        }
        if (imagesSoFar + 1 > MAX_IMAGES) {
          setAttachError("Up to " + MAX_IMAGES + " images per message.");
          continue;
        }
        imagesSoFar++;
        void readFileAsDataUrl(f).then((dataUrl) => {
          setPending((pp) => pp.map((a) => (a.id === id ? { ...a, dataUrl } : a)));
        });
      } else if (f.size <= MAX_TEXT_BYTES && isTextLikeFile(f.name, f.type)) {
        void readFileAsText(f).then((text) => {
          setPending((pp) => pp.map((a) => (a.id === id ? { ...a, text } : a)));
        });
      }
      void uploadAttachment(f)
        .then(({ url }) => {
          setPending((pp) => pp.map((a) => (a.id === id ? { ...a, url, uploading: false } : a)));
        })
        .catch(() => {
          setPending((pp) =>
            pp.map((a) =>
              a.id === id
                ? { ...a, uploading: false, error: a.dataUrl || a.text ? undefined : "upload failed" }
                : a,
            ),
          );
        });
      next.push({ id, file: f, uploading: true });
    }
    return next;
  });
}

/** Fold the pending chips into the outgoing message: inline text files
 *  into the content, collect image data URLs and file metas. Returns
 *  null while uploads are still in flight (call again shortly). */
export function settlePending(
  pending: PendingAtt[],
): { content: string; images: string[]; files: SentFile[] } | null {
  if (pending.some((a) => a.uploading && !a.error)) return null;
  const NL = "\n";
  let content = "";
  const textAtts = pending.filter((a) => a.text);
  if (textAtts.length > 0) {
    const blocks = textAtts.slice(0, 4).map(
      (a) =>
        "----- attached file: " +
        a.file.name +
        " -----" +
        NL +
        (a.text || "").slice(0, 40000) +
        NL +
        "----- end of " +
        a.file.name +
        " -----",
    );
    content = (content + NL + NL + blocks.join(NL + NL)).slice(0, 40000);
  }
  const images = pending.filter((a) => a.dataUrl).map((a) => a.dataUrl as string);
  const files: SentFile[] = pending.map((a) => ({
    name: a.file.name,
    size: a.file.size,
    type: a.file.type || "",
    ...(a.url ? { url: a.url } : {}),
  }));
  return { content, images: images.slice(0, MAX_IMAGES), files: files.slice(0, MAX_ATTACH) };
}
