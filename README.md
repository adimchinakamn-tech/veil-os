# Veil OS

A full web desktop in the browser — the whole web, through the veil.

![Veil](public/logo.svg)

Veil is a Next.js 16 application that turns the browser into an operating-system-like workspace: a start page with search, a tabbed web browser with a full proxy engine, multi-user chat with accounts and roles, an arcade of mini-apps, a media stream section, wallpapers, and more.

## Features

- **🖥 Web desktop** — start page, dock navigation, tabs, fullscreen, day/night clock and weather, notification center
- **🌐 Quasar proxy engine (v1.3.8)** — browse the real web through Veil: AES-encrypted proxied URLs, streaming HTML rewriting, AST-based JS rewriting, built-in adblocker (network + DOM), SSRF guard, per-client rate limiting, cookie isolation, WebSocket bridging, HLS support
- **💬 Veil Chat** — accounts with sessions, channels (#general, #sharelinks, #links, #announcements with mod/owner gating), DMs, friends, presence, typing indicators, replies, pins, GIF picker, emoji, file uploads up to 300 MB (chunked), shop with coins, profiles, roles (owner/moderator/member), moderation tools
- **🎮 Arcade** — a bundle of playable mini-apps
- **📺 Stream** — a FreeTube-backed video section
- **🎨 Wallpapers** — curated image + video wallpaper packs
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

## Quick start (Docker)

```bash
docker compose up --build
# → http://localhost:8080
```

All state (database, uploads, secrets) persists in the `veil-data` volume.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — Railway and Render both work with the included Dockerfile in a few clicks.

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
src/                Next.js app (App Router + components)
  app/api/          Route handlers (chat, proxy, history, shop, …)
  components/veil/  The desktop UI sections
  lib/veil/quasar/  The proxy engine
mini-services/      Independent Bun services (chat, ws-relay, freetube, quasar-bridge)
prisma/             Database schema
deploy/             Production boot script + gateway config
scripts/            Dev tooling (backup, watchdog, seeds, asset generation)
public/             Static assets, wallpapers, arcade apps
```

## License

Private project — all rights reserved.
