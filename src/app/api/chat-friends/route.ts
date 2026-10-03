import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getAccountFromToken } from "@/lib/chat-auth"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || ""
    const account = await getAccountFromToken(token)
    if (!account) {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 })
    }

    const friends = await db.chatFriend.findMany({
      where: { accountId: account.id },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarColor: true,
            avatarImage: true,
            role: true,
            tag: true,
            tagColor: true,
            pfpAccessory: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({
      ok: true,
      friends: friends.map((f) => f.friend),
    })
  } catch (e) {
    return NextResponse.json({ error: `Failed: ${(e as Error).message}` }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || "")
    const action = String(body.action || "")
    const targetUsername = String(body.targetUsername || "").trim()

    const account = await getAccountFromToken(token)
    if (!account) {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 })
    }

    if (action === "add") {
      if (!targetUsername) {
        return NextResponse.json({ error: "Username is required." }, { status: 400 })
      }

      // Find target user (case-insensitive)
      const allUsers = await db.chatAccount.findMany({
        where: { username: { contains: targetUsername } },
        take: 20,
      })
      const target = allUsers.find((a) => a.username.toLowerCase() === targetUsername.toLowerCase())
      if (!target) {
        return NextResponse.json({ error: "User not found." }, { status: 404 })
      }
      if (target.id === account.id) {
        return NextResponse.json({ error: "Cannot add yourself as a friend." }, { status: 400 })
      }

      // Check if already friends
      const existing = await db.chatFriend.findUnique({
        where: { accountId_friendId: { accountId: account.id, friendId: target.id } },
      })
      if (existing) {
        return NextResponse.json({ error: "Already friends." }, { status: 400 })
      }

      await db.chatFriend.create({
        data: { accountId: account.id, friendId: target.id },
      })

      return NextResponse.json({
        ok: true,
        friend: {
          id: target.id,
          username: target.username,
          displayName: target.displayName,
          avatarColor: target.avatarColor,
          avatarImage: target.avatarImage,
          role: target.role,
          tag: target.tag,
          tagColor: target.tagColor,
          pfpAccessory: target.pfpAccessory,
        },
      })
    }

    if (action === "remove") {
      if (!targetUsername) {
        return NextResponse.json({ error: "Username is required." }, { status: 400 })
      }

      const allUsers = await db.chatAccount.findMany({
        where: { username: { contains: targetUsername } },
        take: 20,
      })
      const target = allUsers.find((a) => a.username.toLowerCase() === targetUsername.toLowerCase())
      if (!target) {
        return NextResponse.json({ error: "User not found." }, { status: 404 })
      }

      await db.chatFriend.deleteMany({
        where: { accountId: account.id, friendId: target.id },
      })

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: `Failed: ${(e as Error).message}` }, { status: 500 })
  }
}
