/**
 * Veil — Quasar Codec API (v1.3.8).
 * ------------------------------------------------------------------
 * Ported from the user-uploaded quasar-proxy engine (src/app/api/codec/route.ts).
 *
 * Batch encode/decode for the trusted Veil shell:
 *   POST /api/codec { op: "encode", urls: string[] }  -> { paths: (string|null)[] }
 *   POST /api/codec { op: "decode", paths: string[] } -> { urls: (string|null)[] }
 *
 * The shell uses this to display the real URL behind an AES-encrypted
 * proxied path (client scripts cannot decrypt AES blobs — the engine hands
 * the shell a /p/<blob>/... path for popups it could not decode, and this
 * endpoint resolves it). Gate: this endpoint is the only way a client can
 * decrypt, and it is rate-limited + password-gated — it exists for the same
 * user who already sees the pages.
 */

import { NextRequest } from "next/server";
import { proxyPath, decodeProxiedHref } from "@/lib/veil/quasar/codec-server";
import { allowRequest, clientKeyOf, gate } from "@/lib/veil/quasar/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 64;
const MAX_LEN = 4096;

function cleanArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item.length > MAX_LEN) return null;
    out.push(item);
  }
  return out;
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = gate(req, false);
  if (denied) return denied;
  if (!allowRequest(clientKeyOf(req))) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }

  let body: { op?: string; urls?: unknown; paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad-json" }, { status: 400 });
  }

  if (body.op === "encode") {
    const urls = cleanArray(body.urls);
    if (!urls) return Response.json({ error: "bad-urls" }, { status: 400 });
    const paths = urls.map((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return proxyPath(parsed.href).split("#")[0];
      } catch {
        return null;
      }
    });
    return Response.json({ paths });
  }

  if (body.op === "decode") {
    const paths = cleanArray(body.paths);
    if (!paths) return Response.json({ error: "bad-paths" }, { status: 400 });
    const urls = paths.map((p) => {
      try {
        const raw = p.startsWith("http") ? p : "http://local" + p;
        const u = new URL(raw);
        return decodeProxiedHref(u.href);
      } catch {
        return null;
      }
    });
    return Response.json({ urls });
  }

  return Response.json({ error: "bad-op" }, { status: 400 });
}
