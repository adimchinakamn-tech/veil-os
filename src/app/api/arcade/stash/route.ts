/**
 * Veil — The Stash catalog API (UGS single-file build).
 *
 * The Stash single-file list lives on the jsdelivr CDN: the CDN list file
 * holds the full file-id array (~2,950 single-file HTML titles) and every
 * title plays from
 *   https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/<id>.html
 *
 * This endpoint fetches + parses that list once (memory cache, 1 hour),
 * cleans the display names exactly like the Stash tab does (strip the "cl"
 * cloak prefix, split mushed camelCase words), and serves search results so
 * the arcade's search box finds Stash titles too — closing the gap where
 * stash-only titles ("Cluster Rush") returned "no match".
 *
 * Response shape (TitleItem-compatible):
 *   { items: [{ id, name, key, image, category, play }], total }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/games.js";
const FILE_BASE = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/";
const TTL_MS = 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface StashItem {
  id: string;
  name: string;
  key: string;
  image: string;
  category: string;
  play: string;
}

interface StashCatalog {
  at: number;
  items: StashItem[];
}

let cached: StashCatalog | null = null;
let inFlight: Promise<StashCatalog> | null = null;

/**
 * Display-name cleanup — ported from the Stash tab's cleanLabel()
 * (the locally-hosted Stash bundle) so names match exactly what the Stash
 * shows: strip the "cl" cloak prefix, split lower→Upper / upper-run /
 * digit→letter seams.
 *
 * The "cl" strip needs the full id list for context: `clusterrush` is a
 * title whose OWN name starts with "cl" (its cloaked twin `clclusterrush`
 * also exists in the list). Stripping blindly would turn it into
 * "usterrush". Rules, given the id set:
 *   - id starts with "cl" and the remainder IS another id → id is the
 *     cloak of that title; clean from the remainder (no second strip).
 *   - "cl" + id is itself another id → id is the BASE name of a cloaked
 *     pair; keep it whole (word-split only).
 *   - otherwise "cl" is the cloak prefix → strip it.
 */
function cleanLabel(raw: string, idSet: ReadonlySet<string>): string {
  let name = String(raw ?? "");
  if (name.toLowerCase().startsWith("cl") && name.length > 2) {
    const rest = name.slice(2).toLowerCase();
    const cloaked = (`cl${name}`).toLowerCase();
    if (idSet.has(rest)) {
      // cloak of an existing base id (e.g. clclusterrush → clusterrush)
      name = name.slice(2);
    } else if (idSet.has(cloaked)) {
      // base name of a cloaked pair — genuinely starts with "cl"
      // (clusterrush); keep whole.
    } else {
      name = name.slice(2);
    }
  }
  // camelCase words: "YoshisStrangeQuest" → "Yoshis Strange Quest"
  name = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  // "ADarkRoom" → "A Dark Room" (pure acronyms like "ADOFAI" stay whole)
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  // digit→letter seams: "2048cupcakes" → "2048 cupcakes" — glued product
  // names ("1v1", "2d3d") stay whole.
  name = name.replace(/(\d)([a-zA-Z])/g, (m, d: string, l: string, off: number, s: string) => {
    const next = s ? s[off + 2] : "";
    return /[0-9]/.test(String(next ?? "")) ? m : `${d} ${l}`;
  });
  return name.replace(/\s+/g, " ").trim();
}

/** The CDN's own launch normalization: append ".html" unless it has an extension. */
function fileUrl(raw: string): string {
  const normalized =
    raw.includes(".") && raw.lastIndexOf(".") > 0 ? raw : `${raw}.html`;
  return FILE_BASE + encodeURIComponent(normalized);
}

/**
 * Extract the `let files = [ ... ]` array literal from the CDN list file
 * without executing anything: scan from the first `[` to the matching `]`,
 * honoring double-quoted strings (the file is plain JSON inside a JS
 * wrapper).
 */
function parseFileList(src: string): string[] {
  const start = src.indexOf("[");
  if (start === -1) return [];
  let depth = 0;
  let inString = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (inString) {
      if (ch === "\\") {
        i++; // skip the escaped char
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const slice = src.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice) as unknown;
          if (Array.isArray(parsed)) {
            return parsed.filter((x): x is string => typeof x === "string");
          }
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

async function loadCatalog(): Promise<StashCatalog> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  if (inFlight) return inFlight;

  const task = (async () => {
    const res = await fetch(SOURCE, {
      cache: "no-store",
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const src = await res.text();

    const raw = parseFileList(src);
    // Dedupe file ids, keep original order.
    const seen = new Set<string>();
    const items: StashItem[] = [];
    const idSet = new Set(raw.map((id) => id.trim().toLowerCase()));
    for (const id of raw) {
      const key = id.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const name = cleanLabel(key, idSet) || key;
      items.push({
        id: `ugs:${key}`,
        name,
        key,
        image: "",
        category: "The Stash",
        play: fileUrl(key),
      });
    }
    const fresh: StashCatalog = { at: Date.now(), items };
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

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 60).toLowerCase();
  const limit = Math.min(
    Math.max(Number.parseInt(sp.get("limit") ?? "16", 10) || 16, 1),
    40
  );

  try {
    const { items } = await loadCatalog();

    let pool = items;
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      pool = pool.filter((g) => {
        // Match the cleaned display name AND the raw file id so both
        // "cluster rush" and "clusterrush" find the same title.
        const hay = `${g.name} ${g.key}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    return Response.json(
      { items: pool.slice(0, limit), total: pool.length },
      { headers: { "cache-control": "public, max-age=300" } }
    );
  } catch {
    return Response.json(
      { error: "the stash list is unreachable right now", items: [], total: 0 },
      { status: 502 }
    );
  }
}
