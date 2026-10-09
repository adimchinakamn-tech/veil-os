/**
 * test-bridge.ts — end-to-end check for the Quasar ws-bridge (NOT part of the
 * service; run manually with `bun test-bridge.ts`).
 *
 * It encodes the target with the shared session codec (encodeOriginSession —
 * the 0x02-prefixed per-deployment session-XOR blob the injected page hooks
 * produce; the key is shared via .quasar-key), connects to the local bridge
 * as if it were a proxied page, performs the __QUASAR_READY__ handshake,
 * sends `hello-quasar`, and prints whatever comes back (the echo server sends
 * a banner first, then echoes every message — either counts as a pass).
 *
 * Usage:
 *   bun test-bridge.ts                            # default target below
 *   bun test-bridge.ts wss://echo.websocket.events  # original target (unreachable
 *                                                    # from this sandbox: TLS/network)
 *   bun test-bridge.ts wss://ws.postman-echo.com/raw
 */

import { encodeOriginSession } from "../../src/lib/proxy/codec-server";

const PORT = 3310;
const READY_MAGIC = "__QUASAR_READY__";
// echo.websocket.events is unreachable from this environment (TLS/network);
// ws.postman-echo.com/raw echoes text messages and works. Override via argv.
const TARGET: string = process.argv[2] ?? "wss://ws.postman-echo.com/raw";

function main(): void {
  const blob = encodeOriginSession(TARGET);
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
