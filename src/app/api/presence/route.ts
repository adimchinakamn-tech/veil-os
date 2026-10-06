import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getPresence, touchPresence, type PresenceSnapshot } from "@/lib/veil/presence"
import { liveRoomActiveUsers } from "@/lib/veil/live-room"

/**
 * /api/presence — the site's "who's online" endpoint. ONE number shared
 * by the website AND every git-version mirror.
 *
 * GET  → the current snapshot { total, guests, users, ts }.
 * POST → a heartbeat. Body: { account: <chat account | null>, vid? }.
 *        The visitor id normally lives in the veil_vid cookie (set here
 *        on first beat). CROSS-ORIGIN callers (the CDN copies on
 *        jsDelivr / GitHub Pages) can't carry that cookie — they send a
 *        self-generated `vid` instead, so git visitors count into the
 *        SAME room. The response IS the fresh snapshot, so one request
 *        both checks the visitor in and reads the room.
 *
 * The total also folds in live-room users whose lastSeen is fresh (the
 * git chat room's own heartbeats — covers mirrors browsing without API
 * reachability). Deduped by accountId, so nobody counts twice.
 */

export const dynamic = "force-dynamic"

const COOKIE = "veil_vid"
const ONE_YEAR = 60 * 60 * 24 * 365

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS })
}

/** Merge the live room's recently-active users into a snapshot (the
 * shared count). Best-effort: any failure returns the snapshot as-is. */
async function withLiveRoom(snap: PresenceSnapshot): Promise<PresenceSnapshot> {
  try {
    const live = await liveRoomActiveUsers()
    if (live.length === 0) return snap
    const known = new Set(snap.users.map((u) => u.accountId))
    let extra = 0
    for (const u of live) {
      const accountId = `live:${u.username.toLowerCase()}`
      if (known.has(accountId)) continue
      known.add(accountId)
      extra++
    }
    if (extra === 0) return snap
    return { ...snap, total: snap.total + extra }
  } catch {
    return snap
  }
}

export async function GET(): Promise<Response> {
  const snap = await withLiveRoom(getPresence())
  return NextResponse.json(snap, {
    headers: { ...CORS, "cache-control": "no-store" },
  })
}

export async function POST(req: Request): Promise<Response> {
  let account: unknown = undefined
  let bodyVid: unknown = undefined
  try {
    const body = (await req.json()) as { account?: unknown; vid?: unknown }
    account = body?.account
    bodyVid = body?.vid
  } catch {
    // A beat with no/partial body still counts as a guest visit.
    account = undefined
  }

  const jar = await cookies()
  let vid = jar.get(COOKIE)?.value
  let setCookie: string | null = null
  if (!vid || vid.length < 8) {
    // Cross-origin callers (git mirrors) pass their own durable visitor
    // id — sanitized hard; it's a Map key, never trusted content.
    const candidate =
      typeof bodyVid === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(bodyVid) ? bodyVid : null
    if (candidate) {
      vid = candidate
    } else {
      vid = crypto.randomUUID()
      setCookie = vid
    }
  }

  const snapshot = await withLiveRoom(touchPresence(vid, account))

  const res = NextResponse.json(snapshot, {
    headers: { ...CORS, "cache-control": "no-store" },
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
