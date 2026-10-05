import { spawnSync } from "child_process"
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
 * → stamp the static CDN mirror (site/) + bump site/version.json
 * → git add+commit → git push (fails quietly until the GitHub token gets
 * Contents:write — the standing watcher will land the backlog) → on a
 * successful push, purge the jsDelivr CDN cache for the backup JSON and
 * every site/ page so the public mirror links are fresh within seconds.
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

  // ---- stamp the CDN mirror so its pages + version.json follow along ----
  try {
    const r = spawnSync("bun", ["scripts/site-build.ts"], { cwd: ROOT, encoding: "utf-8" })
    if (r.status !== 0) console.error("SITE-STAMP-FAIL " + (r.stderr || "").slice(0, 200))
  } catch {
    /* stamping is best-effort */
  }

  // ---- git: stage + commit + push (all best-effort) ----------------------
  // Browsers on the CDN copies write site/data/chat-live.json straight to
  // GitHub through the Contents API — adopt the room's remote state first
  // so a backup commit can never clobber messages sent from the links.
  git(["fetch", "origin", "main", "--quiet"])
  git(["checkout", "origin/main", "--", "site/data/chat-live.json"])
  git(["add", "-A", "backups/chat", "site", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10"])
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
  let push = git(["push", "origin", "main"])
  if (push.code !== 0) {
    // remote moved (a CDN room write landed between fetch and push) —
    // rebase this box's commit on top and retry once
    const pull = git(["pull", "--rebase", "--autostash", "origin", "main"])
    if (pull.code === 0) {
      push = git(["push", "origin", "main"])
    } else {
      git(["rebase", "--abort"])
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
