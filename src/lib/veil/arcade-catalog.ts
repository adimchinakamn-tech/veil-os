/**
 * Veil — shared arcade catalog loader (gn-math.dev).
 *
 * gn-math.dev is the arcade that xylora-style study sites source from: a
 * plain HTML portal whose entire catalog ships as ONE JSON "zones" file
 * (~837 titles). Every entry carries:
 *   { id, name, cover, url, author, authorLink, special?, featured? }
 * with `{COVER_URL}` / `{HTML_URL}` placeholders resolved against the
 * site's obfuscated `/s/…/` directories. Game files are direct ad-free
 * html — the site shell (which carries the rev.iq ad script) is never
 * loaded; titles play through the veil proxy, whose ad-block 204s any
 * ad/analytics network a game might reference (googletagmanager, ima3,
 * wgplayer…).
 *
 * The loader fetches the JSON once, caches it in memory for an hour and
 * falls back to the legacy gn-math.com scraper if gn-math.dev is down.
 * Consumers:
 *   - /api/arcade        (catalog listing / hot row / search)
 */

export interface TitleItem {
  id: string;
  name: string;
  key: string;
  image: string;
  category: string;
  play: string;
  /** The site's `special` tags (port / flash / emulator / fnf …) — drives
   * the tag filter exactly like the website (contains-match). */
  tags?: string[];
  /** true for off-site links (the discord “SUGGEST GAMES” card) — the
   * website opens these in a new tab; Veil routes them to the browser
   * view instead of the in-arcade player. */
  external?: boolean;
}

export interface ArcadeCatalog {
  at: number;
  titles: TitleItem[];
  hot: TitleItem[];
}

/* gn-math.dev — the xylora source. Obfuscated paths are stable per build;
 * if the JSON 404s the loader re-derives them from the homepage source. */
const GN_DEV = "https://gn-math.dev";
const ZONES_JSON_PATH =
  "/s/EE0_FEFXflkxUx5iECccXCcNRB9_GDdDXysSex5LLgFQGDgFPFIDP1U1C0ouEEEtPBc7WV82FTodSmUOQQI_.json";
const COVER_DIR_PATH =
  "/s/EE0_FEFXflkxUx5iECccXCcNRB9_GDdDXysSex5LLgFQGDgFPFIDP1U3F08uFkEtPBc7WV8/";
const HTML_DIR_PATH =
  "/s/EE0_FEFXflkxUx5iECccXCcNRB9_GDdDXysSex5LLgFQGDgFPFIDP1U8DFQnJF8MOBh9/";

/** Legacy fallback — the gn-math.com Next.js portal. */
export const ARCADE_SOURCE = `${GN_DEV}${ZONES_JSON_PATH}`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL_MS = 60 * 60 * 1000;

let cached: ArcadeCatalog | null = null;
let inFlight: Promise<ArcadeCatalog> | null = null;

/* ------------------------------------------------------------------ */
/* gn-math.dev zones JSON                                              */
/* ------------------------------------------------------------------ */

interface RawZone {
  id?: number;
  name?: string;
  cover?: string;
  url?: string;
  author?: string;
  special?: string[] | unknown;
  featured?: boolean;
}

/** slug for the search haystack ("Happy Wheels" → "happy-wheels"). */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The `special` tags become the pseudo-category (flash, port, emulator…). */
function zoneCategory(z: RawZone): string {
  const tags = Array.isArray(z.special)
    ? z.special.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  return tags.length > 0 ? tags.join(" ") : "arcade";
}

function toTitle(
  z: RawZone,
  resolve: (u: string) => string
): TitleItem | null {
  const name = (z.name ?? "").trim();
  const url = (z.url ?? "").trim();
  if (!name || !url) return null;
  // Off-site links (the discord “[!] SUGGEST GAMES” card) are kept — the
  // website lists them too (and features the first one). They carry an
  // `external` flag so the UI can open them the way the site does.
  const external = /^https?:\/\//i.test(url) && !url.includes("{HTML_URL}");
  if (!external && !url.includes("{HTML_URL}")) return null;
  const id = z.id !== undefined && Number.isFinite(z.id) ? String(z.id) : slug(name);
  const play = external ? url : resolve(url);
  if (!/^https?:\/\//i.test(play)) return null;
  const tags = Array.isArray(z.special)
    ? z.special.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  return {
    id,
    name,
    key: slug(name),
    image: z.cover ? resolve(z.cover) : "",
    category: external ? "arcade" : zoneCategory(z),
    play,
    tags,
    external,
  };
}

/** Resolve a `{COVER_URL}` / `{HTML_URL}` placeholder against the site dirs. */
function resolverFor(coverDir: string, htmlDir: string): (u: string) => string {
  return (u) =>
    u
      .replace("{COVER_URL}", coverDir)
      .replace("{HTML_URL}", htmlDir);
}

/** Fetch + parse the zones JSON; returns null when unusable. */
async function loadFromGnDev(): Promise<ArcadeCatalog | null> {
  let zonesJsonPath = ZONES_JSON_PATH;
  let coverDir = `${GN_DEV}${COVER_DIR_PATH}`;
  let htmlDir = `${GN_DEV}${HTML_DIR_PATH}`;

  // The /s/…/ paths rotate between site builds — read them straight from
  // the homepage source (const zonesURL/coverURL/htmlURL) when the pinned
  // JSON 404s, so the catalog survives upstream redeploys.
  const direct = await fetchJson<RawZone[]>(`${GN_DEV}${zonesJsonPath}?t=${Date.now()}`);
  let raw: RawZone[] | null = direct;
  if (!raw) {
    const html = await fetchText(`${GN_DEV}/`);
    if (html) {
      const pick = (re: RegExp): string | null => {
        const m = re.exec(html);
        return m ? m[1] : null;
      };
      const zones = pick(/zonesURL\s*=\s*"([^"]+\.json)"/);
      const cover = pick(/const\s+coverURL\s*=\s*"([^"]+)"/);
      const htmlUrl = pick(/const\s+htmlURL\s*=\s*"([^"]+)"/);
      if (zones && cover && htmlUrl) {
        zonesJsonPath = zones;
        coverDir = new URL(cover, `${GN_DEV}/`).href;
        htmlDir = new URL(htmlUrl, `${GN_DEV}/`).href;
        raw = await fetchJson<RawZone[]>(`${GN_DEV}${zonesJsonPath}?t=${Date.now()}`);
      }
    }
  }
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;

  const resolve = resolverFor(coverDir, htmlDir);
  const seen = new Set<string>();
  const titles: TitleItem[] = [];
  const hot: TitleItem[] = [];
  for (const z of raw) {
    const t = toTitle(z, resolve);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    titles.push(t);
    // The website forces zones[0] (the discord promo card) into the
    // featured row — mirror that exactly.
    if (z.featured === true || z.id === -1) hot.push(t);
  }
  if (titles.length === 0) return null;
  return { at: Date.now(), titles, hot };
}

/* ------------------------------------------------------------------ */
/* Legacy fallback — gn-math.com __NEXT_DATA__ scrape                  */
/* ------------------------------------------------------------------ */

interface RawComTitle {
  title?: string;
  gamekey?: string;
  iframeurl?: string;
  image?: string;
  category?: string;
}

async function loadFromGnCom(): Promise<ArcadeCatalog | null> {
  const html = await fetchText("https://gn-math.com/search");
  if (!html) return null;
  let titles: TitleItem[] = [];
  let hot: TitleItem[] = [];
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (m) {
    try {
      const data = JSON.parse(m[1]) as {
        props?: { pageProps?: Record<string, unknown> };
      };
      const pp = data.props?.pageProps ?? {};
      const collect = (v: unknown): RawComTitle[] =>
        Array.isArray(v)
          ? v.filter((x) => x && typeof x === "object" && "gamekey" in (x as object))
          : [];
      const map = (list: RawComTitle[]): TitleItem[] =>
        list
          .map((g) => {
            const key = (g.gamekey ?? "").trim();
            const name = (g.title ?? "").trim();
            if (!key || !name) return null;
            return {
              id: key,
              name,
              key,
              image: g.image ?? "",
              category: (g.category ?? "arcade").trim(),
              play:
                g.iframeurl && /^https?:\/\//i.test(g.iframeurl)
                  ? g.iframeurl
                  : `https://gn-math.com/${key}`,
            } satisfies TitleItem;
          })
          .filter((g): g is TitleItem => g !== null);
      titles = map(collect(pp.filteredGames));
      hot = map(collect(pp.hotGames));
    } catch {
      /* unusable payload */
    }
  }
  if (titles.length === 0) return null;
  const seen = new Set<string>();
  titles = titles.filter((g) => (seen.has(g.key) ? false : (seen.add(g.key), true)));
  return { at: Date.now(), titles, hot };
}

/* ------------------------------------------------------------------ */
/* Shared plumbing                                                     */
/* ------------------------------------------------------------------ */

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function loadArcadeCatalog(): Promise<ArcadeCatalog> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  if (inFlight) return inFlight;

  const task = (async () => {
    // gn-math.dev first (the xylora source), gn-math.com as the fallback.
    const fresh = (await loadFromGnDev()) ?? (await loadFromGnCom());
    if (!fresh) throw new Error("both arcade sources are unreachable");
    cached = fresh;
    return fresh;
  })();

  inFlight = task;
  try {
    return await task;
  } finally {
    inFlight = null;
  }
}
