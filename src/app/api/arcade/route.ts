/**
 * Veil — arcade catalog API (gn-math.dev).
 *
 * Serves a clean slice of the shared arcade catalog (see
 * src/lib/veil/arcade-catalog.ts for the gn-math.dev zones loader — the
 * source xylora-style study sites use): catalog listing, featured row,
 * search, and the website's own controls — sort (Name / ID (Date)) and
 * the `special` tag filter with the site's contains-match semantics.
 * Titles play through the veil proxy, whose ad-block 204s any
 * ad/analytics network a game file references.
 *
 * Response shape:
 *   { items: [{ id, name, key, image, category, play, tags, external }],
 *     total, page, hasMore, categories, tags }
 */

import { loadArcadeCatalog, type TitleItem } from "@/lib/veil/arcade-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 60).toLowerCase();
  const cat = (sp.get("cat") ?? "").trim().toLowerCase();
  const tag = (sp.get("tag") ?? "").trim().toLowerCase();
  const hot = sp.get("hot") === "1";
  // The website's sort options: "ID (Date)" (catalog order — newest last)
  // and "Name" (localeCompare). Default mirrors the site: ID.
  const sort = sp.get("sort") === "name" ? "name" : "id";
  const page = Math.min(Math.max(Number.parseInt(sp.get("page") ?? "1", 10) || 1, 1), 40);
  // Lightweight consumers (the start-page omnibox) cap the result count.
  const limit = Math.min(Math.max(Number.parseInt(sp.get("limit") ?? "0", 10) || 0, 0), 12);

  try {
    const { titles, hot: hotTitles } = await loadArcadeCatalog();

    let pool = titles;
    if (hot && hotTitles.length > 0) pool = hotTitles;
    if (cat) {
      pool = pool.filter((g) => g.category.toLowerCase().replace(/\s+/g, "-") === cat);
    }
    if (tag) {
      // The website's filterZones2: zone.special?.includes(tag) — a title
      // with ["port","flash"] matches BOTH "port" and "flash".
      pool = pool.filter((g) => (g.tags ?? []).some((t) => t.toLowerCase() === tag));
    }
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      pool = pool.filter((g) => {
        const hay = `${g.name} ${g.key} ${g.category}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    if (sort === "name") {
      pool = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    }
    // ID order: the catalog's own (JSON / date) order — the promo card
    // (id -1) already sits first, exactly like the website's sort.

    // The full tag list for the filter dropdown, in the site's order.
    const tagList = [
      ...new Set(titles.flatMap((g: TitleItem) => g.tags ?? [])),
    ].sort();

    if (limit > 0) {
      // Omnibox mode: top matches only, no pagination envelope needed.
      return Response.json(
        { items: pool.slice(0, limit), total: pool.length },
        { headers: { "cache-control": "public, max-age=300" } }
      );
    }

    const start = (page - 1) * PAGE_SIZE;
    const items = pool.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < pool.length;

    return Response.json(
      {
        items,
        total: pool.length,
        page,
        hasMore,
        categories: [...new Set(titles.map((g: TitleItem) => g.category))].sort().slice(0, 24),
        tags: tagList,
      },
      { headers: { "cache-control": "public, max-age=300" } }
    );
  } catch {
    return Response.json(
      {
        error: "the arcade catalog is unreachable right now",
        items: [],
        total: 0,
        page,
        hasMore: false,
        categories: [],
        tags: [],
      },
      { status: 502 }
    );
  }
}
