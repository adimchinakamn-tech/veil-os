import { spawnSync } from "child_process"
import {
  collectChatBackup,
  writeBackupFiles,
  backupSignature,
  readBackupState,
  writeBackupState,
  JSDELIVR_PURGE,
} from "../src/lib/veil/chat-backup"

/**
 * Backup-loop body — run by scripts/chat-backup-loop.sh every 30s (and by
 * "Back up now" in the chat Backup panel via /api/chat-backup).
 *
 *   bun scripts/chat-backup.ts            # skip if nothing changed
 *   bun scripts/chat-backup.ts --force    # always snapshot
 *
 * Pipeline: detect change → snapshot to backups/chat/{latest,history,manifest}
 * → git add+commit → git push (fails quietly until the GitHub token gets
 * Contents:write — the standing watcher will land the backlog) → on a
 * successful push, purge the jsDelivr CDN cache so the public link
 * (cdn.jsdelivr.net/gh/adimchinakamn-tech/veil-os@main/backups/chat/latest.json)
 * serves the fresh snapshot immediately.
 */

const ROOT = "/home/z/my-project"
const force = process.argv.includes("--force")

function git(args: string[]): { code: number; err: string } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8" })
  return { code: r.status ?? 1, err: (r.stderr || "").slice(0, 400) }
}

async function main(): Promise<void> {
  const sig = await backupSignature()
  const state = readBackupState()

  if (!force && state && state.sig === sig) {
    // Nothing changed — still stamp lastRun so the Backup panel's
    // "auto-backup live" heartbeat reflects loop activity, not just
    // snapshot writes.
    writeBackupState({ ...state, sig, lastRun: new Date().toISOString() })
    console.log(JSON.stringify({ changed: false, sig }))
    return
  }

  const backup = await collectChatBackup()
  const { latestPath } = writeBackupFiles(backup)

  // ---- git: stage + commit + push (all best-effort) ----------------------
  git(["add", "-A", "backups/chat"])
  const staged = git(["diff", "--cached", "--quiet"])
  let committed = false
  if (staged.code !== 0) {
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16)
    const c = git([
      "commit",
      "-m",
      `chat backup: ${backup.counts.messages} messages @ ${stamp}`,
    ])
    committed = c.code === 0
    if (!committed) console.error("COMMIT-FAIL " + c.err)
  }
  const push = git(["push", "origin", "main"])
  const pushOk = push.code === 0
  const pushError = pushOk ? null : push.err

  // Purge the jsDelivr edge cache after a successful publish so the CDN
  // link reflects the new snapshot right away (branch refs cache ~12h).
  if (pushOk) {
    try {
      await fetch(JSDELIVR_PURGE, { signal: AbortSignal.timeout(6000) })
    } catch {
      /* cache purging is an optimization — never fatal */
    }
  }

  writeBackupState({
    sig,
    lastRun: new Date().toISOString(),
    lastBackupAt: backup.exportedAt,
    lastPushOk: pushOk,
    lastPushAt: pushOk ? new Date().toISOString() : (state?.lastPushAt ?? null),
    lastPushError: pushError,
    lastCounts: backup.counts,
  })

  console.log(
    JSON.stringify({
      changed: true,
      sig,
      latestPath,
      committed,
      pushOk,
      pushError: pushError ? pushError.slice(0, 160) : null,
      counts: backup.counts,
    }),
  )
}

void main()
