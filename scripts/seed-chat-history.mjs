/**
 * Seed the restored Veil Chat history — accounts + the 19 messages from
 * the operator's export (Sep 15–23, 2026, America/New_York).
 *
 * Idempotent: skips messages that already exist (matched by
 * author-username + content + minute), so it can run repeatedly.
 *
 * Usage: bun scripts/seed-chat-history.mjs
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const db = new PrismaClient()

/* ------------------------------------------------------------------ */
/* The roster from the operator's export                                */
/* ------------------------------------------------------------------ */

const USERS = [
  {
    username: "canadianspy",
    displayName: "Canadian Spy",
    avatarColor: "#ef4444",
    bio: "🇨🇦 ollo. professional glizzy gobler of glizzys.",
    role: "member",
  },
  {
    username: "spiffyboss5111",
    displayName: "SpiffyBoss5111",
    avatarColor: "#8b5cf6",
    bio: "bet u can smell me now",
    role: "member",
  },
  {
    username: "ppja",
    displayName: "ppJA",
    avatarColor: "#10b981",
    bio: "I can smell him from here.",
    role: "member",
  },
  {
    username: "gif_e2e_check",
    displayName: "gif_e2e_check",
    avatarColor: "#64748b",
    bio: "end-to-end GIF pipeline verification.",
    role: "member",
  },
  {
    username: "leak_e2e_check",
    displayName: "leak_e2e_check",
    avatarColor: "#64748b",
    bio: "link-safety end-to-end verification.",
    role: "member",
  },
  {
    username: "droptest",
    displayName: "droptest",
    avatarColor: "#64748b",
    bio: "Veil Drop offline shell tests.",
    role: "member",
  },
]

/* ------------------------------------------------------------------ */
/* The message log (times are EDT, UTC-4, September 2026)               */
/* ------------------------------------------------------------------ */

const M = (username, content, isoLocal) => {
  // isoLocal is "YYYY-MM-DDTHH:MM[:SS]" in EDT (UTC-4) — normalize to a
  // full ISO string before parsing.
  const withSeconds = isoLocal.length === 16 ? isoLocal + ":00" : isoLocal
  return { username, content, at: new Date(withSeconds + "-04:00") }
}

const HISTORY = [
  M("Veil", "yo", "2026-09-15T12:22"),
  M(
    "Veil",
    "https://media2.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3bTJpODZoenUxb2o2YWJob3Bya2F1NzJ3cmZiYmNkajE4cGpybXpkNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ASd0Ukj0y3qMM/giphy.gif",
    "2026-09-16T18:13",
  ),
  M("canadianspy", "ollo", "2026-09-17T14:45:00"),
  M("canadianspy", "dis me seb", "2026-09-17T14:45:30"),
  M("Veil", "holy grammar", "2026-09-17T18:24"),
  M("canadianspy", "gobler of glizzys", "2026-09-17T18:29"),
  M("Veil", "yo wtf", "2026-09-17T18:56"),
  M("spiffyboss5111", "bet u can smell me now", "2026-09-17T18:57"),
  M("ppja", "I can smell him from here", "2026-09-17T19:09:00"),
  M("spiffyboss5111", "yo spiffy boss smell rn", "2026-09-17T19:09:20"),
  M("Veil", "lol", "2026-09-17T20:34"),
  M(
    "Veil",
    "/api/chat-file?id=UnxQ6guqFbJlAcMOqBkCnA&n=clstickmanduel.html&s=42547&t=text/html",
    "2026-09-22T02:19",
  ),
  M("Veil", "/api/gif-file/Eq65ImLqFL6CsLK1CW", "2026-09-22T20:00"),
  M("gif_e2e_check", "/api/gif-file/6ez4XOdUJ8xryUtgaH", "2026-09-22T20:01"),
  M(
    "leak_e2e_check",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "2026-09-22T20:30:00",
  ),
  M(
    "leak_e2e_check",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
    "2026-09-22T20:30:40",
  ),
  M("leak_e2e_check", "plain link test https://example.com/page and text", "2026-09-22T20:31:20"),
  M("droptest", "Hello from the Veil Drop offline shell! Testing chat.", "2026-09-23T01:00:00"),
  M("droptest", "Live test from Veil Drop via socket.io", "2026-09-23T01:00:45"),
]

/* ------------------------------------------------------------------ */
/* Seed                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const byName = new Map()

  // The operator account must exist (seeded by seed-veil-operator).
  const veil = await db.chatAccount.findFirst({ where: { username: "Veil" } })
  if (!veil) throw new Error("Veil operator account missing — run seed-veil-operator first.")
  byName.set("Veil", veil)

  for (const u of USERS) {
    let row = await db.chatAccount.findFirst({ where: { username: u.username } })
    if (!row) {
      const passwordHash = await bcrypt.hash(
        crypto.randomUUID() + crypto.randomUUID(),
        10,
      )
      row = await db.chatAccount.create({
        data: {
          username: u.username,
          passwordHash,
          displayName: u.displayName,
          avatarColor: u.avatarColor,
          bio: u.bio,
          role: u.role,
          createdAt: new Date("2026-09-10T12:00:00-04:00"),
        },
      })
      console.log(`+ account ${u.username} (${u.displayName})`)
    } else {
      console.log(`= account ${u.username} already exists`)
    }
    byName.set(u.username, row)
  }

  let inserted = 0
  let skipped = 0
  for (const m of HISTORY) {
    const author = byName.get(m.username)
    if (!author) throw new Error(`No account for ${m.username}`)
    const existing = await db.chatMessage.findFirst({
      where: {
        accountId: author.id,
        content: m.content,
        createdAt: {
          gte: new Date(m.at.getTime() - 60_000),
          lte: new Date(m.at.getTime() + 60_000),
        },
      },
    })
    if (existing) {
      skipped++
      continue
    }
    await db.chatMessage.create({
      data: { channelId: "main", accountId: author.id, content: m.content, createdAt: m.at },
    })
    inserted++
  }

  const total = await db.chatMessage.count()
  console.log(`\nseeded ${inserted} message(s), skipped ${skipped} existing. channel "main" now holds ${total}.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
