#!/usr/bin/env bash
# ============================================================================
# Veil OS — production boot script (Docker / Railway / Render / VPS)
#
# Boots the whole stack with per-service revival loops:
#   1. state dirs + secrets (auto-generated on first boot, in the volume)
#   2. idempotent prisma schema push
#   3. Next.js standalone (:3000) + 4 mini-services + Caddy gateway (:$PORT)
#
# All persistent state lives under db/ (the single volume):
#   db/custom.db        SQLite database
#   db/chat-secret.key  chat session HMAC secret
#   db/.quasar-key      proxy-engine AES key (via QUASAR_KEY_FILE)
#   db/upload/          chat file vault (upload/ symlinks here)
# ============================================================================
set -u
cd /home/z/my-project

echo "[veil] boot at $(date -u +%FT%TZ) — public port ${PORT:-80}"

# ---- 1) state dirs + secrets ------------------------------------------------
mkdir -p db/upload/veil-chat-files

# upload/ is a compatibility symlink into the volume: chat-file uploads land
# in db/upload/veil-chat-files even though the code writes to upload/…
rm -rf upload
ln -sfn db/upload upload

# chat HMAC secret — the account-session signing key. Auto-generate on the
# very first boot; afterwards it persists in the volume (regenerating it
# would invalidate every signed chat session).
if [ ! -s db/chat-secret.key ]; then
  head -c 48 /dev/urandom | base64 | tr -d '\n' > db/chat-secret.key
  echo "[veil] generated new db/chat-secret.key"
fi
chmod 600 db/chat-secret.key 2>/dev/null || true

# quasar AES key: QUASAR_KEY_FILE points at db/.quasar-key (volume) and the
# codec auto-creates it when missing — nothing to do here.

# owner password (used until the owner sets their own in-app): generated on
# first boot, persisted in the volume, echoed here once. The repo carries NO
# default password — a public repo must never ship working owner credentials.
if [ -z "${OWNER_DEFAULT_PASSWORD:-}" ]; then
  if [ ! -s db/owner-password.txt ]; then
    head -c 18 /dev/urandom | base64 | tr -d '\n' > db/owner-password.txt
    chmod 600 db/owner-password.txt
    echo "[veil] generated owner password → db/owner-password.txt (set your own in-app: Updates → Owner Mode → Password)"
  fi
  OWNER_DEFAULT_PASSWORD=$(cat db/owner-password.txt)
  export OWNER_DEFAULT_PASSWORD
fi

# ---- 2) database schema (idempotent) ----------------------------------------
echo "[veil] pushing prisma schema…"
bunx prisma db push --accept-data-loss --skip-generate 2>&1 | tail -2

# ---- 3) services, each under a revival loop ---------------------------------
# Plain `command &` dies silently; each service runs inside a while-loop in
# its own background subshell and self-revives 2s after any crash.
svc_next() {
  cd /home/z/my-project
  # Next standalone listens on process.env.PORT — the PLATFORM port must go
  # to Caddy, so pin Next to 3000 explicitly.
  PORT=3000 HOSTNAME=0.0.0.0 exec bun .next/standalone/server.js
}
svc_chat() {
  cd /home/z/my-project/mini-services/chat-service && exec bun index.ts
}
svc_ws() {
  cd /home/z/my-project/mini-services/ws-relay && exec bun index.ts
}
svc_freetube() {
  cd /home/z/my-project/mini-services/freetube-service && exec bun index.ts
}
svc_bridge() {
  cd /home/z/my-project/mini-services/quasar-bridge && exec bun index.ts
}
svc_caddy() {
  cd /home/z/my-project && exec caddy run --config deploy/Caddyfile --adapter caddyfile
}
export -f svc_next svc_chat svc_ws svc_freetube svc_bridge svc_caddy

for svc in caddy next chat ws freetube bridge; do
  nohup bash -c \
    "while true; do svc_$svc; echo \"[\$(date -u +%T)] $svc exited (\$?) — revival in 2s\"; sleep 2; done" \
    >> "/tmp/veil-$svc.log" 2>&1 &
  echo "[veil] $svc supervised (log: /tmp/veil-$svc.log)"
done

# ---- 4) live forever ---------------------------------------------------------
echo "[veil] all services up"
exec wait
