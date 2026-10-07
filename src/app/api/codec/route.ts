/**
 * Quasar Codec API — batch encode/decode for the trusted UI.
 *   POST /api/codec { op: "encode", urls: string[] }  -> { paths: (string|null)[] }
 *   POST /api/codec { op: "decode", paths: string[] } -> { urls: (string|null)[] }
 *
 * The UI uses this to build AES-encrypted proxied paths for the address bar
 * and to display the real URL of the iframe's current location. Gate: this
 * endpoint is the only way a client can decrypt, and it is rate-limited +
 * password-gated — it exists for the same user who already sees the pages.
 */

import { NextRequest } from "next/server";
import {
  proxyPath,
  decodeProxiedHref,
  encodeCtxSuffix,
  DEFAULT_CONTAINER,
} from "@/lib/veil/quasar/codec-server";
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

  let body: {
    op?: string;
    urls?: unknown;
    paths?: unknown;
    container?: unknown;
    egress?: unknown;
    ua?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad-json" }, { status: 400 });
  }

  if (body.op === "encode") {
    const urls = cleanArray(body.urls);
    if (!urls) return Response.json({ error: "bad-urls" }, { status: 400 });
    // v2.1.0 — optional per-tab context baked into every blob: container,
    // egress mode and UA override. Validated/normalized by encodeCtxSuffix.
    const ctxSuffix = encodeCtxSuffix({
      container:
        typeof body.container === "string" && body.container !== DEFAULT_CONTAINER
          ? body.container
          : undefined,
      egress: body.egress === "direct" || body.egress === "upstream" ? body.egress : undefined,
      ua: typeof body.ua === "string" ? body.ua : undefined,
    });
    const paths = urls.map((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return proxyPath(parsed.href, ctxSuffix).split("#")[0];
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
