import { readFileSync } from "fs"
import { restoreChatBackup, fetchJsDelivrBackup } from "../src/lib/veil/chat-backup"

/**
 * CLI chat-restore — imports a Veil chat backup into the live DB.
 *
 *   bun scripts/chat-restore.ts backups/chat/seeds/2026-10-03-general-user-table.json
 *   bun scripts/chat-restore.ts --jsdelivr          # pull latest from the CDN
 *
 * Idempotent: re-running skips message ids that already exist; missing
 * accounts come back as re-registerable "legacy" placeholders (see
 * src/lib/veil/chat-backup.ts).
 */

async function main(): Promise<void> {
  const arg = process.argv[2] ?? ""
  if (!arg) {
    console.error(
      "usage: bun scripts/chat-restore.ts <path-to-backup.json | --jsdelivr>",
    )
    process.exit(1)
  }

  let loaded:
    | { data: unknown; restoredFrom: string }
    | { error: string }

  if (arg === "--jsdelivr") {
    loaded = await fetchJsDelivrBackup()
  } else {
    try {
      loaded = {
        data: JSON.parse(readFileSync(arg, "utf-8")),
        restoredFrom: arg,
      }
    } catch (e) {
      loaded = { error: `Could not read ${arg}: ${(e as Error).message}` }
    }
  }

  if ("error" in loaded) {
    console.error("RESTORE-FAIL " + loaded.error)
    process.exit(1)
  }

  const res = await restoreChatBackup(loaded.data, {
    restoredFrom: loaded.restoredFrom,
  })
  console.log(JSON.stringify(res))
  process.exit(res.ok ? 0 : 1)
}

void main()
