import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ownerPasswordOk } from "@/lib/veil/owner-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Veil — dev requests (the Veil AI → real-developer relay).
 *
 * The owner types a site-level ask into Updates → Veil AI ("add a new
 * engine to chat", "wallpaper thumbnails are missing"); the assistant
 * can't rewrite the site's source, so it files the ask here. The
 * recurring dev agent picks up pending rows, implements them for real,
 * and flips them to done — which auto-announces in the Updates feed.
 *
 *   GET   /api/dev-requests?password=  → { ok, requests }  (owner-only —
 *          the asks are private, nothing is publicly listable)
 *   PATCH /api/dev-requests            → update status/note (password)
 *        { password, id, status: pending|in_progress|done|declined, note? }
 */

const STATUSES = new Set(["pending", "in_progress", "done", "declined"])

let cache: { at: number; data: unknown } | null = null

export async function GET(req: NextRequest): Promise<Response> {
  try {
    if (!(await ownerPasswordOk(req.nextUrl.searchParams.get("password")))) {
      return NextResponse.json({ ok: false, error: "Wrong password." }, { status: 403 })
    }
    if (cache && Date.now() - cache.at < 30_000) {
      return NextResponse.json({ ok: true, ...(cache.data as object) })
    }
    const requests = await db.devRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        title: true,
        body: true,
        status: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    cache = { at: Date.now(), data: { requests } }
    return NextResponse.json({ ok: true, requests })
  } catch (err) {
    console.error("[dev-requests] list error", err)
    return NextResponse.json({ ok: false, error: "Could not load dev requests." }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      password?: string
      id?: string
      status?: string
      note?: string
    }
    if (!(await ownerPasswordOk(body.password))) {
      return NextResponse.json({ ok: false, error: "Wrong password." }, { status: 403 })
    }
    const id = (body.id || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "id required." }, { status: 400 })
    }
    const status = (body.status || "").trim().toLowerCase()
    if (!STATUSES.has(status)) {
      return NextResponse.json(
        { ok: false, error: "status must be one of pending, in_progress, done, declined." },
        { status: 400 },
      )
    }
    const existing = await db.devRequest.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Request not found." }, { status: 404 })
    }
    const note = body.note === undefined ? existing.note : String(body.note).slice(0, 4000)
    const row = await db.devRequest.update({
      where: { id },
      data: { status, note },
    })

    // Shipping it? Announce in the Updates feed automatically — the
    // owner sees "shipped" without anyone hand-writing a post.
    if (status === "done" && existing.status !== "done") {
      try {
        await db.siteUpdate.create({
          data: {
            title: `Shipped: ${existing.title.slice(0, 110)}`,
            body:
              (note && note.trim()) ||
              "Requested through Veil AI and built into the site. It's live now.",
            kind: "feature",
          },
        })
      } catch {
        /* the status flip still counts even if the announcement failed */
      }
    }

    cache = null
    return NextResponse.json({ ok: true, request: row })
  } catch (err) {
    console.error("[dev-requests] patch error", err)
    return NextResponse.json({ ok: false, error: "Could not update the request." }, { status: 500 })
  }
}
