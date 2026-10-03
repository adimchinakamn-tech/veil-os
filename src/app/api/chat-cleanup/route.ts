import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getAccountFromToken } from "@/lib/chat-auth"

export const runtime = "nodejs"

/**
 * Delete test accounts and all their data.
 *
 * Test accounts are identified by username patterns:
 *   - test* (e.g. testpfp123, testuser, test1)
 *   - cointest* / coinuser*
 *   - bjtest*
 *   - finalcheck / bjtester (exact matches)
 *
 * Also deletes:
 *   - Their chat messages (so the chat history doesn't keep test spam)
 *   - Their DM memberships
 *   - Their coin transactions
 *   - Their blackjack games
 *   - Their friend relationships
 *
 * Only the operator (Veil) can call this endpoint.
 *
 * Query params:
 *   - token: auth token (must be the Veil operator)
 *   - dryRun=1: if set, return what WOULD be deleted without actually deleting
 */

const TEST_ACCOUNT_PATTERNS = [
  /^test/i,
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
    const dryRun = req.nextUrl.searchParams.get("dryRun") === "1"
    const account = await getAccountFromToken(token)
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token." },
        { status: 401 },
      )
    }

    // Only the super-admin can clean up test accounts.
    if (account.username.toLowerCase() !== "veil") {
      return NextResponse.json(
        { ok: false, error: "Only the admin can run cleanup." },
        { status: 403 },
      )
    }

    // Find all test accounts.
    const allAccounts = await db.chatAccount.findMany({
      select: { id: true, username: true, createdAt: true },
    })
    const testAccounts = allAccounts.filter((a) => isTestAccount(a.username))
    const testIds = testAccounts.map((a) => a.id)

    if (testIds.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No test accounts to delete.",
        deleted: { accounts: 0, messages: 0, dmMembers: 0, coinTx: 0, blackjack: 0, friends: 0 },
        accounts: [],
      })
    }

    // Count what would be deleted.
    const messagesCount = await db.chatMessage.count({
      where: { accountId: { in: testIds } },
    })
    const dmMembersCount = await db.dMMember.count({
      where: { accountId: { in: testIds } },
    })
    const coinTxCount = await db.coinTransaction.count({
      where: { OR: [{ fromId: { in: testIds } }, { toId: { in: testIds } }] },
    })
    const blackjackCount = await db.blackjackGame.count({
      where: { playerId: { in: testIds } },
    })
    const friendsCount = await db.chatFriend.count({
      where: { OR: [{ accountId: { in: testIds } }, { friendId: { in: testIds } }] },
    })

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        deleted: {
          accounts: testIds.length,
          messages: messagesCount,
          dmMembers: dmMembersCount,
          coinTx: coinTxCount,
          blackjack: blackjackCount,
          friends: friendsCount,
        },
        accounts: testAccounts.map((a) => ({
          id: a.id,
          username: a.username,
          createdAt: a.createdAt,
        })),
      })
    }

    // Actually delete. Order matters for foreign-key constraints:
    // 1. Messages, DM members, coin txs, blackjack games, friends
    // 2. DMs owned by test accounts
    // 3. The accounts themselves (cascades remaining relations)

    await db.chatMessage.deleteMany({ where: { accountId: { in: testIds } } })
    await db.dMMember.deleteMany({ where: { accountId: { in: testIds } } })
    await db.coinTransaction.deleteMany({
      where: { OR: [{ fromId: { in: testIds } }, { toId: { in: testIds } }] },
    })
    await db.blackjackGame.deleteMany({ where: { playerId: { in: testIds } } })
    await db.chatFriend.deleteMany({
      where: { OR: [{ accountId: { in: testIds } }, { friendId: { in: testIds } }] },
    })
    // DMs owned by test accounts (set ownerId to null first to avoid cascade issues)
    await db.chatDM.updateMany({
      where: { ownerId: { in: testIds } },
      data: { ownerId: null },
    })
    // Finally delete the accounts.
    await db.chatAccount.deleteMany({ where: { id: { in: testIds } } })

    return NextResponse.json({
      ok: true,
      deleted: {
        accounts: testIds.length,
        messages: messagesCount,
        dmMembers: dmMembersCount,
        coinTx: coinTxCount,
        blackjack: blackjackCount,
        friends: friendsCount,
      },
      accounts: testAccounts.map((a) => ({
        id: a.id,
        username: a.username,
      })),
    })
  } catch (err) {
    console.error("[chat-cleanup GET] error", err)
    return NextResponse.json(
      { ok: false, error: "Server error during cleanup." },
      { status: 500 },
    )
  }
}
