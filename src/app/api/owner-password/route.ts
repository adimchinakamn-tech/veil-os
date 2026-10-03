/**
 * Veil — owner password management.
 *
 *   POST /api/owner-password  { password, next }     → change (scrypt hash)
 *   POST /api/owner-password  { password, reset: true } → back to default
 *
 * The current password is required for either operation. A change applies
 * instantly to every gate (Veil AI, feed posting, app deletes, dev
 * requests) because they all check through src/lib/veil/owner-auth.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { ownerPasswordOk, setOwnerPassword, resetOwnerPassword } from "@/lib/veil/owner-auth"

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      password?: string
      next?: string
      reset?: boolean
    }
    if (typeof body.password !== "string" || !body.password) {
      return NextResponse.json({ ok: false, error: "Missing password." }, { status: 400 })
    }
    if (body.reset) {
      const r = await resetOwnerPassword(body.password)
      if (!r.ok) return NextResponse.json(r, { status: 403 })
      return NextResponse.json({ ok: true, reset: true })
    }
    const r = await setOwnerPassword(body.password, body.next)
    if (!r.ok) {
      /* validation errors are 400s; a wrong current password is a 403 */
      const wrong = r.error === "Current password is wrong."
      return NextResponse.json(r, { status: wrong ? 403 : 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[owner-password] error", err)
    return NextResponse.json({ ok: false, error: "Could not update the password." }, { status: 500 })
  }
}
