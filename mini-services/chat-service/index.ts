import { createServer } from "http"
import { createHmac, timingSafeEqual } from "crypto"
import { readFileSync } from "fs"
import { Server, Socket } from "socket.io"

/**
 * Veil Chat — real-time WebSocket service.
 *
 * Frontend clients connect via the gateway: `io("/?XTransformPort=3004")`.
 * The Caddy gateway rewrites that to this server (path MUST be "/").
 *
 * AUTH (2026-09 hardening — the "chat leak" fix): `identify` REQUIRES a signed
 * session token minted by /api/chat-auth at login/register. The token is
 * HMAC-SHA256(base64url(payloadJSON), shared secret) and carries the account's
 * identity snapshot; this service verifies the signature + expiry and uses
 * ONLY the payload fields — client-claimed identity is ignored entirely, so
 * a socket can no longer impersonate anyone (including mods/admin). Sockets
 * that never identify successfully cannot subscribe, message, or type.
 *
 * Events handled:
 *   - identify         { token }  (identity comes FROM the token)
 *   - subscribe        { channel } | { channelId }
 *   - unsubscribe      { channel } | { channelId }
 *   - message          { channel | channelId, content, id?, replyTo?, ... }
 *   - typing           { channel | channelId }
 *   - stop_typing      { channel | channelId }
 *   - message_deleted  { channel | channelId, messageId }
 *
 * Events emitted back to clients:
 *   - message, typing, stop_typing, message_deleted, presence, presence_diff
 *
 * Persisted messages live in the Next.js Prisma DB (POST /api/chat-data).
 * This service only relays real-time events — but never anonymously.
 */

const PORT = 3004

// Shared with src/lib/chat-auth.ts (same box) — the HMAC signing secret.
// The Next.js side SELF-HEALS a missing key (mints + persists one on first
// use), so a failed read here is never cached: the next identify re-reads
// the file and picks the healed key up live, without a relay restart.
const SECRET_PATH = "/home/z/my-project/db/chat-secret.key"
let cachedSecret: Buffer | null = null
function sessionSecret(): Buffer | null {
  if (cachedSecret) return cachedSecret
  try {
    const txt = readFileSync(SECRET_PATH, "utf-8").trim()
    if (!txt) return null
    cachedSecret = Buffer.from(txt, "utf-8")
    return cachedSecret
  } catch {
    return null // missing/unreadable — retry on the next call
  }
}

interface TokenPayload {
  id: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
  role: string
  iat: number
  exp: number
}

function verifyToken(token: unknown): TokenPayload | null {
  if (typeof token !== "string" || !token) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null
  try {
    const secret = sessionSecret()
    if (!secret) return null
    const expected = createHmac("sha256", secret)
      .update(body)
      .digest("base64url")
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"))
    if (!payload || typeof payload.id !== "string" || !payload.id) return null
    if (typeof payload.username !== "string" || !payload.username) return null
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null
    if (typeof payload.displayName !== "string" || !payload.displayName) {
      payload.displayName = payload.username
    }
    if (typeof payload.avatarColor !== "string" || !payload.avatarColor) {
      payload.avatarColor = "#f97316"
    }
    return payload as TokenPayload
  } catch {
    return null
  }
}

// Simple per-socket flood guard: burst 25 messages / 10s window.
const MSG_WINDOW_MS = 10_000
const MSG_BURST = 25

interface AccountSession {
  accountId: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
  /** signed role from the token — powers the #announcements gate */
  role: string
}

interface ChannelPresence {
  // socket.id -> AccountSession
  [socketId: string]: AccountSession
}

const httpServer = createServer()

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses "/" to route to this service.
  path: "/",
  // Wildcard handshake origin is fine BECAUSE every meaningful event
  // (subscribe/message/typing) now requires a signed session token — an
  // cross-site socket can connect but can neither read nor speak. The
  // offline file build connects from file:// (Origin: "null"), so pinning
  // specific origins would break it.
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// socket.id -> Set<channelId>
const socketChannels = new Map<string, Set<string>>()
// channelId -> Map<socket.id, AccountSession>
const channelPresence = new Map<string, ChannelPresence>()

function resolveChannel(payload: { channel?: string; channelId?: string }): string | null {
  const c = payload.channel || payload.channelId
  if (!c || typeof c !== "string") return null
  return c.trim().toLowerCase()
}

function publicPresence(channelId: string) {
  const map = channelPresence.get(channelId)
  if (!map) return []
  return Object.values(map).map((s) => ({
    accountId: s.accountId,
    username: s.username,
    displayName: s.displayName,
    avatarColor: s.avatarColor,
    avatarImage: s.avatarImage,
  }))
}

function broadcastPresence(channelId: string) {
  io.to(channelId).emit("presence", {
    channelId,
    users: publicPresence(channelId),
  })
}

function joinChannel(socket: Socket, channelId: string, account?: AccountSession) {
  socket.join(channelId)
  let set = socketChannels.get(socket.id)
  if (!set) {
    set = new Set()
    socketChannels.set(socket.id, set)
  }
  set.add(channelId)

  if (account) {
    let map = channelPresence.get(channelId)
    if (!map) {
      map = {}
      channelPresence.set(channelId, map)
    }
    map[socket.id] = account
  }
  broadcastPresence(channelId)
}

function leaveChannel(socket: Socket, channelId: string) {
  socket.leave(channelId)
  const set = socketChannels.get(socket.id)
  if (set) {
    set.delete(channelId)
    if (set.size === 0) socketChannels.delete(socket.id)
  }
  const map = channelPresence.get(channelId)
  if (map) {
    delete map[socket.id]
    if (Object.keys(map).length === 0) {
      channelPresence.delete(channelId)
    } else {
      broadcastPresence(channelId)
    }
  }
}

io.on("connection", (socket: Socket) => {
  console.log(`[veil-chat] connected: ${socket.id}`)

  // Identity comes ONLY from a verified signed token (set on `identify`).
  let account: AccountSession | undefined
  // Per-socket flood guard state.
  const msgTimestamps: number[] = []

  socket.on("identify", (data: { token?: unknown }) => {
    try {
      // Client-claimed identity fields are IGNORED — only the signed
      // payload's snapshot is trusted.
      const payload = verifyToken(data && (data as { token?: unknown }).token)
      if (!payload) {
        account = undefined
        socket.emit("error", {
          message:
            "identify failed — invalid or expired session. Please sign in again.",
        })
        return
      }
      account = {
        accountId: payload.id,
        username: payload.username,
        displayName: payload.displayName || payload.username,
        avatarColor: payload.avatarColor || "#f97316",
        avatarImage:
          typeof payload.avatarImage === "string" ? payload.avatarImage : null,
        role: typeof payload.role === "string" ? payload.role : "member",
      }
      // Update presence for every channel this socket is already in.
      for (const cid of socketChannels.get(socket.id) ?? []) {
        const map = channelPresence.get(cid) ?? {}
        map[socket.id] = account
        channelPresence.set(cid, map)
        broadcastPresence(cid)
      }
      socket.emit("identified", { ok: true })
    } catch (err) {
      console.error("[veil-chat] identify error", err)
      socket.emit("error", { message: "identify failed" })
    }
  })

  socket.on("subscribe", (data: { channel?: string; channelId?: string }) => {
    try {
      // Unauthenticated sockets may not join any channel.
      if (!account) {
        socket.emit("error", { message: "not identified — cannot subscribe" })
        return
      }
      const channelId = resolveChannel(data || {})
      if (!channelId) {
        socket.emit("error", { message: "subscribe requires a channel" })
        return
      }
      joinChannel(socket, channelId, account)
      socket.emit("subscribed", { channelId })
    } catch (err) {
      console.error("[veil-chat] subscribe error", err)
    }
  })

  socket.on("unsubscribe", (data: { channel?: string; channelId?: string }) => {
    try {
      const channelId = resolveChannel(data || {})
      if (!channelId) return
      leaveChannel(socket, channelId)
      socket.emit("unsubscribed", { channelId })
    } catch (err) {
      console.error("[veil-chat] unsubscribe error", err)
    }
  })

  socket.on("message", (data: {
    channel?: string
    channelId?: string
    id?: string
    content?: string
    replyTo?: string | null
    replyToContent?: string | null
    replyToUsername?: string | null
    [k: string]: unknown
  }) => {
    try {
      // Must be a verified identity to broadcast.
      if (!account) {
        socket.emit("error", { message: "not identified — cannot send" })
        return
      }
      const channelId = resolveChannel(data)
      if (!channelId) {
        socket.emit("error", { message: "message requires a channel" })
        return
      }
      // Must be subscribed to broadcast into a channel.
      const set = socketChannels.get(socket.id)
      if (!set || !set.has(channelId)) {
        socket.emit("error", { message: "not subscribed to channel " + channelId })
        return
      }
      // #links + #announcements — only moderators and the owner may post.
      // The owner is the "Veil" operator (username match, same as the UI's
      // isMod + chat-mod's isSuperAdmin) — role alone is not enough: a wiped
      // db can leave the operator account at role "member", which locked the
      // owner out of the very channels the UI unlocked for them.
      if (
        (channelId === "links" || channelId === "announcements") &&
        account.role !== "moderator" &&
        account.role !== "admin" &&
        account.username.toLowerCase() !== "veil"
      ) {
        socket.emit("error", { message: `only moderators and the owner can post in #${channelId}` })
        return
      }
      // Flood guard: MSG_BURST messages per MSG_WINDOW_MS, then drops.
      const now = Date.now()
      while (msgTimestamps.length && now - msgTimestamps[0] > MSG_WINDOW_MS) {
        msgTimestamps.shift()
      }
      if (msgTimestamps.length >= MSG_BURST) {
        socket.emit("error", { message: "slow down — too many messages" })
        return
      }
      msgTimestamps.push(now)
      const payload = {
        channelId,
        id: data.id || null,
        content: data.content ?? "",
        replyTo: data.replyTo ?? null,
        replyToContent: data.replyToContent ?? null,
        replyToUsername: data.replyToUsername ?? null,
        account: {
          accountId: account.accountId,
          username: account.username,
          displayName: account.displayName,
          avatarColor: account.avatarColor,
          avatarImage: account.avatarImage,
        },
        ts: Date.now(),
        // NOTE: socket.id is deliberately NOT broadcast — internal session
        // identifiers never leave the relay.
      }
      // Relay to everyone in the channel (including the sender, so clients can
      // confirm delivery & dedupe by id).
      io.to(channelId).emit("message", payload)
    } catch (err) {
      console.error("[veil-chat] message error", err)
    }
  })

  socket.on("typing", (data: { channel?: string; channelId?: string }) => {
    try {
      if (!account) return
      const channelId = resolveChannel(data)
      if (!channelId) return
      const set = socketChannels.get(socket.id)
      if (!set || !set.has(channelId)) return
      socket.to(channelId).emit("typing", {
        channelId,
        account: {
          accountId: account.accountId,
          username: account.username,
          displayName: account.displayName,
        },
      })
    } catch (err) {
      console.error("[veil-chat] typing error", err)
    }
  })

  socket.on("stop_typing", (data: { channel?: string; channelId?: string }) => {
    try {
      if (!account) return
      const channelId = resolveChannel(data)
      if (!channelId) return
      const set = socketChannels.get(socket.id)
      if (!set || !set.has(channelId)) return
      socket.to(channelId).emit("stop_typing", {
        channelId,
        account: {
          accountId: account.accountId,
          username: account.username,
          displayName: account.displayName,
        },
      })
    } catch (err) {
      console.error("[veil-chat] stop_typing error", err)
    }
  })

  socket.on("message_deleted", (data: {
    channel?: string
    channelId?: string
    messageId?: string
  }) => {
    try {
      if (!account) return
      const channelId = resolveChannel(data)
      if (!channelId || !data.messageId) return
      const set = socketChannels.get(socket.id)
      if (!set || !set.has(channelId)) return
      io.to(channelId).emit("message_deleted", {
        channelId,
        messageId: data.messageId,
      })
    } catch (err) {
      console.error("[veil-chat] message_deleted error", err)
    }
  })

  socket.on("disconnect", () => {
    try {
      const set = socketChannels.get(socket.id)
      if (set) {
        for (const cid of set) {
          leaveChannel(socket, cid)
        }
      }
      socketChannels.delete(socket.id)
      console.log(`[veil-chat] disconnected: ${socket.id}`)
    } catch (err) {
      console.error("[veil-chat] disconnect error", err)
    }
  })

  socket.on("error", (err: unknown) => {
    console.error(`[veil-chat] socket error (${socket.id})`, err)
  })
})

// ---------------------------------------------------------------------------
// Internal admin endpoint (localhost :3005, shared-secret) — lets the Next.js
// mod API immediately disconnect a banned/muted user's sockets.
// ---------------------------------------------------------------------------

const KICK_PORT = 3005
const KICK_SECRET = "veil-kick-9f3a1c77"

function socketsForUsername(username: string): Socket[] {
  const target = username.trim().toLowerCase()
  const found: Socket[] = []
  for (const [sid, s] of io.sockets.sockets) {
    // The account hint lives in the closure passed to `identify`; recover it
    // from the presence maps instead of reaching into closures.
    for (const map of channelPresence.values()) {
      const session = map[sid]
      if (session && session.username.toLowerCase() === target) {
        found.push(s)
        break
      }
    }
  }
  return found
}

const kickServer = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/kick")) {
    res.statusCode = 404
    res.end()
    return
  }
  // Localhost only + shared secret.
  const remote = req.socket.remoteAddress || ""
  if (!/^127\.0\.0\.1$|^::1$|^::ffff:127\.0\.0\.1$/.test(remote)) {
    res.statusCode = 403
    res.end()
    return
  }
  if (req.headers["x-veil-kick-secret"] !== KICK_SECRET) {
    res.statusCode = 403
    res.end()
    return
  }
  let body = ""
  req.on("data", (c: Buffer) => {
    body += c.toString()
    if (body.length > 200_000) req.destroy()
  })
  req.on("end", () => {
    try {
      // Two payloads:
      //   { username }                         → kick their sockets
      //   { username, purge: [{channelId, messageId}] }
      //                                       → kick AND broadcast per-message
      //                                         message_deleted events for the
      //                                         banned user's purged messages,
      //                                         so every online client drops
      //                                         them live (no reload needed).
      const { username, purge } = JSON.parse(body || "{}") as {
        username?: string
        purge?: { channelId?: string; messageId?: string }[]
      }
      if (!username) {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: "username required" }))
        return
      }
      const sockets = socketsForUsername(username)
      for (const s of sockets) {
        s.emit("error", { message: "You have been disconnected by a moderator." })
        s.disconnect(true)
      }
      let purged = 0
      if (Array.isArray(purge)) {
        for (const p of purge) {
          if (!p || typeof p.channelId !== "string" || typeof p.messageId !== "string") continue
          io.to(p.channelId).emit("message_deleted", {
            channelId: p.channelId,
            messageId: p.messageId,
          })
          purged++
        }
      }
      console.log(
        `[veil-chat] kicked @${username} (${sockets.length} socket(s))` +
          (purged ? `, purged ${purged} message(s)` : ""),
      )
      res.end(JSON.stringify({ ok: true, kicked: sockets.length, purged }))
    } catch (err) {
      console.error("[veil-chat] kick error", err)
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false }))
    }
  })
})

kickServer.listen(KICK_PORT, "127.0.0.1", () => {
  console.log(`[veil-chat] kick endpoint on 127.0.0.1:${KICK_PORT}`)
})

httpServer.listen(PORT, () => {
  console.log(`[veil-chat] WebSocket server running on port ${PORT}`)
})

process.on("SIGTERM", () => {
  console.log("[veil-chat] SIGTERM, shutting down...")
  io.close(() => {
    httpServer.close(() => process.exit(0))
  })
})

process.on("SIGINT", () => {
  console.log("[veil-chat] SIGINT, shutting down...")
  io.close(() => {
    httpServer.close(() => process.exit(0))
  })
})
