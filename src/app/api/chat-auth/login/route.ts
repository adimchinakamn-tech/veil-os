import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { makeToken, toPublicAccount } from "@/lib/chat-auth"
import { cors, corsOptions } from "@/lib/veil/cors"

export const runtime = "nodejs"

/* Preflight + wildcard origin — Veil Chat also runs from the single-file
 * HTML build (file:// sends Origin: null). Tokens live in the body, so
 * a wildcard origin is safe. */
export async function OPTIONS(): Promise<Response> {
  return corsOptions()
}

export async function POST(req: Request): Promise<Response> {
  return cors(await handleLogin(req))
}

async function handleLogin(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      username?: string
      password?: string
    }

    const username = (body.username || "").trim()
    const password = body.password || ""

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Username and password are required." },
        { status: 400 },
      )
    }

    // Case-insensitive username lookup (SQLite doesn't support mode: "insensitive")
    const allAccounts = await db.chatAccount.findMany({
      where: { username: { contains: username } },
      take: 20,
    })
    const account = allAccounts.find(
      (a) => a.username.toLowerCase() === username.toLowerCase(),
    )

    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Invalid username or password." },
        { status: 401 },
      )
    }

    const valid = await bcrypt.compare(password, account.passwordHash)
    if (!valid) {
      return NextResponse.json(
        { ok: false, error: "Invalid username or password." },
        { status: 401 },
      )
    }

    if (account.banned || account.ipBanned) {
      return NextResponse.json(
        {
          ok: false,
          error: account.banReason
            ? `You are banned: ${account.banReason}`
            : "You are banned.",
        },
        { status: 403 },
      )
    }

    const token = makeToken(account)
    return NextResponse.json({
      ok: true,
      account: toPublicAccount(account),
      token,
    })
  } catch (err) {
    console.error("[chat-auth/login] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error during login." },
      { status: 500 },
    )
  }
}
