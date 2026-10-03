/**
 * Veil — cookie hygiene (the 431 firewall).
 *
 * History: the chat session used to be mirrored into a cookie that held
 * the WHOLE account — bio, coins, and worst of all the base64 PFP (tens
 * of KB). Cookies ride on EVERY same-origin request, so one fat profile
 * pushed the app past Node's 16KB header limit and every API call came
 * back "Request failed (431)" — which is also why dev requests filed
 * through Veil AI never reached the developer. The proxy layer had a
 * second leak: proxied pages (YouTube, wallpaper sites…) used to drop
 * their cookies onto this origin too.
 *
 * Both sources are now fixed at the root (the session mirror is slim,
 * the proxy keeps a virtual jar), but browsers that still carry the old
 * fat cookies need a sweep. No legitimate Veil cookie comes anywhere
 * near this threshold, so anything over it is debris and gets expired
 * on sight.
 */

/** a real Veil cookie is a few hundred bytes at most (slim session
 * mirror ≈ 0.5KB) — anything past this is debris from the old bugs */
const FAT_COOKIE_BYTES = 1024

/** total-jar ceiling — Node rejects requests once headers pass ~16KB,
 * so a jar this fat is one more proxied-site visit from breaking the
 * whole app again. Past it, everything non-essential goes. */
const FAT_JAR_BYTES = 8192

/** cookie names the app itself legitimately uses — protected when the
 * total-jar sweep has to fire. The session mirror also lives in
 * localStorage (the primary store), so even losing it is survivable.
 * veil_viewer scopes the server-side proxy cookie jar per browser, and
 * veil-site is the referer-less fallback router's site hint — both are
 * tiny but load-bearing for the proxy lane. */
const KEEP_NAMES = new Set([
  "veil_chat_session",
  "sidebar_state",
  "sidebar_cookies",
  "veil_viewer",
  "veil-site",
])

/** Expire every cookie whose value exceeds the fat threshold, and — if
 * the jar as a whole is still bloated (the old proxy leak dropped
 * dozens of medium cookies, not one fat one) — expire everything but
 * the app's own names. Returns how many were purged (0 = clean). */
export function purgeFatCookies(): number {
  if (typeof document === "undefined") return 0
  let purged = 0
  const sweep = (fat: (name: string, size: number) => boolean) => {
    try {
      for (const kv of document.cookie.split(";")) {
        const eq = kv.indexOf("=")
        const name = (eq === -1 ? kv : kv.slice(0, eq)).trim()
        if (!name) continue
        const value = eq === -1 ? "" : kv.slice(eq + 1)
        let size = value.length
        try {
          size = decodeURIComponent(value).length
        } catch {
          /* not valid percent-encoding — raw length already measured */
        }
        if (!fat(name, size)) continue
        /* a cookie can only be removed by matching its exact path/domain
         * attrs, which document.cookie hides — cover the realistic ones */
        for (const p of ["/", "/api"]) {
          document.cookie = `${name}=; path=${p}; max-age=0; SameSite=Lax`
          document.cookie = `${name}=; path=${p}; max-age=0`
        }
        purged++
      }
    } catch {
      /* best-effort */
    }
  }
  /* pass 1 — individually fat cookies */
  sweep((_name, size) => size > FAT_COOKIE_BYTES)
  /* pass 2 — the jar as a whole is still too heavy (accumulated medium
   * debris from the old proxy leak): keep only the app's own names */
  try {
    const total = decodeURIComponent(document.cookie).length
    if (total > FAT_JAR_BYTES) {
      sweep((name, _size) => !KEEP_NAMES.has(name))
    }
  } catch {
    /* ignore */
  }
  return purged
}

/** One sweep per client boot — called at module scope of the root page
 * component, so it runs before any section has fired its first fetch
 * and even the very first API call of a fat-cookie browser goes out
 * clean. No-op on the server. */
export function purgeFatCookiesOnBoot(): void {
  if (typeof window === "undefined") return
  purgeFatCookies()
}
