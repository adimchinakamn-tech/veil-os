import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ownerPasswordOk } from "@/lib/veil/owner-auth"
import { appsPackInSync, getAppsPackStatus, scheduleAppsPackRebuild } from "@/lib/veil/apps-pack"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Veil — site apps (self-contained HTML apps that run inside the site).
 *
 *   GET    /api/apps                → { ok, apps: [...] }   (public, no html)
 *   GET    /api/apps?id=<id>        → { ok, app }           (full, with html)
 *   POST   /api/apps                → create
 *          { name, desc?, icon?, html }                     → community app (NO password)
 *          { password, name, … }   → owner-built app (password)
 *          { verify: true, password }                      → password check only
 *          { play: true, id }     → count a launch (plays + lastPlayedAt)
 *   DELETE /api/apps?id=<id>        → delete  (password required)
 *
 * Creating apps is open to everyone client-side — no password needed;
 * the badge records who made it (community / owner / ai). Only Veil AI
 * itself and the owner password grant the privileged badges, and only
 * deleting needs the password.
 *
 * The list endpoint never ships app HTML (apps can be tens of KB each);
 * the runner fetches a single app by id when the user opens it.
 */

const MAX_APPS = 40
const MAX_HTML = 900_000 // the ext-maker caps pages well below this

const ICONS = [
  "bot", "joypad", "image", "globe", "dices", "search", "spark", "calc",
  "trophy", "zap", "timer", "brush", "pen", "filetext", "monitor", "key",
  "palette", "worm", "bomb", "music", "heart", "desktop", "play", "archive",
  "package",
]

function sanitizeIcon(icon: unknown): string {
  const s = typeof icon === "string" ? icon.toLowerCase().trim() : ""
  return ICONS.includes(s) ? s : "spark"
}

let cache: { at: number; data: unknown } | null = null

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (id) {
      const app = await db.siteApp.findFirst({
        where: { id, active: true },
        select: { id: true, name: true, desc: true, icon: true, html: true, createdBy: true, createdAt: true },
      })
      if (!app) {
        return NextResponse.json({ ok: false, error: "App not found." }, { status: 404 })
      }
      return NextResponse.json({ ok: true, app })
    }
    if (cache && Date.now() - cache.at < 30_000) {
      return NextResponse.json({ ok: true, ...(cache.data as object) })
    }
    // Recently played first (nulls never beat a real timestamp in SQLite's
    // DESC ordering), then most launched, then newest.
    const apps = await db.siteApp.findMany({
      where: { active: true },
      orderBy: [{ lastPlayedAt: "desc" }, { plays: "desc" }, { createdAt: "desc" }],
      take: MAX_APPS,
      select: {
        id: true,
        name: true,
        desc: true,
        icon: true,
        createdBy: true,
        createdAt: true,
        plays: true,
        lastPlayedAt: true,
      },
    })
    cache = { at: Date.now(), data: { apps, pack: getAppsPackStatus() } }
    /* self-heal: a stale pack (DB edited directly, or a restart raced a
       change) rebuilds itself on the next poll — never blocks the read */
    if (!(await appsPackInSync(apps.length))) scheduleAppsPackRebuild(1_000)
    return NextResponse.json({ ok: true, apps, pack: getAppsPackStatus() })
  } catch (err) {
    console.error("[apps] list error", err)
    return NextResponse.json({ ok: false, error: "Could not load apps." }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      password?: string
      verify?: boolean
      play?: boolean
      id?: string
      name?: string
      desc?: string
      icon?: string
      html?: string
      createdBy?: string
    }

    // Password-verification probe (owner-mode unlock): checks the password
    // only, never creates anything. 400 "name required"-style ambiguity is
    // gone now that creation itself no longer requires a password.
    if (body.verify === true) {
      if (!(await ownerPasswordOk(body.password))) {
        return NextResponse.json({ ok: false, error: "Wrong password." }, { status: 403 })
      }
      return NextResponse.json({ ok: true })
    }

    // Launch counter — fire-and-forget from the arcade when an app is
    // opened in the player. No password (counting a play is public),
    // rate-capped by being a single tiny increment.
    if (body.play === true) {
      if (!body.id) {
        return NextResponse.json({ ok: false, error: "id required." }, { status: 400 })
      }
      try {
        const app = await db.siteApp.update({
          where: { id: body.id },
          data: { plays: { increment: 1 }, lastPlayedAt: new Date() },
          select: { id: true, plays: true, lastPlayedAt: true },
        })
        cache = null
        return NextResponse.json({ ok: true, app })
      } catch {
        // Unknown/inactive id — the runner doesn't care, never block a launch.
        return NextResponse.json({ ok: true, app: null })
      }
    }

    // Password provided → it must be RIGHT (owner badge). No password →
    // open community creation. A wrong password is a 403, not a downgrade.
    const hasPassword = typeof body.password === "string" && body.password.length > 0
    if (hasPassword && !(await ownerPasswordOk(body.password))) {
      return NextResponse.json({ ok: false, error: "Wrong password." }, { status: 403 })
    }

    const name = (body.name || "").trim().slice(0, 60)
    const html = (body.html || "").trim().slice(0, MAX_HTML)
    if (!name || html.length < 400) {
      return NextResponse.json(
        { ok: false, error: "A name and a complete app page are required." },
        { status: 400 },
      )
    }
    const desc = (body.desc || "").trim().slice(0, 140)
    const icon = sanitizeIcon(body.icon)
    // "ai" is reserved for the operator (which installs directly via prisma);
    // through this public route it still requires the owner password.
    const createdBy =
      body.createdBy === "ai" && hasPassword ? "ai" : hasPassword ? "owner" : "community"

    // Keep the app wall small — oldest apps fall off first.
    const count = await db.siteApp.count({ where: { active: true } })
    if (count >= MAX_APPS) {
      const oldest = await db.siteApp.findMany({
        where: { active: true },
        orderBy: { createdAt: "asc" },
        take: count - MAX_APPS + 1,
        select: { id: true },
      })
      await db.siteApp.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } })
    }

    const app = await db.siteApp.create({
      data: { name, desc, icon, html, createdBy },
      select: {
        id: true,
        name: true,
        desc: true,
        icon: true,
        createdBy: true,
        createdAt: true,
        plays: true,
        lastPlayedAt: true,
      },
    })
    cache = null
    /* the offline “Veil AI Apps” pack picks the new app up */
    scheduleAppsPackRebuild()
    return NextResponse.json({ ok: true, app })
  } catch (err) {
    console.error("[apps] create error", err)
    return NextResponse.json({ ok: false, error: "Could not save the app." }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    const password = req.nextUrl.searchParams.get("password")
    const id = req.nextUrl.searchParams.get("id")
    if (!(await ownerPasswordOk(password))) {
      return NextResponse.json({ ok: false, error: "Wrong password." }, { status: 403 })
    }
    if (!id) {
      return NextResponse.json({ ok: false, error: "id required." }, { status: 400 })
    }
    await db.siteApp.delete({ where: { id } })
    cache = null
    /* the offline pack drops the deleted app */
    scheduleAppsPackRebuild()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[apps] delete error", err)
    return NextResponse.json({ ok: false, error: "Could not delete the app." }, { status: 500 })
  }
}
