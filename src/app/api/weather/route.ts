/**
 * Veil — weather chip API.
 *
 * Location: exactly what whatismyip.com-style sites do — IP geolocation.
 *  1. The BROWSER fetches ipwho.is directly (its request carries the
 *     visitor's real public IP, which the gateway/CDN chain hides from
 *     the server) and passes lat/lon (?lat=&lon=&place=).
 *  2. Server-side fallback: the client IP from X-Forwarded-For /
 *     X-Real-IP geo-located via ipwho.is (ip-api.com fallback), trusted
 *     only when its timezone matches the browser's (?tz=…).
 *  3. Timezone reference city ("America/New_York" → "New York"),
 *     geocoded to exact coordinates.
 *
 * Weather: Open-Meteo (open-source, keyless) POINT forecast at the exact
 * resolved coordinates — a real weather-model interpolation at that
 * spot. wttr.in resolved coordinates to a coarse "nearest area" which
 * could sit dozens of km away and read a few degrees off; Open-Meteo
 * queries the model grid cell that actually contains the point.
 *
 * Responses carry { tempC, feelsC, desc, code, humidity, place, sunrise,
 * sunset, updatedAt } — sunrise/sunset are local to the resolved
 * location; `code` is the WMO weather code (drives the chip icon; -1 when
 * the answering provider has no code). Failures return 204 and the chip
 * simply hides.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fresh enough for the every-minute chip refresh — the client polls at
 * 60s, so a 60s server cache means each poll gets genuinely new data
 * while identical locations stay deduped against the provider. */
const WEATHER_TTL_MS = 60 * 1000;
const LOC_TTL_MS = 24 * 60 * 60 * 1000;
/* Browser-shaped fingerprint for the geo/forecast data APIs: a bare
 * undici fetch (no UA, undici TLS handshake) is trivially flagged by
 * CDNs. met.no is the exception — its terms REQUIRE an identifying UA,
 * so it keeps Veil/1.0 below. */
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface Loc {
  query: string; // "lat,lon" (Open-Meteo ready)
  name: string; // display place, "" when unknown
}

interface GeoIp {
  lat: number;
  lon: number;
  city: string;
  tz: string;
}

const weatherCache = new Map<string, { at: number; payload: Record<string, unknown> }>();
const locCache = new Map<string, { at: number; loc: Loc }>();

/* ------------------------------------------------------------------ */
/* Client IP extraction                                                */
/* ------------------------------------------------------------------ */

function isPublicIp(raw: string): boolean {
  const ip = raw.trim().toLowerCase();
  if (!ip || ip === "localhost" || ip === "::1" || ip === "::" || ip === "0.0.0.0") return false;
  if (ip.startsWith("::ffff:")) return isPublicIp(ip.slice(7));
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return false;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.") || ip.startsWith("0.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return true;
  return ip.includes(":"); // other public IPv6
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    for (const part of xff.split(",")) {
      if (isPublicIp(part)) return part.trim();
    }
  }
  const real = req.headers.get("x-real-ip");
  if (real && isPublicIp(real)) return real.trim();
  return "";
}

/* ------------------------------------------------------------------ */
/* Geo-IP (no key, server-side only)                                   */
/* ------------------------------------------------------------------ */

async function geoIp(ip: string): Promise<GeoIp | null> {
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
      headers: { "user-agent": BROWSER_UA, accept: "application/json" },
    });
    if (r.ok) {
      const d = (await r.json()) as {
        success?: boolean;
        latitude?: number;
        longitude?: number;
        city?: string;
        country_code?: string;
        timezone?: { id?: string };
      };
      if (d.success && Number.isFinite(d.latitude) && Number.isFinite(d.longitude)) {
        return {
          lat: d.latitude as number,
          lon: d.longitude as number,
          city: [d.city, d.country_code].filter(Boolean).join(", "),
          tz: d.timezone?.id ?? "",
        };
      }
    }
  } catch {
    /* try fallback */
  }
  try {
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon,city,countryCode,timezone`,
      { signal: AbortSignal.timeout(6000), cache: "no-store", headers: { "user-agent": BROWSER_UA, accept: "application/json" } }
    );
    if (r.ok) {
      const d = (await r.json()) as {
        status?: string;
        lat?: number;
        lon?: number;
        city?: string;
        countryCode?: string;
        timezone?: string;
      };
      if (d.status === "success" && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
        return {
          lat: d.lat as number,
          lon: d.lon as number,
          city: [d.city, d.countryCode].filter(Boolean).join(", "),
          tz: d.timezone ?? "",
        };
      }
    }
  } catch {
    /* give up */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Timezone → reference city → coordinates                             */
/* ------------------------------------------------------------------ */

function tzCity(tz: string): string {
  if (!tz || !tz.includes("/")) return "";
  const city = (tz.split("/").pop() ?? "").replace(/_/g, " ");
  if (!city || /^(utc|gmt|etc)$/i.test(city)) return "";
  return city;
}

/** Common IANA timezone reference cities with exact coordinates —
 *  answers instantly for ~95% of users without a geocoding round-trip. */
const TZ_COORDS: Record<string, [number, number]> = {
  "america/new_york": [40.7128, -74.006],
  "america/chicago": [41.8781, -87.6298],
  "america/denver": [39.7392, -104.9903],
  "america/phoenix": [33.4484, -112.074],
  "america/los_angeles": [34.0522, -118.2437],
  "america/toronto": [43.6532, -79.3832],
  "america/vancouver": [49.2827, -123.1207],
  "america/mexico_city": [19.4326, -99.1332],
  "america/sao_paulo": [-23.5505, -46.6333],
  "america/buenos_aires": [-34.6037, -58.3816],
  "america/bogota": [4.711, -74.0721],
  "america/lima": [-12.0464, -77.0428],
  "europe/london": [51.5072, -0.1276],
  "europe/dublin": [53.3498, -6.2603],
  "europe/lisbon": [38.7223, -9.1393],
  "europe/madrid": [40.4168, -3.7038],
  "europe/paris": [48.8566, 2.3522],
  "europe/berlin": [52.52, 13.405],
  "europe/amsterdam": [52.3676, 4.9041],
  "europe/brussels": [50.8476, 4.3572],
  "europe/rome": [41.9028, 12.4964],
  "europe/milan": [45.4642, 9.19],
  "europe/zurich": [47.3769, 8.5417],
  "europe/vienna": [48.2082, 16.3738],
  "europe/prague": [50.0755, 14.4378],
  "europe/warsaw": [52.2297, 21.0122],
  "europe/stockholm": [59.3293, 18.0686],
  "europe/oslo": [59.9139, 10.7522],
  "europe/copenhagen": [55.6761, 12.5683],
  "europe/helsinki": [60.1699, 24.9384],
  "europe/athens": [37.9838, 23.7275],
  "europe/istanbul": [41.0082, 28.9784],
  "europe/kiev": [50.4501, 30.5234],
  "europe/moscow": [55.7558, 37.6173],
  "africa/cairo": [30.0444, 31.2357],
  "africa/lagos": [6.5244, 3.3792],
  "africa/johannesburg": [-26.2041, 28.0473],
  "africa/nairobi": [-1.2921, 36.8219],
  "asia/dubai": [25.2048, 55.2708],
  "asia/riyadh": [24.7136, 46.6753],
  "asia/tehran": [35.6892, 51.389],
  "asia/karachi": [24.8607, 67.0011],
  "asia/kolkata": [22.5726, 88.3639],
  "asia/dhaka": [23.8103, 90.4125],
  "asia/bangkok": [13.7563, 100.5018],
  "asia/jakarta": [-6.2088, 106.8456],
  "asia/singapore": [1.3521, 103.8198],
  "asia/hong_kong": [22.3193, 114.1694],
  "asia/shanghai": [31.2304, 121.4737],
  "asia/taipei": [25.033, 121.5654],
  "asia/seoul": [37.5665, 126.978],
  "asia/tokyo": [35.6762, 139.6503],
  "australia/perth": [-31.9523, 115.8613],
  "australia/brisbane": [-27.4698, 153.0251],
  "australia/sydney": [-33.8688, 151.2093],
  "australia/melbourne": [-37.8136, 144.9631],
  "australia/auckland": [-36.8485, 174.7633],
  "pacific/honolulu": [21.3099, -157.8583],
};

const geoCodeCache = new Map<string, { at: number; lat: number; lon: number }>();

/** City name → coordinates via Open-Meteo's geocoder (keyless). */
async function geocode(city: string): Promise<{ lat: number; lon: number } | null> {
  const key = city.toLowerCase();
  const hit = geoCodeCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 24 * 60 * 60 * 1000) return hit;
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      { signal: AbortSignal.timeout(6000), cache: "no-store", headers: { "user-agent": BROWSER_UA, accept: "application/json" } }
    );
    if (r.ok) {
      const d = (await r.json()) as {
        results?: { latitude?: number; longitude?: number }[];
      };
      const g = d.results?.[0];
      if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
        const out = { at: Date.now(), lat: g.latitude as number, lon: g.longitude as number };
        geoCodeCache.set(key, out);
        if (geoCodeCache.size > 256) geoCodeCache.clear();
        return out;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function resolveLoc(ip: string, tz: string): Promise<Loc> {
  const geo = ip ? await geoIp(ip) : null;
  const city = tzCity(tz);
  const tzMatches = Boolean(geo && tz && geo.tz && geo.tz.toLowerCase() === tz.toLowerCase());

  if (geo && (tzMatches || !city)) {
    // IP geolocation is either confirmed by the browser timezone or the
    // only signal we have — use its coordinates (most precise).
    return { query: `${geo.lat},${geo.lon}`, name: geo.city };
  }
  if (city) {
    // No usable IP, or the IP's timezone disagrees with the browser's —
    // the IP is likely a relay/datacenter hop. The timezone's reference
    // city is the better guess for where the human actually is.
    const coord = TZ_COORDS[tz.toLowerCase()] ?? (await geocode(city));
    if (coord) return { query: `${coord[0]},${coord[1]}`, name: city };
  }
  if (geo) return { query: `${geo.lat},${geo.lon}`, name: geo.city };
  return { query: "40.7128,-74.006", name: "New York" }; // last resort
}

/* ------------------------------------------------------------------ */
/* Weather fetch — Open-Meteo point forecast                           */
/* ------------------------------------------------------------------ */

/** Open-Meteo / WMO weather interpretation codes → text. */
const WMO_TEXT: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Rain showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm, light hail",
  99: "Thunderstorm, hail",
};

/** Night-time variants — "Clear sky" reads wrong at 9 PM, and the sun
 *  icon that comes with it reads worse. Only the codes whose day text
 *  implies daylight get a night form. */
const WMO_TEXT_NIGHT: Record<number, string> = {
  0: "Clear night",
};

/* ------------------------------------------------------------------ */
/* Day / night — the chip must know when the sun is down               */
/* ------------------------------------------------------------------ */

/** Solar elevation (°) at a point, right now — compact NOAA-style
 *  series (~0.01° accuracy). Day = sun above the −0.833° horizon
 *  (top-of-disk + refraction, the civil "is it light out" line).
 *
 *  Needed because wttr.in's WWO descriptions are day-blind: a clear
 *  night is reported as "Sunny" at 9 PM, midnight, whenever. Open-Meteo
 *  hands us `is_day` for free; this covers everyone else (and the wttr
 *  translation) without a timezone round-trip. */
function solarIsDay(lat: number, lon: number, when: Date = new Date()): boolean {
  const rad = Math.PI / 180;
  const n = when.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * rad; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * rad; // obliquity
  const delta = Math.asin(Math.sin(eps) * Math.sin(lambda)); // declination
  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / rad; // right ascension (°)
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24; // sidereal hours
  let H = ((gmst * 15 + lon - alpha) % 360 + 540) % 360 - 180; // hour angle
  const h =
    Math.asin(
      Math.sin(lat * rad) * Math.sin(delta) + Math.cos(lat * rad) * Math.cos(delta) * Math.cos(H * rad)
    ) / rad;
  return h > -0.833;
}

/** WWO/wttr day-blind words → what it actually looks like at night. */
function nightDesc(desc: string): string {
  const d = desc.trim().toLowerCase();
  if (d === "sunny" || d === "clear" || d === "sunny/clear" || d === "clear/sunny") return "Clear night";
  return desc;
}

/** lat,lon → coordinates, null when malformed. */
function parseLatLon(query: string): { lat: number; lon: number } | null {
  const [latS, lonS] = query.split(",").map((s) => s.trim());
  const lat = Number(latS);
  const lon = Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function hhmm(iso: string | undefined): string {
  if (!iso) return "";
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : "";
}

async function fetchWeather(loc: Loc): Promise<Record<string, unknown> | null> {
  /* Provider chain: Open-Meteo (point forecast) → wttr.in (WWO data,
     keyless) → met.no (Yr, keyless). Any one answering keeps the chip
     alive — Open-Meteo rate-limits per IP per day, wttr/meto cover it. */
  const viaOpenMeteo = await openMeteo(loc);
  if (viaOpenMeteo) return viaOpenMeteo;
  const viaWttr = await wttrIn(loc);
  if (viaWttr) return viaWttr;
  return metNo(loc);
}

async function openMeteo(loc: Loc): Promise<Record<string, unknown> | null> {
  try {
    const [latS, lonS] = loc.query.split(",").map((s) => s.trim());
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const u = new URL("https://api.open-meteo.com/v1/forecast");
    u.searchParams.set("latitude", lat.toFixed(4));
    u.searchParams.set("longitude", lon.toFixed(4));
    u.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day"
    );
    u.searchParams.set("daily", "sunrise,sunset");
    u.searchParams.set("timezone", "auto");
    u.searchParams.set("forecast_days", "1");
    const res = await fetch(u.href, {
      /* the primary provider is occasionally SLOW (verified 5–10 s for
         far-away points) — give it room, and keep the fallback budget
         tight so the whole cascade stays under ~26 s */
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
      headers: { "user-agent": "Veil/1.0 (+https://veil.app)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        is_day?: number;
      };
      daily?: { sunrise?: string[]; sunset?: string[] };
    };
    const c = data.current;
    const tempC = Number(c?.temperature_2m);
    if (!Number.isFinite(tempC)) return null;
    const code = Number(c?.weather_code);
    /* Open-Meteo answers is_day for THE PINNED/RESOLVED POINT — a Tokyo pin
       reads Tokyo's night even while the browser sits in New York. Fall
       back to the solar calc when the field is absent. */
    const isDay =
      c?.is_day === 0 ? false : c?.is_day === 1 ? true : solarIsDay(lat, lon);
    return {
      tempC: Math.round(tempC),
      feelsC: Math.round(Number(c?.apparent_temperature ?? tempC)),
      desc: (isDay ? WMO_TEXT[code] : WMO_TEXT_NIGHT[code] ?? WMO_TEXT[code]) ?? "—",
      code: Number.isFinite(code) ? code : -1,
      isDay,
      humidity: Number(c?.relative_humidity_2m ?? NaN),
      place: loc.name,
      sunrise: hhmm(data.daily?.sunrise?.[0]),
      sunset: hhmm(data.daily?.sunset?.[0]),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/* "06:07 AM" (wttr astronomy) → "06:07" 24h */
function ampmTo24(s: string | undefined): string {
  if (!s) return "";
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s.trim());
  if (!m) return hhmm(s);
  let h = Number(m[1]);
  if (/pm/i.test(m[3]) && h < 12) h += 12;
  if (/am/i.test(m[3]) && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

async function wttrIn(loc: Loc): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(loc.query)}?format=j1`,
      {
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
        headers: { "user-agent": "Veil/1.0 (+https://veil.app)" },
      }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      current_condition?: {
        temp_C?: string;
        FeelsLikeC?: string;
        humidity?: string;
        weatherDesc?: { value?: string }[];
      }[];
      weather?: { astronomy?: { sunrise?: string; sunset?: string }[] }[];
    };
    const c = d.current_condition?.[0];
    const tempC = Number(c?.temp_C);
    if (!Number.isFinite(tempC)) return null;
    const astro = d.weather?.[0]?.astronomy?.[0];
    /* WWO text is day-blind — "Sunny" at 9 PM is normal for it. The sun
       itself is not day-blind: solar elevation decides, then the words
       follow (Sunny/Clear → Clear night). */
    const ll = parseLatLon(loc.query);
    const isDay = ll ? solarIsDay(ll.lat, ll.lon) : true;
    const rawDesc = c?.weatherDesc?.[0]?.value?.trim() || "";
    return {
      tempC: Math.round(tempC),
      feelsC: Math.round(Number(c?.FeelsLikeC ?? tempC)),
      desc: isDay ? rawDesc || "—" : nightDesc(rawDesc) || "—",
      code: -1, // wttr has no WMO code mapping — the client falls back by desc
      isDay,
      humidity: Number(c?.humidity ?? NaN),
      place: loc.name,
      sunrise: ampmTo24(astro?.sunrise),
      sunset: ampmTo24(astro?.sunset),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/* met.no symbol_code → readable text (subset of the full table) */
const METNO_TEXT: Record<string, string> = {
  clearsky: "Clear sky", fair: "Mainly clear", partlycloudy: "Partly cloudy", cloudy: "Overcast",
  fog: "Fog", rainsnow: "Rain and snow", rain: "Rain", lightrain: "Light rain",
  heavyrain: "Heavy rain", rainshowers: "Rain showers", snow: "Snow", lightsnow: "Light snow",
  heavysnow: "Heavy snow", snowshowers: "Snow showers", sleet: "Sleet", lightsleet: "Light sleet",
};

async function metNo(loc: Loc): Promise<Record<string, unknown> | null> {
  try {
    const [latS, lonS] = loc.query.split(",").map((s) => s.trim());
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const res = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      {
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
        headers: { "user-agent": "Veil/1.0 (+https://veil.app)" }, // met.no requires an identifying UA
      }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      properties?: {
        timeseries?: {
          data?: {
            instant?: { details?: { air_temperature?: number; relative_humidity?: number } };
            next_1_hours?: { summary?: { symbol_code?: string } };
          };
        }[];
      };
    };
    const t = d.properties?.timeseries?.[0];
    const tempC = Number(t?.data?.instant?.details?.air_temperature);
    if (!Number.isFinite(tempC)) return null;
    const sym = t?.data?.next_1_hours?.summary?.symbol_code || "";
    /* met.no is the one provider that DOES mark time of day — the symbol
       carries a _day/_night suffix. Read it before stripping. */
    const suffix = /_(day|night|polartwilight|midnight|polarday)$/.exec(sym)?.[1];
    const base = sym.replace(/_(day|night|polartwilight|midnight|polarday)$/, "");
    const ll = parseLatLon(loc.query);
    const isDay =
      suffix === "day" || suffix === "polarday"
        ? true
        : suffix === "night" || suffix === "midnight"
          ? false
          : ll
            ? solarIsDay(ll.lat, ll.lon)
            : true;
    const dayText = METNO_TEXT[base] ?? (base ? base.replace(/([a-z])([A-Z])/g, "$1 $2") : "—");
    return {
      tempC: Math.round(tempC),
      feelsC: Math.round(tempC),
      desc: !isDay && base === "clearsky" ? "Clear night" : dayText,
      code: -1,
      isDay,
      humidity: Number(t?.data?.instant?.details?.relative_humidity ?? NaN),
      place: loc.name,
      sunrise: "",
      sunset: "",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const tz = (url.searchParams.get("tz") || "").trim();
  const ip = clientIp(req);

  /* Client-side geo (the whatismyip.com approach): the BROWSER fetched
     ipwho.is directly — its request carries the visitor's real public IP,
     which the gateway/CDN chain hides from us. Trust the reported
     coordinates over any server-side IP guess. */
  const qLat = Number(url.searchParams.get("lat"));
  const qLon = Number(url.searchParams.get("lon"));
  const qPlace = (url.searchParams.get("place") || "").trim().slice(0, 80);
  const hasClientGeo =
    Number.isFinite(qLat) &&
    Number.isFinite(qLon) &&
    qLat >= -90 &&
    qLat <= 90 &&
    qLon >= -180 &&
    qLon <= 180;

  const locKey = hasClientGeo
    ? `geo:${qLat.toFixed(3)},${qLon.toFixed(3)}`
    : ip
      ? `ip:${ip}|${tz}`
      : tz
        ? `tz:${tz}`
        : "server";

  let locEntry = locCache.get(locKey);
  if (!locEntry || Date.now() - locEntry.at > LOC_TTL_MS) {
    const loc: Loc = hasClientGeo
      ? {
          query: `${qLat.toFixed(4)},${qLon.toFixed(4)}`,
          name: qPlace || "",
        }
      : await resolveLoc(ip, tz);
    locEntry = { at: Date.now(), loc };
    locCache.set(locKey, locEntry);
    if (locCache.size > 512) {
      // keep the cache bounded in pathological cases
      const oldest = [...locCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 256);
      for (const [k] of oldest) locCache.delete(k);
    }
  }

  let entry = weatherCache.get(locEntry.loc.query);
  if (!entry || Date.now() - entry.at > WEATHER_TTL_MS) {
    const payload = await fetchWeather(locEntry.loc);
    if (!payload) {
      /* short failure memo — don't hammer all three providers on every
         chip refresh while everything is down/limited. 75 s = ONE poll
         cycle (the chip polls every 60 s): the very next poll retries
         the providers instead of serving a stale miss for minutes. */
      weatherCache.set(locEntry.loc.query, { at: Date.now() - WEATHER_TTL_MS + 75 * 1000, payload: { __fail: true } as Record<string, unknown> });
      return new Response(null, { status: 204 });
    }
    entry = { at: Date.now(), payload };
    weatherCache.set(locEntry.loc.query, entry);
    if (weatherCache.size > 64) {
      const oldest = [...weatherCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 32);
      for (const [k] of oldest) weatherCache.delete(k);
    }
  }
  if ((entry.payload as { __fail?: boolean }).__fail) return new Response(null, { status: 204 });

  return Response.json(entry.payload, {
    headers: { "cache-control": "no-store" },
  });
}
