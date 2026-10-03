#!/usr/bin/env bash
# ============================================================================
# github-push-watch.sh — background one-shot watcher.
#
# STATE (2026-10-03): the user CREATED the private repo
#   https://github.com/adimchinakamn-tech/veil-os   ✓
# but the fine-grained PAT is scoped to "Only select repositories"
# (the 3 old ones) → every push fails with
#   403 "Write access to repository not granted".
#
# The moment the user adds veil-os to the token's Repository access list
# (github.com/settings/personal-access-tokens → the token → Repository
# access), this watcher detects it and pushes the whole repo automatically.
#
# Probe: GET /repos/adimchinakamn-tech/veil-os with the token → succeeds AND
# reports "push": true (write-capable). A repo merely made public would
# answer 200 with push:false — no premature push.
#
# Polls every 30s for up to 6h. Idempotent: exits immediately if this main
# SHA is already verified on the remote. Log: tmp/github-push-watch.log
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

OWNER="adimchinakamn-tech"
REPO="veil-os"
LOG="tmp/github-push-watch.log"
mkdir -p tmp

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

TOKEN="$(sed -n 's#https://[^:]*:\([^@]*\)@github\.com#\1#p' ~/.git-credentials 2>/dev/null | head -1)"
if [ -z "$TOKEN" ]; then
  log "no token in ~/.git-credentials — exiting"
  exit 1
fi

LOCAL_SHA="$(git rev-parse main 2>/dev/null)"
if [ -z "$LOCAL_SHA" ]; then
  log "no local main branch — exiting"
  exit 1
fi

# idempotency: already pushed + verified this exact SHA?
if grep -q "^.* VERIFIED $LOCAL_SHA " "$LOG" 2>/dev/null; then
  log "watcher start (pid $$) — $LOCAL_SHA already verified, nothing to do"
  exit 0
fi

log "watcher start (pid $$) — waiting for token write access to $OWNER/$REPO (local main $LOCAL_SHA)"

for i in $(seq 1 720); do
  # write-access probe: HTTP 200 AND token permissions.push == true
  if curl -sf --max-time 15 -H "Authorization: Bearer $TOKEN" \
       "https://api.github.com/repos/$OWNER/$REPO" 2>/dev/null \
       | grep -q '"push": *true'; then
    log "write access granted — pushing main"
    if git push -u origin main >> "$LOG" 2>&1; then
      log "PUSH OK (normal)"
    else
      log "normal push rejected — retrying with --force (auto-init README case)"
      if git push --force -u origin main >> "$LOG" 2>&1; then
        log "FORCE PUSH OK"
      else
        log "push failed even with --force — check credentials/history, exiting"
        exit 1
      fi
    fi
    # verify the remote actually holds our commit — re-read main HERE:
    # new commits may have landed locally while the watcher was waiting
    sleep 5
    REMOTE_SHA="$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)"
    HEAD_SHA="$(git rev-parse main)"
    if [ "$REMOTE_SHA" = "$HEAD_SHA" ]; then
      log "VERIFIED $HEAD_SHA → https://github.com/$OWNER/$REPO"
      exit 0
    else
      log "MISMATCH remote='$REMOTE_SHA' local-main='$HEAD_SHA' — exiting"
      exit 1
    fi
  fi
  sleep 30
done
log "watcher timeout after 6h — giving up (re-run scripts/github-push-watch.sh if needed)"
