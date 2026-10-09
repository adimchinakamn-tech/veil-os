/**
 * Quasar Session API — optional password gate.
 *   GET  /api/session -> { authRequired: boolean, ok: boolean }
 *   POST /api/session { password } -> sets the signed session cookie (7d)
 *
 * Only active when the QUASAR_PASSWORD environment variable is set. The
 * cookie holds HMAC-SHA256(password, salt) with the salt from .quasar-key.
 */

import { NextRequest } from "next/server";
import { SESSION_COOKIE, authRequired, checkPassword, isAuthedRequest } from "@/lib/veil/quasar/auth";
import { sessionTokenFor } from "@/lib/veil/quasar/codec-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const required = authRequired();
  return Response.json({
    authRequired: required,
    ok: required ? isAuthedRequest(req) : true,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!authRequired()) {
    return Response.json({ ok: true, authRequired: false });
  }
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad-json" }, { status: 400 });
  }
  if (!checkPassword(body.password)) {
    return Response.json({ error: "wrong-password" }, { status: 401 });
  }
  const res = Response.json({ ok: true, authRequired: true });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${sessionTokenFor(String(body.password))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
  );
  return res;
}
