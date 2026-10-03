/**
 * Quasar Auth — optional password gate.
 * Enabled by setting the QUASAR_PASSWORD environment variable. The session
 * cookie holds HMAC-SHA256(password, salt) where the salt lives in
 * .quasar-key, so the cookie value is not reusable across deployments.
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { sessionTokenFor } from "./codec-server";

export const SESSION_COOKIE = "quasar_session";

export function authRequired(): boolean {
  return !!process.env.QUASAR_PASSWORD;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function checkPassword(pw: unknown): boolean {
  const expected = process.env.QUASAR_PASSWORD;
  if (!expected || typeof pw !== "string") return false;
  return safeEqual(pw, expected);
}

export function isAuthedRequest(req: NextRequest): boolean {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return safeEqual(token, sessionTokenFor(process.env.QUASAR_PASSWORD ?? ""));
}
