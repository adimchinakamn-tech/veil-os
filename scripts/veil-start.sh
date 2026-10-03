#!/usr/bin/env bash
# ============================================================================
# Veil start — idempotent launcher for the services + backup daemon.
#
# Safe to run any number of times (from a Bash session, from the cron
# review agent, after a machine reboot or a REVERT — snapshots restore the
# scripts themselves, so this file can revive everything).
#
# Everything is double-forked via setsid so children re-parent to PID 1
# and survive the platform's Bash-session process cleanup (plain
# `nohup … &` children are killed when the session ends — verified).
#
# Revives:
#   - veil-keeper.sh        (upload/ copy — daemon revival + REVERT WATCH
#                            that auto-restores from backup when the
#                            sandbox rolls the box back)
#   - backup-loop.sh        (5-minute snapshots, the revert insurance)
#   - dev-watchdog.sh        (v2 OOM firewall: RSS guard + MemAvailable
#                            guard + dedup + revive — the anti-reboot
#                            machinery, see scripts/dev-watchdog.sh)
#   - Next.js dev server    (port 3000, heap-capped via NODE_OPTIONS
#                            --max-old-space-size=1536 in package.json)
#   - ws-relay              (port 3003, WebSocket tunnel)
#   - freetube-service      (port 3031, the real FreeTube program)
# ============================================================================
cd /home/z/my-project || exit 1

# Close any inherited restore-lock fd: veil-start often runs as a child
# of veil-auto-restore.sh (which holds veil-restore.lock on fd 9). Every
# daemon spawned below would otherwise inherit that fd and hold the
# flock for its whole lifetime — permanently blocking future restores
# (verified live 2026-09-10: keeper + backup-loop + dev + ws-relay all
# held the lock 10 minutes after the auto-restore exited).
exec 9>&-

# ---- the keeper (daemon revival + auto-restore-on-revert) ----
# The canonical copy lives in upload/ (survives reverts); scripts/veil-keeper.sh
# is a wrapper. Sync the recovery kit into upload/ first so a revert can
# never orphan the machinery.
if [ -x scripts/backup.sh ] && [ -d upload ]; then
  mkdir -p upload/veil-kit 2>/dev/null || true
  for f in backup.sh backup-loop.sh restore.sh veil-start.sh veil-keeper.sh \
           prepare-offline-assets.sh build-veil.mjs veil-shell.html \
           veil-shell.js veil-shell.css veil-ext-packs.json dev-watchdog.sh; do
    [ -f "scripts/$f" ] && cp -f "scripts/$f" "upload/veil-kit/$f" 2>/dev/null || true
  done
  [ -f upload/veil-keeper.sh ] && cp -f upload/veil-keeper.sh upload/veil-kit/veil-keeper.sh 2>/dev/null || true
  [ -f upload/veil-auto-restore.sh ] && cp -f upload/veil-auto-restore.sh upload/veil-kit/veil-auto-restore.sh 2>/dev/null || true
fi
if pgrep -f "veil-keeper.sh" > /dev/null; then
  echo "veil-keeper already running (pid $(pgrep -f veil-keeper.sh | head -1))"
else
  ( setsid bash scripts/veil-keeper.sh > /dev/null 2>&1 < /dev/null & )
  echo "veil-keeper started (daemon revival + revert watch)"
fi

# ---- backup daemon (the whole point) ----
if pgrep -f "backup-loop.sh" > /dev/null; then
  echo "backup-loop already running (pid $(pgrep -f backup-loop.sh | head -1))"
else
  ( setsid bash scripts/backup-loop.sh > /dev/null 2>&1 < /dev/null & )
  echo "backup-loop started (snapshot every 5 min)"
fi
# Always take one snapshot right now — a reverted box restores to the
# LAST known-good state, so keep that state as fresh as possible.
bash scripts/backup.sh auto 2>/dev/null | head -1 || true

# ---- dev-watchdog v2 (OOM firewall — MUST run at all times) ----
# Memory guards + revive for the dev server. Runs every 15s; planned-
# restarts next-server before its RSS drift pushes the 3.9GB no-swap box
# into a kernel OOM (which reboots the WHOLE machine — the "random
# restart" bug).
if pgrep -f "dev-watchdog.sh" > /dev/null; then
  echo "dev-watchdog already running (pid $(pgrep -f dev-watchdog.sh | head -1))"
else
  ( setsid bash scripts/dev-watchdog.sh > /dev/null 2>&1 < /dev/null & )
  echo "dev-watchdog started (OOM firewall: RSS/MemAvailable guards + revive)"
fi

# ---- Next.js dev server (port 3000) ----
if curl -s -m 4 -o /dev/null http://localhost:3000/ 2>/dev/null; then
  echo "dev server already up (:3000)"
else
  ( setsid bun run dev >> dev.log 2>&1 < /dev/null & )
  echo "dev server starting (:3000)"
fi

# ---- ws-relay (port 3003) ----
if curl -s -m 4 http://localhost:3003/health 2>/dev/null | rg -q ok; then
  echo "ws-relay already up (:3003)"
else
  ( cd mini-services/ws-relay && setsid bun --hot index.ts >> service.log 2>&1 < /dev/null & )
  echo "ws-relay starting (:3003)"
fi

# ---- freetube-service (port 3031) ----
if curl -s -m 4 http://localhost:3031/healthz 2>/dev/null | rg -q '"ok":true'; then
  echo "freetube-service already up (:3031)"
else
  if [ -d mini-services/freetube-service ]; then
    ( cd mini-services/freetube-service && setsid bun --hot index.ts >> service.log 2>&1 < /dev/null & )
    echo "freetube-service starting (:3031)"
  else
    echo "freetube-service not installed (skipped)"
  fi
fi

# ---- chat-service (port 3004, Veil Chat realtime) ----
# Plain HTTP to the socket server answers 400 — health = port listening.
if ss -ltn 2>/dev/null | rg -q ':3004 '; then
  echo "chat-service already up (:3004)"
else
  if [ -d mini-services/chat-service ]; then
    ( cd mini-services/chat-service && setsid bun --hot index.ts >> service.log 2>&1 < /dev/null & )
    echo "chat-service starting (:3004)"
  else
    echo "chat-service not installed (skipped)"
  fi
fi

# ---- watch-party-service (port 3006, Watch Party realtime) ----
if ss -ltn 2>/dev/null | rg -q ':3006 '; then
  echo "watch-party-service already up (:3006)"
else
  if [ -d mini-services/watch-party-service ]; then
    ( cd mini-services/watch-party-service && setsid bun --hot index.ts >> service.log 2>&1 < /dev/null & )
    echo "watch-party-service starting (:3006)"
  else
    echo "watch-party-service not installed (skipped)"
  fi
fi

# ---- quasar-bridge (port 3310, WebSocket bridge for the Quasar proxy engine) ----
if curl -s -m 4 http://localhost:3310/health 2>/dev/null | rg -q ok; then
  echo "quasar-bridge already up (:3310)"
else
  if [ -d mini-services/quasar-bridge ]; then
    ( cd mini-services/quasar-bridge && setsid bun --hot index.ts >> service.log 2>&1 < /dev/null & )
    echo "quasar-bridge starting (:3310)"
  else
    echo "quasar-bridge not installed (skipped)"
  fi
fi

