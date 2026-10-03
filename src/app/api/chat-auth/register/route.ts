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

const AVATAR_COLORS = [
  "#f97316",
  "#e67e22",
  "#16a085",
  "#2980b9",
  "#8e44ad",
  "#c0392b",
  "#27ae60",
  "#f39c12",
  "#1abc9c",
  "#9b59b6",
  "#e84393",
  "#2c3e50",
]

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
}

export async function POST(req: Request): Promise<Response> {
  return cors(await handleRegister(req))
}

async function handleRegister(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      username?: string
      password?: string
      displayName?: string
    }

    const username = (body.username || "").trim()
    const password = body.password || ""
    const displayName = (body.displayName || "").trim()

    if (username.length < 3) {
      return NextResponse.json(
        { ok: false, error: "Username must be at least 3 characters." },
        { status: 400 },
      )
    }
    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 },
      )
    }

    // Case-insensitive uniqueness (SQLite's unique constraint is exact-match,
    // but login resolves usernames case-insensitively — registering "veil"
    // when an account "Veil" exists would hijack its login).
    const clashing = await db.chatAccount.findMany({
      where: { username: { contains: username } },
      take: 20,
      select: { username: true },
    })
    if (clashing.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: "That username is already taken." },
        { status: 409 },
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const account = await db.chatAccount.create({
      data: {
        username,
        passwordHash,
        displayName: displayName || username,
        avatarColor: randomAvatarColor(),
        coins: 100,
        role: "member",
      },
    })

    const token = makeToken(account)
    return NextResponse.json({
      ok: true,
      account: toPublicAccount(account),
      token,
    })
  } catch (err) {
    console.error("[chat-auth/register] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error during registration." },
      { status: 500 },
    )
  }
}
