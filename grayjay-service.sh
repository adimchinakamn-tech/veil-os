#!/usr/bin/env bash
# GrayJay program service (the REAL Grayjay Desktop app, FUTO official build).
#
# The program supports an official server mode: `--server --ignore-security`
#   - headless, no CEF window, no Xvfb needed
#   - listens on ALL interfaces at port 11338
#   - `--ignore-security` disables the _token auth (server-mode-only flag)
# The web UI it serves at /web/index.html is the program's own UI; Veil
# relays it same-origin via next.config.ts rewrites.
#
# Plugin state (YouTube source) lives in the app dir (database.db + plugins/).
set -u

APP_DIR="/home/z/my-project/download/grayjay-desktop/Grayjay.Desktop-linux-x64-v17"
LOG="/home/z/my-project/download/grayjay-desktop/service.log"

if ss -tln 2>/dev/null | rg -q ':11338 '; then
  echo "grayjay program already serving on 11338"
  exit 0
fi

if ! pgrep -x "Grayjay" > /dev/null; then
  echo "$(date -u +%FT%TZ) grayjay-service: launching program (--server --ignore-security)" >> "$LOG"
  (
    cd "$APP_DIR"
    setsid ./Grayjay --server --ignore-security >> "$LOG" 2>&1 < /dev/null &
  )
fi

for i in $(seq 1 30); do
  if curl -s -m 3 -o /dev/null -w "" "http://127.0.0.1:11338/settings/Settings" 2>/dev/null && \
     curl -s -m 3 "http://127.0.0.1:11338/settings/Settings" | rg -q "settings"; then
    echo "grayjay program up on 11338 (web UI at /web/index.html)"
    exit 0
  fi
  sleep 1
done

echo "grayjay program did not come up on 11338" >&2
exit 1
