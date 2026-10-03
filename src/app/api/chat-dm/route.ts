import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getAccountFromToken, toPublicAccount } from "@/lib/chat-auth"

export const runtime = "nodejs"

// GET /api/chat-dm?token=...        — list DMs the current account is a member of.
// Each DM is returned with its member accounts (projected through toPublicAccount).
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || ""
    const account = await getAccountFromToken(token)
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token." },
        { status: 401 },
      )
    }

    const memberships = await db.dMMember.findMany({
      where: { accountId: account.id },
      include: {
        dm: {
          include: {
            members: {
              include: {
                account: true,
              },
            },
          },
        },
      },
      orderBy: { dm: { createdAt: "desc" } },
    })

    const dms = memberships
      .filter((m) => m.dm)
      .map((m) => ({
        id: m.dm.id,
        name: m.dm.name,
        isGroup: m.dm.isGroup,
        createdAt: m.dm.createdAt,
        members: m.dm.members
          .filter((mem) => mem.account && !mem.account.banned)
          .map((mem) => toPublicAccount(mem.account)),
      }))

    return NextResponse.json({ ok: true, dms })
  } catch (err) {
    console.error("[chat-dm GET] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error fetching DMs." },
      { status: 500 },
    )
  }
}

// POST /api/chat-dm
// Body: { token, targetUsername } — create (or reuse) a 1:1 DM with target user.
// Body: { token, targetUsernames: string[], name?: string } — create a group DM.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      token?: string
      targetUsername?: string
      targetUsernames?: string[]
      name?: string
    }

    const token = body.token
    const account = await getAccountFromToken(token)
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token." },
        { status: 401 },
      )
    }

    const rawTargets = Array.isArray(body.targetUsernames) && body.targetUsernames.length > 0
      ? body.targetUsernames
      : body.targetUsername
        ? [body.targetUsername]
        : []
    const targetUsernames = Array.from(
      new Set(
        rawTargets
          .map((u) => (u || "").trim())
          .filter((u) => u && u !== account.username),
      ),
    )

    if (targetUsernames.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one target username is required." },
        { status: 400 },
      )
    }

    const targetAccounts = await db.chatAccount.findMany({
      where: { username: { in: targetUsernames } },
    })
    if (targetAccounts.length !== targetUsernames.length) {
      return NextResponse.json(
        { ok: false, error: "One or more target users were not found." },
        { status: 404 },
      )
    }

    const isGroup = targetUsernames.length > 1
    const allMemberIds = [account.id, ...targetAccounts.map((a) => a.id)]

    // For 1:1 DMs: try to find an existing non-group DM with exactly these 2 members.
    if (!isGroup) {
      const target = targetAccounts[0]
      const existing = await db.chatDM.findFirst({
        where: { isGroup: false },
        include: { members: true },
      })
      // Scan all non-group DMs the current user is in for an exact 2-member match.
      const myDms = await db.dMMember.findMany({
        where: { accountId: account.id },
        include: {
          dm: { include: { members: true } },
        },
      })
      const match = myDms.find((m) => {
        const dm = m.dm
        if (dm.isGroup) return false
        if (dm.members.length !== 2) return false
        return dm.members.some((mem) => mem.accountId === target.id)
      })
      if (match) {
        const refreshed = await db.chatDM.findUnique({
          where: { id: match.dmId },
          include: {
            members: {
              include: { account: true },
            },
          },
        })
        return NextResponse.json({
          ok: true,
          dm: {
            id: refreshed!.id,
            name: refreshed!.name,
            isGroup: refreshed!.isGroup,
            createdAt: refreshed!.createdAt,
            members: refreshed!.members.map((mem) =>
              toPublicAccount(mem.account),
            ),
          },
          reused: true,
        })
      }
      // Suppress unused-var warning for `existing` (kept for clarity).
      void existing
    }

    // Create a new DM with all members.
    const created = await db.chatDM.create({
      data: {
        name: body.name || null,
        isGroup,
        ownerId: account.id,
        members: {
          create: allMemberIds.map((id) => ({ accountId: id })),
        },
      },
      include: {
        members: {
          include: { account: true },
        },
      },
    })

    return NextResponse.json({
      ok: true,
      dm: {
        id: created.id,
        name: created.name,
        isGroup: created.isGroup,
        createdAt: created.createdAt,
        members: created.members.map((mem) => toPublicAccount(mem.account)),
      },
      reused: false,
    })
  } catch (err) {
    console.error("[chat-dm POST] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error creating DM." },
      { status: 500 },
    )
  }
}
