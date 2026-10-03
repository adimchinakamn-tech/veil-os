import { NextRequest, NextResponse } from "next/server";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ownerPasswordOk } from "@/lib/veil/owner-auth";
import { VAULT_DIR, listCustomWallpapers, bustCustomCache } from "@/lib/veil/custom-wallpapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Veil — the custom wallpaper list ("My pack → your uploads").
 *
 *   GET /api/wallpapers/custom
 *     → { ok, wallpapers } — public (they're site-wide wallpapers; the
 *       byte ids are unguessable 128-bit random, same model as the gif
 *       cache). 30s in-process cache; upload/delete bust it.
 *
 *   DELETE /api/wallpapers/custom?password=…&id=up-<id>
 *     → removes the file + sidecar + poster (owner only). Never touches
 *       built-in pack entries — the id namespace is disjoint ("up-…").
 */

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ ok: true, wallpapers: listCustomWallpapers() });
  } catch (err) {
    console.error("[wallpapers/custom] list error", err);
    return NextResponse.json({ ok: true, wallpapers: [] });
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    if (!(await ownerPasswordOk(req.nextUrl.searchParams.get("password")))) {
      return NextResponse.json({ ok: false, error: "Wrong owner password." }, { status: 403 });
    }
    const upId = (req.nextUrl.searchParams.get("id") || "").trim();
    // Only custom upload ids — "up-" prefix, then the 128-bit base64url id.
    if (!/^up-[A-Za-z0-9_-]{16,64}$/.test(upId)) {
      return NextResponse.json({ ok: false, error: "Not a custom wallpaper." }, { status: 400 });
    }
    const id = upId.slice(3);
    const file = path.join(VAULT_DIR, id);
    if (!existsSync(file)) {
      return NextResponse.json({ ok: false, error: "No such wallpaper." }, { status: 404 });
    }
    unlinkSync(file);
    for (const extra of [`${id}.json`, `${id}.jpg`]) {
      try {
        unlinkSync(path.join(VAULT_DIR, extra));
      } catch {
        /* optional */
      }
    }
    bustCustomCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wallpapers/custom] delete error", err);
    return NextResponse.json({ ok: false, error: "Could not delete that wallpaper." }, { status: 500 });
  }
}
