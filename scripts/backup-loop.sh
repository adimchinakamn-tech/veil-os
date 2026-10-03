#!/usr/bin/env bash
# Veil — backup daemon loop.
#
# Runs a snapshot every 5 minutes (auto mode skips identical states, so an
# idle project writes nothing). Started detached via the double-fork +
# setsid trick (veil-start.sh) so the platform's session-end process
# cleanup cannot kill it — plain `nohup … &` dies with the session.
#
# Manual control:
#   bash scripts/backup.sh              # snapshot now
#   pkill -f backup-loop.sh             # stop the daemon
cd "$(dirname "$0")/.." || exit 1

# never inherit the restore-lock fd (see veil-start.sh) — a daemon that
# holds veil-restore.lock blocks every future emergency restore
exec 9>&- 2>/dev/null || true
LOG="$PWD/backups/backup-loop.log"
mkdir -p "$PWD/backups"
while true; do
  ./scripts/backup.sh auto >> "$LOG" 2>&1 || true
  # Trim the loop log so it cannot grow unbounded.
  [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 300 ] && \
    tail -100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  sleep 300
done
