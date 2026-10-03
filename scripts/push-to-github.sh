#!/usr/bin/env bash
# ============================================================================
# push-to-github.sh — publish the Veil OS repo to GitHub (idempotent).
#
# Target: https://github.com/adimchinakamn-tech/veil-os (private)
#
# The fine-grained PAT used on this box has Contents:write (can push) but
# NOT Administration:write (cannot create repos). So:
#   1. If the repo doesn't exist yet, TRY to create it via the API
#      (works once the token is upgraded with Administration:write, or
#      never fails if the user already created it in the web UI).
#   2. Push main with upstream tracking (credentials come from
#      ~/.git-credentials — already configured).
#
# Safe to re-run any number of times. Used by the dev agent + cron reviewer.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

OWNER="adimchinakamn-tech"
REPO="veil-os"

TOKEN="$(sed -n 's#https://[^:]*:\([^@]*\)@github\.com#\1#p' ~/.git-credentials 2>/dev/null | head -1)"
if [ -z "$TOKEN" ]; then
  echo "push-to-github: no token in ~/.git-credentials" >&2
  exit 1
fi

# 1) create the repo when possible (skip silently when it exists / no perm)
if ! curl -sf -o /dev/null "https://api.github.com/repos/$OWNER/$REPO" \
     -H "Authorization: Bearer $TOKEN"; then
  echo "[push] repo missing — trying to create $OWNER/$REPO …"
  curl -s -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$REPO\",\"private\":true,\"has_wiki\":false,\"auto_init\":false}" \
    | rg -o '"message": "[^"]*"' || true
fi

# 2) push (needs Contents:write — the token has it)
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$REPO.git"
git push -u origin main
echo "[push] done → https://github.com/$OWNER/$REPO"
