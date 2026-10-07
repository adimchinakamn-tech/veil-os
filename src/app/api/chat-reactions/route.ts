import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getAccountFromToken } from "@/lib/chat-auth"
import { cors, corsOptions } from "@/lib/veil/cors"

export const runtime = "nodejs"

export async function OPTIONS(): Promise<Response> {
  return corsOptions()
}

/** The fixed quick-reaction set — the server only stores these emoji.
 * (Mirrors QUICK_REACTIONS in the chat UI; keep both in sync.) */
const REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🔥",
  "🎉",
  "👎",
] as const

/** Aggregate a message's raw reaction rows into emoji chips. */
function summarize(
  rows: { emoji: string; accountId: string }[],
): { emoji: string; usernames: string[] }[] {
  const byEmoji = new Map<string, string[]>()
  for (const r of rows) {
    const list = byEmoji.get(r.emoji) ?? []
    list.push(r.accountId)
    byEmoji.set(r.emoji, list)
  }
  return [...byEmoji.entries()].map(([emoji, usernames]) => ({
    emoji,
    usernames,
  }))
}

const PUBLIC_CHANNELS = ["main", "sharelinks", "suggestions", "links", "announcements"] as const

/**
 * POST /api/chat-reactions — toggle an emoji reaction on a message.
 *
 * Body: { token, messageId, emoji }
 *
 * - the caller must be signed in and able to READ the message's channel
 *   (public channel member, or a member of the DM/group);
 * - the emoji must come from the fixed quick-reaction set;
 * - the (message, account, emoji) row is toggled — the response carries
 *   the message's full aggregated reaction summary so the caller can
 *   replace its local state in one shot (no client-side diffing).
 *
 * The caller relays the change to other viewers over the socket relay
 * (`reaction` event) — this route only owns the durable state.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return cors(await handlePost(req))
}

async function handlePost(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as {
      token?: string
      messageId?: string
      emoji?: string
    }

    const account = await getAccountFromToken(body.token)
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token." },
        { status: 401 },
      )
    }

    const messageId = (body.messageId || "").trim()
    const emoji = (body.emoji || "").trim()
    if (!messageId) {
      return NextResponse.json(
        { ok: false, error: "A messageId is required." },
        { status: 400 },
      )
    }
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
      return NextResponse.json(
        { ok: false, error: "That reaction isn't allowed." },
        { status: 400 },
      )
    }

    const message = await db.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, channelId: true },
    })
    if (!message) {
      return NextResponse.json(
        { ok: false, error: "Message not found." },
        { status: 404 },
      )
    }

    // Read access: public channel, or DM/group membership.
    if (!(PUBLIC_CHANNELS as readonly string[]).includes(message.channelId)) {
      const membership = await db.dMMember.findUnique({
        where: {
          dmId_accountId: { dmId: message.channelId, accountId: account.id },
        },
      })
      if (!membership) {
        return NextResponse.json(
          { ok: false, error: "You can't react in that conversation." },
          { status: 403 },
        )
      }
    }

    const existing = await db.chatReaction.findUnique({
      where: {
        messageId_accountId_emoji: { messageId, accountId: account.id, emoji },
      },
    })

    let removed = false
    if (existing) {
      await db.chatReaction.delete({ where: { id: existing.id } })
      removed = true
    } else {
      await db.chatReaction.create({
        data: { messageId, accountId: account.id, emoji },
      })
    }

    const rows = await db.chatReaction.findMany({
      where: { messageId },
      select: { emoji: true, accountId: true },
    })

    return NextResponse.json({
      ok: true,
      removed,
      channelId: message.channelId,
      reactions: summarize(rows),
    })
  } catch (err) {
    console.error("[chat-reactions POST] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error toggling the reaction." },
      { status: 500 },
    )
  }
}
