import { existsSync, copyFileSync, readFileSync } from "fs"
import { join } from "path"
import { PrismaClient } from '@prisma/client'

/* ---------------------------------------------------------------------------
 * Veil DB bootstrap.
 *
 * On the dev box: .env sets DATABASE_URL (file:/home/z/my-project/db/custom.db)
 * and nothing below ever runs — the file exists, Prisma opens it as before.
 *
 * On serverless deploys (Vercel import of the GitHub repo): there is no .env
 * and no persistent disk. This module makes the app self-healing instead of
 * 500-ing on every API call:
 *
 *   1. DATABASE_URL unset → default to file:/tmp/veil.db (writable on AWS
 *      Lambda, which Vercel runs on).
 *   2. Target file missing → copy the committed db/seed.db (schema + the
 *      last data snapshot shipped with the repo).
 *   3. Copied seed has zero chat accounts → import the repo's
 *      backups/chat/latest.json (the same auto-published snapshot the CDN
 *      serves), so the deploy always boots with the real community.
 *
 * The file lives per warm instance: cold starts re-seed from the newest
 * committed backup. The dev box remains the canonical home of live data.
 * ------------------------------------------------------------------------- */

function bootstrapDatabase(): void {
  try {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = "file:/tmp/veil.db"
    }
    const url = process.env.DATABASE_URL
    const m = /^file:(\/.+)$/.exec(url)
    if (!m) return // non-file DB (e.g. a hosted postgres) — nothing to seed
    const dbFile = m[1]

    if (!existsSync(dbFile)) {
      const seed =
        join(process.cwd(), "db", "seed.db") || // repo/standalone layout
        "" // (join never returns empty; kept for clarity)
      const candidates = [
        seed,
        join(process.cwd(), ".next", "standalone", "db", "seed.db"),
      ]
      for (const c of candidates) {
        if (existsSync(c)) {
          try { copyFileSync(c, dbFile) } catch { /* read-only fs */ }
          break
        }
      }
    }

    // Seed import happens lazily (needs Prisma, which is declared below —
    // defer via microtask so the module finishes evaluating first).
    if (!(globalThis as { __veilSeedCheck?: boolean }).__veilSeedCheck) {
      ;(globalThis as { __veilSeedCheck?: boolean }).__veilSeedCheck = true
      queueMicrotask(() => { void seedIfEmpty() })
    }
  } catch {
    /* bootstrap must never take the app down */
  }
}

async function seedIfEmpty(): Promise<void> {
  try {
    const count = await db.chatAccount.count()
    if (count > 0) return
    // find the committed backup (file tracing includes it for /api/**)
    const candidates = [
      join(process.cwd(), "backups", "chat", "latest.json"),
      join(process.cwd(), ".next", "standalone", "backups", "chat", "latest.json"),
    ]
    let raw: string | null = null
    for (const c of candidates) {
      if (existsSync(c)) { raw = readFileSync(c, "utf-8"); break }
    }
    if (!raw) return
    const { restoreChatBackup } = await import("./veil/chat-backup")
    await restoreChatBackup(JSON.parse(raw))
    console.log("[veil-db] serverless boot: restored chat from committed backup")
  } catch (e) {
    console.error("[veil-db] seed skipped:", e instanceof Error ? e.message : e)
  }
}

bootstrapDatabase()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.VEIL_PRISMA_LOG === '1' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
