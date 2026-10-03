#!/usr/bin/env bash
# Veil Chat — jsDelivr backup daemon loop (2026-10-03 wipe-recovery).
#
# Every 30 seconds: snapshot the chat DB to backups/chat/*.json when anything
# changed, git-commit it, and try to publish to github.com/ok5678765s/veil-os
# so the backup is permanently reachable at
#   https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/backups/chat/latest.json
# (the push fails quietly until the fine-grained token gets Contents:write —
# the standing github-push watcher will land the backlog the moment it does,
# and this loop keeps the repo current from then on).
#
# Manual control:
#   bun scripts/chat-backup.ts --force    # snapshot + commit + push now
#   pkill -f chat-backup-loop.sh          # stop the daemon
cd "$(dirname "$0")/.." || exit 1

LOG="$PWD/backups/chat/loop.log"
mkdir -p "$PWD/backups/chat"
while true; do
  bun scripts/chat-backup.ts >> "$LOG" 2>&1 || true
  # Trim the loop log so it cannot grow unbounded.
  [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 400 ] && \
    tail -120 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  sleep 30
done
