import { spawnSync } from "child_process"
import fs from "node:fs"
import {
  collectChatBackup,
  writeBackupFiles,
  backupSignature,
  readBackupState,
  writeBackupState,
  purgeJSDelivrData,
} from "../src/lib/veil/chat-backup"

/**
 * Backup-loop body — run by scripts/chat-backup-loop.sh every 30s (and by
 * "Back up now" in the chat Backup panel via /api/chat-backup).
 *
 *   bun scripts/chat-backup.ts            # skip if nothing changed
 *   bun scripts/chat-backup.ts --force    # always snapshot
 *
 * Pipeline: detect change → snapshot to backups/chat/{latest,history,manifest}
 * → git add+commit → git push → on a successful push, purge the jsDelivr
 * edge cache for the backup JSON.
 *
 * 2026-10-06: the static CDN mirror (site/ + m1..m10) was replaced by the
 * live CDN front (index.html stubs streaming the real app), so there is no
 * mirror to stamp anymore — the backup JSON is the only artifact that
 * changes with chat content. It doubles as the serverless cold-boot seed.
 */

const ROOT = "/home/z/my-project"
const force = process.argv.includes("--force")

function git(args: string[]): { code: number; err: string } {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
  return { code: r.status ?? 1, err: (r.stderr || "").slice(0, 400) }
}

function gitOut(args: string[]): string {
  try {
    const r = spawnSync("git", args, {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    return r.status === 0 ? (r.stdout || "") : ""
  } catch {
    return ""
  }
}

/** 2026-10-07 PERMANENT revert fix, part 2: before a snapshot commit is
 * stacked, verify this box is not sitting on a STALE lineage (a platform
 * snapshot-restore rolls the repo back while origin/main keeps every
 * pushed feature). When HEAD is strictly behind origin/main and no
 * tracked file outside backups/ is modified, adopt the remote tip first
 * and rewrite the snapshot files — a backup must never anchor the box
 * to old code again. Returns true when a heal happened. */
function healStaleLineage(rewrite: () => void): boolean {
  // strictly behind? (HEAD is an ancestor of origin/main, but the remote
  // tip is NOT an ancestor of HEAD — equal counts as healthy)
  const headAnc = git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).code === 0
  const remoteAnc = git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).code === 0
  if (!headAnc || remoteAnc) return false
  // Only tracked modifications matter; untracked noise (dev.log, tmp/)
  // never blocks a reset. Dirt under backups/ is fine — we rewrite it.
  const porcelain = gitOut(["status", "--porcelain"])
  const blocking = porcelain
    .split("\n")
    .filter((l) => l && !l.startsWith("??"))
    .filter((l) => {
      const p = l.slice(3).split(" -> ").pop()!.trim()
      return !p.startsWith("backups/")
    })
  if (blocking.length > 0) return false
  if (git(["reset", "--hard", "origin/main"]).code !== 0) return false
  rewrite() /* re-materialize the fresh snapshot the reset just clobbered */
  return true
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
  // Only the backup artifacts are committed — the CDN front stubs
  // (index.html / site/ / m1..m10 / cdn/) are static and never change with
  // chat content. Serverless cold boots + disaster restores read
  // backups/chat/latest.json, so this push IS the off-site backup.
  git(["fetch", "origin", "main", "--quiet"])
  const healed = healStaleLineage(() => {
    writeBackupFiles(backup)
  })
  if (healed) console.error("LINEAGE-HEALED reset to origin/main before snapshot")
  git(["add", "-A", "backups/chat"])
  const staged = git(["diff", "--cached", "--quiet"])
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16)
  let committed = false
  if (staged.code !== 0) {
    const c = git([
      "commit",
      "-m",
      `chat backup: ${backup.counts.messages} messages @ ${stamp}`,
    ])
    committed = c.code === 0
    if (!committed) console.error("COMMIT-FAIL " + c.err)
  }
  let push = git(["push", "origin", "main"])
  if (push.code !== 0) {
    // remote moved (a feature commit or another box's backup landed between
    // fetch and push) — reconcile with the remote and retry.
    //
    // 2026-10-10 PERMANENT FIX (the "animations vanished" postmortem):
    // the old `pull --rebase -X theirs` kept ABORTING whenever a platform
    // rollback diverged this box (conflicts -X cannot settle: modify/
    // delete, renames), and the stash-based hard recovery silently
    // no-opped — the box then sat diverged for a day while every push
    // failed and origin/main held every animation commit. MERGE instead:
    // -X theirs takes the REMOTE side of conflicting hunks (after a
    // rollback the remote is the newest code), local-only files merge
    // in untouched, and the next cycle re-commits fresh backup JSONs
    // anyway. If even the merge fails, hard-recover by copying the
    // fresh snapshot to /tmp (plain files — cannot fail like stash),
    // adopting the remote tip, copying back, and re-committing.
    const merge = git([
      "merge", "--autostash", "-X", "theirs", "origin/main",
      "-m", "auto: merge origin/main (rollback recovery)",
    ])
    if (merge.code === 0) {
      push = git(["push", "origin", "main"])
    } else {
      git(["merge", "--abort"])
      const tmp = `/tmp/veil-chat-backup-${Date.now()}`
      try {
        fs.mkdirSync(tmp, { recursive: true })
        fs.cpSync(`${ROOT}/backups/chat`, tmp, { recursive: true })
        if (git(["reset", "--hard", "origin/main"]).code === 0) {
          fs.cpSync(tmp, `${ROOT}/backups/chat`, { recursive: true })
          git(["add", "-A", "backups/chat"])
          git([
            "commit",
            "-m",
            `chat backup (recovered): ${backup.counts.messages} messages @ ${stamp}`,
          ])
          push = git(["push", "origin", "main"])
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    }
  }
  const pushOk = push.code === 0
  const pushError = pushOk ? null : push.err

  // Purge the jsDelivr edge cache after a successful publish. SLIM list:
  // only the chat-data files — purging all 56 surfaces per changed
  // message earned a repo-wide purge THROTTLE (stale CDN for up to an
  // hour). Pages get purged explicitly on real site updates instead.
  let purged: string[] = []
  if (pushOk) {
    purged = await purgeJSDelivrData()
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
      purged: purged.length,
      counts: backup.counts,
    }),
  )
}

void main()
