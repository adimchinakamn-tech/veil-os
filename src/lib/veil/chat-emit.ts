/**
 * Veil Chat — server-side bridge to the socket relay.
 *
 * The socket.io relay runs as its own service (mini-services/chat-service,
 * port 3004) with a localhost-only admin endpoint on port 3005 (shared
 * secret). This helper lets API routes broadcast real-time events to
 * room(s) — group invites, group renames, member leaves — without the
 * relay needing to know anything about the database.
 *
 * Every call is fire-and-forget and never throws: a relay restart or a
 * hiccup must never fail the API request that triggered the broadcast.
 * Clients self-heal (they refetch DM lists on the next poll/reconnect).
 */

const EMIT_URL = "http://127.0.0.1:3005/emit"
const EMIT_SECRET = "veil-kick-9f3a1c77"

export async function emitToRooms(
  rooms: string[],
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(EMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-veil-kick-secret": EMIT_SECRET,
      },
      body: JSON.stringify({ rooms, event, payload }),
      signal: AbortSignal.timeout(2500),
    })
    return res.ok
  } catch {
    return false // relay down/restarting — clients self-heal on refetch
  }
}

/** Shorthand: broadcast to a single room. */
export function emitToRoom(
  room: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  return emitToRooms([room], event, payload)
}
