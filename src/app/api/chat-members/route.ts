import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getAccountFromToken, toPublicAccount } from "@/lib/chat-auth"
import { cors } from "@/lib/veil/cors"

export const runtime = "nodejs"

// Test-account prefixes/names excluded from the public member list.
const TEST_ACCOUNT_PATTERNS = [
  /^cointest/i,
  /^coinuser/i,
  /^bjtest/i,
  /^finalcheck$/i,
  /^bjtester$/i,
]

function isTestAccount(username: string): boolean {
  return TEST_ACCOUNT_PATTERNS.some((re) => re.test(username))
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || ""
    const account = await getAccountFromToken(token)

    const accounts = await db.chatAccount.findMany({
      where: { banned: false, ipBanned: false },
      orderBy: { username: "asc" },
    })

    const visible = accounts.filter((a) => !isTestAccount(a.username))

    /* Tokenless/stale-token callers are read-only roster consumers — the
     * players panel on the offline single-file build and the older static
     * shells poll this route with no session. They get the public roster
     * (usernames / avatars / roles — no secrets), minus the heavy fields
     * (base64 PFPs, bios) so a 30s panel poll stays a few KB.
     * Authenticated callers get the full public rows. */
    if (!account) {
      return cors(
        NextResponse.json({
          ok: true,
          members: visible.map((a) => {
            const p = toPublicAccount(a)
            return { ...p, avatarImage: null, bio: "" }
          }),
        }),
      )
    }

    // CORS-open: the offline single-file build (Origin: null) lists the
    // roster for its players panel through this route.
    return cors(
      NextResponse.json({
        ok: true,
        members: visible.map(toPublicAccount),
      }),
    )
  } catch (err) {
    console.error("[chat-members GET] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error fetching members." },
      { status: 500 },
    )
  }
}
