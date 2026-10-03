import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, unlinkSync, renameSync } from "node:fs";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  VAULT_DIR,
  MAX_FILE_BYTES,
  VAULT_CAP,
  vaultBytes,
  vaultEntriesOldestFirst,
  vaultPath,
  mimeFromName,
} from "@/lib/veil/ai-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Veil — AI attachment upload (Veil AI › attach).
 *
 *   POST /api/ai-attachments?name=…&type=…
 *     Raw octet-stream body → upload/ai-attachments/<id> + <id>.json
 *     sidecar. Up to 100 MB per file, streamed to disk. The vault is
 *     capped at 2 GB — crossing it evicts the OLDEST attachments first
 *     (conversation context, not forever-storage).
 *
 * No owner password: the attach flow is part of the public assistant
 * surface, and every stored file carries a random 128-bit id. Abuse is
 * bounded by the vault cap + eviction.
 */

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const q = req.nextUrl.searchParams;
    const name =
      (q.get("name") || "file").replace(/[\\/]+/g, "_").trim().slice(0, 160) || "file";
    let type = (q.get("type") || "").trim().slice(0, 160);
    if (type && !/^[\w.+-]+\/[\w.+-]+$/i.test(type)) type = "";
    if (!type) type = mimeFromName(name) || "application/octet-stream";

    const declared = Number(req.headers.get("content-length") || "0");
    if (declared > MAX_FILE_BYTES) {
      return fail("Attachments are capped at 100 MB.", 413);
    }

    await mkdir(VAULT_DIR, { recursive: true });

    // Evict oldest until the incoming file fits under the cap.
    let used = vaultBytes();
    if (used + Math.max(declared, 0) > VAULT_CAP) {
      for (const e of vaultEntriesOldestFirst()) {
        if (used + declared <= VAULT_CAP) break;
        try {
          unlinkSync(vaultPath(e.id));
          unlinkSync(path.join(VAULT_DIR, `${e.id}.json`));
          used -= e.bytes;
        } catch {
          /* already gone */
        }
      }
      if (used + declared > VAULT_CAP) {
        return fail("The attachment vault is full — try again in a moment.", 507);
      }
    }

    if (!req.body) return fail("No file bytes in the request.", 400);

    const id = randomBytes(16).toString("base64url");
    const tmp = path.join(VAULT_DIR, `.${id}.part`);
    const finalPath = vaultPath(id);

    const out = createWriteStream(tmp);
    let total = 0;
    let aborted = false;
    try {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES) {
          aborted = true;
          break;
        }
        if (!out.write(value)) await once(out, "drain");
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
    if (aborted || total === 0) {
      await rm(tmp, { force: true });
      return fail(
        aborted ? "Attachments are capped at 100 MB." : "Empty file.",
        aborted ? 413 : 400,
      );
    }

    renameSync(tmp, finalPath);
    await writeFile(
      path.join(VAULT_DIR, `${id}.json`),
      JSON.stringify({ name, type, size: total, createdAt: Date.now() }),
      "utf8",
    );

    return NextResponse.json({
      ok: true,
      id,
      url: `/api/ai-attachments/file?id=${id}`,
      name,
      type,
      size: total,
    });
  } catch (err) {
    console.error("[ai-attachments POST]", err);
    return fail("Upload failed.", 500);
  }
}

function fail(error: string, status: number): Response {
  return NextResponse.json({ ok: false, error }, { status });
}
