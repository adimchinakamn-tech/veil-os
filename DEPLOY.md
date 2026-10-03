# Deploying Veil OS

Veil is a **full-stack app** (Next.js + 4 mini-services + Caddy gateway + SQLite) — it needs a container host, not serverless. Recommended: **Railway** or **Render**. Both have free/hobby tiers and take the included Dockerfile as-is.

> ⚠️ Vercel/Netlify alone will NOT work — they're serverless and can't run the chat socket service, SQLite database, or the Caddy gateway. (Supabase is just a hosted database — it doesn't host this app either.)

---

## 0. Push this repo to GitHub

```bash
git remote add origin https://github.com/<you>/veil.git
git push -u origin main
```

## 1. Railway (recommended)

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Railway builds the `Dockerfile` automatically (~5 min first build).
3. **Attach the volume** (required — this is your database):
   Service → **Settings** → **Volumes** → **Add Volume**:
   - Mount path: `/home/z/my-project/db`
4. Wait for the health check to pass → click the generated URL.

**Cost:** the hobby plan ($5/mo, includes $5 usage) is enough.

## 2. Render (alternative)

1. Go to [render.com](https://render.com) → **New** → **Blueprint** → point it at the repo.
2. The `render.yaml` in this repo pre-configures everything, including the 1 GB disk at `/home/z/my-project/db`.
3. Apply → wait for the build → open the URL.

**Cost:** free tier works for testing (spins down when idle); starter ~$7/mo for always-on.

## 3. Any VPS / local Docker

```bash
docker compose up --build -d
# → http://localhost:8080
```

Or with a plain Docker run:

```bash
docker build -t veil-os .
docker run -d -p 8080:80 -v veil-data:/home/z/my-project/db --name veil veil-os
```

---

## What the container runs

| Port | Service | What it is |
|------|---------|------------|
| `$PORT` (public) | Caddy | Gateway — routes `/` to Next and `?XTransformPort=N` to the services |
| 3000 | Next.js 16 | The desktop UI, APIs, Quasar proxy routes |
| 3003 | ws-relay | WebSocket tunnel for the browser engine |
| 3004 | chat-service | Veil Chat socket.io relay |
| 3031 | freetube-service | Stream section (FreeTube backend) |
| 3310 | quasar-bridge | Proxy WebSocket bridge |

All state lives in **one volume** at `/home/z/my-project/db`:
- `custom.db` — SQLite database (accounts, messages, history, shop…)
- `chat-secret.key` — chat session signing key (auto-generated on first boot)
- `.quasar-key` — proxy engine AES key (auto-generated on first boot)
- `upload/` — chat file vault (`upload/` at the project root symlinks here)

**Backups:** `docker cp veil-os:/home/z/my-project/db ./veil-backup` (or stop the container and copy the volume). The database is a single SQLite file — copy it and you've backed everything up.

## Enabling Veil AI (optional)

The AI sections (Veil AI assistant, the ai-operator) call the model gateway through `z-ai-web-dev-sdk`, which reads credentials from a `.z-ai-config` file:

```json
{"baseUrl": "https://your-endpoint/v1", "apiKey": "your-key"}
```

Deployments don't have one by default. Set it through a single env var and the boot script materializes it into the volume + project root:

- Service → **Variables** → add `ZAI_CONFIG` = the JSON above (one line).

Without it everything else works; the AI routes answer with an error.

## First boot checklist

- [ ] Health check green (Railway/Render show this)
- [ ] `https://<your-url>/` shows the Veil desktop
- [ ] Find the owner password in the deploy logs (`generated owner password: …`, first boot only — it also lives in the volume at `db/owner-password.txt`)
- [ ] Log into chat as **`Veil`** (the OWNER account, auto-seeded on first boot — same password as owner mode) for mod/owner powers everywhere
- [ ] Open a site through the browser (type a URL on the start page) — the Quasar proxy loads it

## Troubleshooting

**Build fails on `bun install --frozen-lockfile`** — the lockfile drifted; run `bun install` locally and commit the updated `bun.lock`.

**Container restarts with `prisma` errors** — make sure the volume is mounted at exactly `/home/z/my-project/db` (read-write).

**Chat connects but no messages save** — same cause: the SQLite file must be on the volume, not in the ephemeral layer.

**Veil AI / assistant returns errors** — the `ZAI_CONFIG` variable is missing or invalid (see “Enabling Veil AI” above).

**Service logs** — each service writes to `/tmp/veil-<name>.log` inside the container: `docker logs veil-os` for the boot script, `docker exec veil-os tail -50 /tmp/veil-chat.log` for the chat service.
