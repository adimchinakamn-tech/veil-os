# Veil OS

A full web desktop in the browser — the whole web, through the veil.

![Veil](public/logo.svg)

Veil is a Next.js 16 application that turns the browser into an operating-system-like workspace: a start page with search, a tabbed web browser with a full proxy engine, multi-user chat with accounts and roles, an arcade of mini-apps, a media stream section, wallpapers, and more.

## What this repo is (2026-10-06 restructure)

This repo is **the exact source of the live Veil OS** — nothing here is a re-implementation or a static clone. It ships in two layers:

1. **The full app** (`src/`, `mini-services/`, `prisma/`, `public/`, `Dockerfile`) — the real Next.js 16 stack.
2. **The CDN front** (`index.html` + the `cdn/`, `site/`, `m1..m10/` stub copies) — a tiny self-contained page that streams the **live** Veil OS instance edge-to-edge. Every previously-shared public link (`site/*.html`, `m1..m10/index.xhtml`, …) now serves this front, so the "git version" is the real app: same chat, same accounts, same presence, same everything, always up to date.

> Why a front instead of a static copy? Veil is a full-stack app (Next.js + socket services + SQLite + a gateway). A static CDN like jsDelivr can't execute any of that, and a serverless deploy would fork the data (separate chat/accounts). The front solves both: static hosts serve a ~8 KB page, and users get the actual live desktop.

### Public links (jsDelivr)

```
https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/index.html
https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/m1/index.html   (…through m10)
https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/site/index.html
```

Every old page path still resolves (`…/m5/chat.html`, `…/site/arcade.xhtml`, …) — they all serve the same front.

### Other static hosts

- **Vercel** — `vercel.json` points the static output at `cdn/` (clean URLs: `/chat`, `/arcade`, …). Import the repo and deploy; no build step runs.
- **Cloudflare Pages** — serve the repo root (or `site/`); the `_headers` files ship with it.
- **InfinityFree / any FTP host** — the included GitHub Action (`.github/workflows/deploy.yml`) syncs `main` to `htdocs/` on every push; `htdocs/index.html` is the front.

### Changing where the front points

Edit the `TARGET` constant at the top of the `<script>` in `index.html` (one place), then re-copy it to the stub folders (or just edit `index.html` and re-push — the stubs are byte-identical copies):

```bash
for d in cdn site m1 m2 m3 m4 m5 m6 m7 m8 m9 m10; do
  for p in index chat arcade ai stream wallpapers music links history updates settings; do
    cp index.html "$d/$p.html"; cp index.html "$d/$p.xhtml"
  done
done
```

### Chat data & backups

A daemon snapshots the chat database to `backups/chat/latest.json` and pushes it here every 30 s. That file is (a) the off-site backup / disaster-restore source, and (b) the seed a serverless cold boot imports (see `src/lib/db.ts`). It contains **no password hashes and no DMs**.

## Features

- **🖥 Web desktop** — start page, dock navigation, tabs, fullscreen, day/night clock and weather, notification center
- **🌐 Quasar proxy engine (v1.3.8)** — browse the real web through Veil: AES-encrypted proxied URLs, streaming HTML rewriting, AST-based JS rewriting, built-in adblocker (network + DOM), SSRF guard, per-client rate limiting, cookie isolation, WebSocket bridging, HLS support
- **💬 Veil Chat** — accounts with sessions, channels (#general, #sharelinks, #links, #announcements with mod/owner gating), DMs, friends, presence, typing indicators, replies, pins, message editing with an *edited* marker, GIF picker, emoji, file uploads up to 300 MB (chunked), shop with coins, profiles, roles (owner/moderator/member), moderation tools
- **🎮 Arcade** — a bundle of playable mini-apps
- **📺 Stream** — a FreeTube-backed video section (search, channels, watch history, subscriptions with YouTube Takeout import)
- **🎨 Wallpapers** — curated image + video wallpaper packs with previews
- **🤖 Veil AI** — built-in AI assistant section

## Stack

| Layer | Tech |
|-------|------|
| App | Next.js 16 (App Router, standalone output), TypeScript 5, Tailwind CSS 4, shadcn/ui |
| Runtime | Bun (mini-services + production server) |
| Database | SQLite via Prisma ORM |
| Gateway | Caddy (routes `/` → Next, `?XTransformPort=N` → services) |
| Realtime | socket.io (chat relay), native WebSockets (browser bridge) |

```
                    ┌────────────────────────────┐
 :$PORT (public) →  │ Caddy gateway              │
                    └──┬──────────────┬──────────┘
              /        │              │ ?XTransformPort=N
        ┌────────▼───┐ └───┬──────┬──┴──────┬─────────┐
        │ Next.js    │     │      │         │         │
        │ :3000      │     │      │         │         │
        └────────────┘     │      │         │         │
                    ws-relay  chat  freetube  quasar-bridge
                    :3003     :3004  :3031     :3310
```

## Deploy the full stack (self-hosting)

See **[DEPLOY.md](DEPLOY.md)** — Railway, Render, or any VPS via the included Dockerfile. All state (database, uploads, secrets) persists in one volume.

**Vercel serverless (advanced):** delete `vercel.json` and import the repo — Vercel auto-detects Next.js. The app self-heals on serverless: it copies the schema-only `db/seed.db` to `/tmp`, restores the chat from the committed backup, and the chat falls back to 5 s REST polling when the socket service isn't there (see `src/components/veil/chat-app.tsx`). Data is per-instance and ephemeral — the live box stays canonical, so treat this as a demo deploy, not a home.

## Quick start (Docker)

```bash
docker compose up --build
# → http://localhost:8080
```

## Development

```bash
bun install
bun run db:push        # create the SQLite schema
bun run dev            # Next.js dev server on :3000

# mini-services (each in its own terminal)
cd mini-services/chat-service  && bun run dev   # :3004
cd mini-services/ws-relay      && bun run dev   # :3003
cd mini-services/freetube-service && bun run dev # :3031
cd mini-services/quasar-bridge && bun run dev   # :3310
```

Requires the gateway to route `?XTransformPort=N` to those ports (see `deploy/Caddyfile` for the production config).

## Project layout

```
index.html           CDN front — streams the live app (the "git version")
cdn/                 front copy for Vercel's static output (clean URLs)
site/, m1..m10/      front copies keeping every old public link alive
src/                 Next.js app (App Router + components)
  app/api/           Route handlers (chat, proxy, history, shop, …)
  components/veil/   The desktop UI sections
  lib/veil/quasar/   The proxy engine
mini-services/       Independent Bun services (chat, ws-relay, freetube, quasar-bridge)
prisma/              Database schema
deploy/              Production boot script + gateway config
scripts/             Dev tooling (backup, watchdog, seeds, asset generation)
public/              Static assets, wallpapers, arcade apps
backups/chat/        Auto-published chat snapshots (restore seed)
```

## Security note

The git history of this repo contains a fine-grained GitHub token that was intentionally embedded in the old static mirror's chat writer (it only has Contents access to this repo). If you fork or reuse this repo, rotate that token first.

## License

Private project — all rights reserved.
