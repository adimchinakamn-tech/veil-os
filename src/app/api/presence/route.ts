import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getPresence, touchPresence } from "@/lib/veil/presence"

/**
 * /api/presence — the site's "who's online" endpoint.
 *
 * GET  → the current snapshot { total, guests, users, ts }.
 * POST → a heartbeat. Body: { account: <chat account | null> }. The visitor
 *        id lives in the veil_vid cookie (set here on first beat). The
 *        response IS the fresh snapshot, so one request both checks the
 *        visitor in and reads the room.
 */

export const dynamic = "force-dynamic"

const COOKIE = "veil_vid"
const ONE_YEAR = 60 * 60 * 24 * 365

export async function GET() {
  return NextResponse.json(getPresence(), {
    headers: { "cache-control": "no-store" },
  })
}

export async function POST(req: Request) {
  let account: unknown = undefined
  try {
    const body = (await req.json()) as { account?: unknown }
    account = body?.account
  } catch {
    // A beat with no/partial body still counts as a guest visit.
    account = undefined
  }

  const jar = await cookies()
  let vid = jar.get(COOKIE)?.value
  let setCookie: string | null = null
  if (!vid || vid.length < 8) {
    vid = crypto.randomUUID()
    setCookie = vid
  }

  const snapshot = touchPresence(vid, account)

  const res = NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  })
  if (setCookie) {
    res.cookies.set(COOKIE, setCookie, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: ONE_YEAR,
      path: "/",
    })
  }
  return res
}
