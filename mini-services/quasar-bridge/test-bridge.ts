/**
 * test-bridge.ts — end-to-end check for the Quasar ws-bridge (NOT part of the
 * service; run manually with `bun test-bridge.ts`).
 *
 * It encodes the target with the same XOR + base64url codec the injected page
 * hooks use (secret: "quasar-v1"), connects to the local bridge as if it were
 * a proxied page, performs the __QUASAR_READY__ handshake, sends
 * `hello-quasar`, and prints whatever comes back (the echo server sends a
 * banner first, then echoes every message — either counts as a pass).
 *
 * Usage:
 *   bun test-bridge.ts                            # default target below
 *   bun test-bridge.ts wss://echo.websocket.events  # original target (unreachable
 *                                                    # from this sandbox: TLS/network)
 *   bun test-bridge.ts wss://ws.postman-echo.com/raw
 */

const PORT = 3310;
const CODEC_SECRET = "quasar-v1";
const READY_MAGIC = "__QUASAR_READY__";
// echo.websocket.events is unreachable from this environment (TLS/network);
// ws.postman-echo.com/raw echoes text messages and works. Override via argv.
const TARGET: string = process.argv[2] ?? "wss://ws.postman-echo.com/raw";

/** Matching ENCODE side of the bridge codec (XOR with rotating key + base64url). */
function encodeTarget(target: string): string {
  const bytes = new TextEncoder().encode(target);
  const key = new TextEncoder().encode(CODEC_SECRET);
  const xored = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) xored[i] = bytes[i] ^ key[i % key.length];
  let s = "";
  for (let i = 0; i < xored.length; i++) s += String.fromCharCode(xored[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function main(): void {
  const blob = encodeTarget(TARGET);
  console.log(`[test-bridge] target:   ${TARGET}`);
  console.log(`[test-bridge] encoded:  ${blob}`);

  const url = `ws://localhost:${PORT}/ws-bridge?target=${encodeURIComponent(blob)}`;
  const ws = new WebSocket(url);

  let echoed = false;
  const fail = (msg: string): never => {
    console.error(`[test-bridge] FAIL: ${msg}`);
    process.exit(1);
  };

  // Generous timeout: public echo servers can be slow, and the bridge itself
  // buffers while dialing the target.
  const timeout = setTimeout(() => fail("timed out waiting for echo"), 20000);

  ws.addEventListener("open", () => {
    console.log("[test-bridge] bridge connection open");
    // Protocol: first message must be exactly the magic string.
    ws.send(READY_MAGIC);
    // Payload can go right after — the bridge buffers it if the outbound
    // socket is still dialing.
    ws.send("hello-quasar");
  });

  ws.addEventListener("message", (ev: MessageEvent) => {
    const data =
      typeof ev.data === "string" ? ev.data : `<binary ${ev.data?.byteLength ?? "?"} bytes>`;
    console.log(`[test-bridge] received: ${data.slice(0, 300)}`);

    if (typeof ev.data === "string" && ev.data.includes("hello-quasar")) {
      echoed = true;
      clearTimeout(timeout);
      console.log("[test-bridge] PASS: got our message echoed back through the bridge");
      ws.close(1000, "test done");
      setTimeout(() => process.exit(0), 250);
    }
  });

  ws.addEventListener("error", () => {
    clearTimeout(timeout);
    fail("bridge connection error (is the bridge running on port 3310?)");
  });

  ws.addEventListener("close", (ev: CloseEvent) => {
    clearTimeout(timeout);
    if (!echoed) fail(`closed before echo (code=${ev.code} reason=${ev.reason || "-"})`);
  });
}

main();
