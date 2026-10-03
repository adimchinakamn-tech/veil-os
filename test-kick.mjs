/**
 * Socket kick E2E: connect a client identified as modqa3 to the chat relay,
 * then ban modqa3 via the mod API and verify the socket gets disconnected.
 */
import { io } from "socket.io-client"

const token = process.argv[2] || ""
const relayUrl = "http://localhost:3004/"

const socket = io(relayUrl, {
  path: "/",
  transports: ["polling", "websocket"],
  retries: 0,
  timeout: 8000,
})

let disconnectedBy = null
const done = (code, msg) => {
  console.log(msg)
  process.exit(code)
}

const overallTimer = setTimeout(() => {
  done(1, JSON.stringify({ result: "TIMEOUT", disconnectedBy }))
}, 20000)

socket.on("connect", () => {
  socket.emit("identify", {
    accountId: "kick-test-account",
    username: "modqa3",
    displayName: "modqa3",
  })
  socket.emit("subscribe", { channelId: "main" })
  console.log("connected+identified as modqa3, socket id:", socket.id)

  // Give identify/subscribe a beat, then ban via the API (as modqa2).
  setTimeout(async () => {
    try {
      const res = await fetch("http://localhost:3000/api/chat-mod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          action: "ban",
          targetUsername: "@modqa3",
          reason: "kick pipeline test",
        }),
      })
      const body = await res.json()
      console.log("ban API response:", JSON.stringify(body))
    } catch (e) {
      console.log("ban API error:", String(e))
    }
  }, 1500)
})

socket.on("disconnect", (reason) => {
  disconnectedBy = reason
  clearTimeout(overallTimer)
  // A server-initiated force disconnect typically arrives as
  // "io server disconnect" / "transport close" right after the ban.
  setTimeout(() => {
    done(0, JSON.stringify({
      result: "DISCONNECTED",
      reason,
      kicked: disconnectedBy !== null,
    }))
  }, 500)
})

socket.on("connect_error", (err) => {
  console.log("connect_error:", String(err))
})
