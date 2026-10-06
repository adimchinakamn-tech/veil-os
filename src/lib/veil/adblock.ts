/**
 * Veil — cross-site ad, tracker and popup-network blocklist.
 *
 * Two consumers:
 *  - The proxy route returns an empty 204 for any request whose target host
 *    matches, so ad/tracker payloads never reach the rendered page.
 *  - The injected runtime script embeds the same host pattern to kill
 *    window.open popup ads and hide ad elements that are already on the page.
 */

function esc(s: string): string {
  return s.replace(/\./g, "\\.");
}

/** Ad / tracker / popup-ad network domains (exact host or any subdomain). */
export const AD_HOSTS: string[] = [
  // — Google ads & measurement —
  "doubleclick.net",
  "googlesyndication.com",
  "googletagservices.com",
  "googleadservices.com",
  "adservice.google.com",
  "google-analytics.com",
  "analytics.google.com",
  "app-measurement.com",
  "googletagmanager.com",
  "pagead.l.google.com",

  // — Major ad exchanges / SSPs / DSPs —
  "amazon-adsystem.com",
  "adnxs.com",
  "adform.net",
  "adroll.com",
  "criteo.com",
  "criteo.net",
  "criteo.io",
  "casalemedia.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "openxenterprise.com",
  "indexww.com",
  "bidswitch.net",
  "sharethrough.com",
  "media.net",
  "servenobids.com",
  "smartadserver.com",
  "sonobi.com",
  "yieldmo.com",
  "33across.com",
  "gumgum.com",
  "spotxchange.com",
  "spotx.tv",
  "teads.tv",
  "springserve.com",
  "adscale.de",
  "adition.com",
  "serving-sys.com",
  "adtechjp.com",
  "advertising.com",
  "betrad.com",

  // — Content-recommendation widgets —
  "taboola.com",
  "outbrain.com",
  "outbrainimg.com",
  "zergnet.com",
  "mgid.com",
  "revcontent.com",
  "engageya.com",
  "content-ad.com",
  "adblade.com",
  "nativo.com",
  "dstillery.com",
  "liadm.com",
  "addthis.com",
  "addthisedge.com",
  "sharethis.com",

  // — Game-portal & arcade ad SDKs (gn-math games embed some of these) —
  "imasdk.googleapis.com", // Google IMA video-ad SDK
  "wgplayer.com", // universal.wgplayer.com — WG player-ad wrapper
  "aip.in", // player.aip.in / tags.aip.in — AdinPlay pre-roll video ads (bloxd.io)
  "sdk.crazygames.com", // CrazyGames ad SDK embedded by bloxd.io
  "solve.crazygames.com", // CrazyGames ad-solve endpoint
  "rev.iq", // js.rev.iq — RevenueHits (the gn-math.dev site shell)
  "r9x.in", // cdn.r9x.in — gn-math's runtime ad layer (avConfig rewarded slots)
  "profitableratecpmnetwork.com", // gn-math.dev's first-click popunder
  "profitableratecpm.com", // same popunder family, alternate domain
  "accuracyinstalled.com", // gn-math.dev's /ac/ad/…js direct-ad loader
  "monetag.com", // popunder/prebid wrapper
  "vignette.js", // monetag vignette loader
  "adsterra.com", // adsterra direct ads
  "adsterratech.com",
  "vidoomy.com", // video ad network
  "freestar.io", // publisher ad manager
  "playwire.com", // revenue management ads
  "mediavine.com", // ad management
  "rtmark.net", // propellerads sibling
  "goadservices.com",
  "luckyadspro.com",

  // — Popup / popunder / redirect-ad networks —
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "propellerclick.com",
  "exoclick.com",
  "exosrv.com",
  "juicyads.com",
  "trafficjunky.net",
  "clickadu.com",
  "onclickads.net",
  "onclasrv.com",
  "adcash.com",
  "zeropark.com",
  "adsupply.com",
  "popmyads.com",
  "adinplay.com",
  "a-ads.com",
  "adskeeper.com",
  "adstract.com",

  // — Viewability / verification —
  "moatads.com",
  "adsafeprotected.com",
  "doubleverify.com",
  "integralads.com",
  "nielsen.com",
  "scorecardresearch.com",
  "quantserve.com",
  "quantcount.com",
  "comscore.com",

  // — Session analytics / heatmaps —
  "hotjar.com",
  "hotjar.io",
  "mouseflow.com",
  "fullstory.com",
  "clarity.ms",
  "chartbeat.com",
  "chartbeat.net",
  "parsely.com",

  // — Social pixels & tracking —
  "connect.facebook.net",
  "ads-twitter.com",
  "static.ads-twitter.com",
  "analytics.twitter.com",
  "bat.bing.com",
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "an.yandex.ru",
  "mc.yandex.ru",
  "yandex-metrica.com",
  "top-mail.ru",
  "buzzoola.com",

  // — Adult-network ad servers &amp; tracking metrics (observed hammering
  // the proxy at 2-2.5s per request in dev logs — every one of these
  // was a full wasted upstream fetch through /api/p) —
  "pemsrv.com",
  "exoclick.com",
  "exosrv.com",
  "exdynsrv.com",
  "realsrv.com",
  "ero-advertising.com",
  "tsyndicate.com",
  "tjk-njk.com",
  "grtbt.com",
  "novibet.partners",
  "wsrv.nl",
  "histats.com",
  "addthis.com",
  "sharethis.com",
];

// Scrub any accidental whitespace in the list (defensive).
const CLEAN = AD_HOSTS.map((d) => d.trim().toLowerCase()).filter(
  (d) => d && /^[a-z0-9.-]+$/.test(d)
);

/** True when the host itself, or any of its subdomains, is a known ad host. */
export function isAdHost(host: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const d of CLEAN) {
    if (h === d || h.endsWith("." + d)) return true;
  }
  return false;
}

/**
 * Regex source matching a *hostname* against the blocklist.
 * Embedded into the injected runtime script so client-side popup blocking and
 * DOM scrubbing use exactly the same list as the server.
 */
export const AD_HOST_RE_SOURCE: string =
  "(?:^|\\.)(" + CLEAN.map(esc).join("|") + ")$";
