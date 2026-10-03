/**
 * Veil — per-site privacy panel API, scoped per anonymous viewer.
 *
 * Every read and wipe is bounded to the caller's viewer key (header /
 * cookie / ?vv= — see lib/veil/viewer.ts): the panel lists — and the
 * resets destroy — only the caller's own rows. One visitor can never
 * see or erase another visitor's site data.
 *
 * GET  → the sites this viewer visited through the veil, with visit
 *        counts, last-seen times and per-site cookie counts (the jar
 *        the runtime keeps for session replay).
 * DELETE ?host=…         → wipe one site's cookies AND history rows (own).
 * DELETE ?scope=cookies  → wipe every stored cookie (own jar only).
 * DELETE ?scope=history  → wipe this viewer's whole browsing history.
 * DELETE (no params)     → both (full reset of this viewer's site data).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { viewerFromRequest } from "@/lib/veil/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SiteRow {
  host: string;
  visits: number;
  lastAt: string;
  cookies: number;
}

export async function GET(req: NextRequest) {
  const viewer = viewerFromRequest(req);
  try {
    const [visits, cookies] = await Promise.all([
      db.siteVisit.groupBy({
        by: ["host"],
        where: { viewer },
        _sum: { visitCount: true },
        _max: { updatedAt: true },
      }),
      db.siteCookie.groupBy({
        by: ["host"],
        where: { viewer },
        _count: { _all: true },
      }),
    ]);

    const cookieCounts = new Map(cookies.map((c) => [c.host, c._count._all]));

    const rows: SiteRow[] = visits
      .map((v) => ({
        host: v.host,
        visits: v._sum.visitCount ?? 0,
        lastAt: (v._max.updatedAt ?? new Date()).toISOString(),
        cookies: cookieCounts.get(v.host) ?? 0,
      }))
      .sort((a, b) => b.visits - a.visits || a.host.localeCompare(b.host));

    // Cookie-only hosts (a jar row without a visit — upstream set a cookie
    // on a redirect hop, say) still deserve a row in the panel.
    const seen = new Set(rows.map((r) => r.host));
    for (const c of cookieCounts.keys()) {
      if (!seen.has(c)) {
        rows.push({ host: c, visits: 0, lastAt: new Date(0).toISOString(), cookies: cookieCounts.get(c) ?? 0 });
      }
    }

    return NextResponse.json({
      sites: rows,
      totals: {
        sites: rows.length,
        visits: rows.reduce((n, r) => n + r.visits, 0),
        cookies: rows.reduce((n, r) => n + r.cookies, 0),
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not read site data." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const viewer = viewerFromRequest(req);
  const host = req.nextUrl.searchParams.get("host")?.trim().toLowerCase();
  const scope = req.nextUrl.searchParams.get("scope")?.trim().toLowerCase();

  try {
    if (host) {
      // One site: cookies + history — this viewer's rows only.
      const [c, v] = await Promise.all([
        db.siteCookie.deleteMany({ where: { viewer, host } }),
        db.siteVisit.deleteMany({ where: { viewer, host } }),
      ]);
      return NextResponse.json({ ok: true, cookies: c.count, visits: v.count });
    }
    if (scope === "cookies") {
      const c = await db.siteCookie.deleteMany({ where: { viewer } });
      return NextResponse.json({ ok: true, cookies: c.count });
    }
    if (scope === "history") {
      const v = await db.siteVisit.deleteMany({ where: { viewer } });
      return NextResponse.json({ ok: true, visits: v.count });
    }
    // Full reset of this viewer's site data.
    const [c, v] = await Promise.all([
      db.siteCookie.deleteMany({ where: { viewer } }),
      db.siteVisit.deleteMany({ where: { viewer } }),
    ]);
    return NextResponse.json({ ok: true, cookies: c.count, visits: v.count });
  } catch {
    return NextResponse.json({ error: "Could not wipe site data." }, { status: 500 });
  }
}
