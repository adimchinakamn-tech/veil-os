/**
 * Veil — server-side URL routing engine.
 *
 * URL scheme: /api/p/{scheme}/{host}/{path}?{query}
 *   e.g. https://example.com/a/b.css  ->  /api/p/https/example.com/a/b.css
 *
 * This "scheme as first path segment" format keeps relative URL resolution
 * working inside the rendered page (via an injected <base> tag) while every
 * static reference is explicitly resolved to an absolute route URL.
 */

import { AD_HOST_RE_SOURCE } from "@/lib/veil/adblock";

export const ROUTE_PREFIX = "/api/p/";

const SKIP_SCHEME =
  /^(data:|blob:|javascript:|mailto:|tel:|about:|sms:|ftp:|irc:|magnet:|ws:|wss:|chrome:|chrome-extension:|moz-extension:|intent:|itms:|market:)/i;

/** Build a route URL from an absolute http(s) target URL. */
export function toRouteUrl(target: string): string {
  if (!target) return target;
  if (target.startsWith(ROUTE_PREFIX)) return target;
  const replaced = target.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//, "$1/");
  return ROUTE_PREFIX + replaced;
}

/** Extract the target URL from an incoming request path (returns null if invalid). */
export function extractTarget(pathname: string, search: string): string | null {
  if (!pathname.startsWith(ROUTE_PREFIX)) return null;
  let raw = pathname.slice(ROUTE_PREFIX.length);
  // Defensive: tolerate the legacy "https://host" style in case anything
  // normalised the double slash.
  raw = raw.replace(/^(https?):\/\//i, "$1/");
  const m = raw.match(/^(https?)\/([^/]+)(.*)$/i);
  if (!m) return null;
  const target = `${m[1].toLowerCase()}://${m[2]}${m[3]}${search}`;
  try {
    const u = new URL(target);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Resolve a reference against the page URL, then convert to a route URL. */
export function resolveAndRoute(value: string, baseUrl: string): string {
  const v = value.trim();
  if (!v) return v;
  if (SKIP_SCHEME.test(v)) return v;
  if (v.startsWith(ROUTE_PREFIX)) return v;
  try {
    const abs = new URL(v, baseUrl);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return v;
    return toRouteUrl(abs.href);
  } catch {
    return v;
  }
}

/** Rewrite url(...) and @import references inside CSS text. */
export function rewriteCss(css: string, baseUrl: string): string {
  if (!css) return css;
  let out = css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (_m: string, _q: string, u: string) => {
      const routed = resolveAndRoute(u, baseUrl);
      return `url("${routed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
    }
  );
  out = out.replace(
    /@import\s+(['"])([^'"]+)\1/gi,
    (_m: string, _q: string, u: string) => `@import "${resolveAndRoute(u, baseUrl)}"`
  );
  return out;
}

const ABS_URL_RE = /https?:\/\/[^\s"'<>\\`]+/gi;

/**
 * Rewrite absolute http(s) URLs inside plain-text bodies (JSON / XML / m3u8).
 * Keeps resources that SPAs set at runtime (video streams, images, feed
 * items) on this origin so they are fetched through the proxy.
 */
export function rewriteTextUrls(text: string, baseUrl: string): string {
  if (!text || (!text.includes("http://") && !text.includes("https://"))) return text;
  return text.replace(ABS_URL_RE, (m: string) => {
    try {
      return resolveAndRoute(m, baseUrl);
    } catch {
      return m;
    }
  });
}

/** Conservative stylesheet hiding the most common ad slots. */
const AD_HIDE_CSS =
  `<style data-veil-ads>ins.adsbygoogle,.adsbygoogle,[id^="div-gpt-ad"],[id^="google_ads_"],[id^="google_dfp_"],.gpt-ad,[class^="gpt-ad-"],iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[src*="taboola"],iframe[src*="outbrain"],.AdBanner{display:none!important;}</style>`;

/**
 * The leak seal — injected as a <meta http-equiv="Content-Security-Policy">
 * on every proxied HTML page. Everything the rewriter produces is
 * same-origin, so 'self' covers all legitimate subresources; blob:/data:
 * cover runtime-generated media (players, canvas exports, MSE), and the
 * script/style directives keep inline + eval site code working. Anything
 * that would have escaped DIRECTLY to a third-party host (missed URL,
 * runtime-built request, WebSocket) is refused here instead — that request
 * would have exposed the visitor's real IP to the site's servers.
 *
 * Note: meta CSP cannot set frame-ancestors (irrelevant here — the page
 * is served top-level, not framed) and is additive with any page-set CSP.
 */
const CSP_VALUE =
  `default-src 'self' blob: data:; ` +
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; ` +
  `style-src 'self' 'unsafe-inline' blob: data:; ` +
  `img-src 'self' blob: data:; ` +
  `font-src 'self' blob: data:; ` +
  `media-src 'self' blob: data: mediastream:; ` +
  `connect-src 'self' blob: data:; ` +
  `frame-src 'self' blob: data:; ` +
  `object-src 'self' blob:; ` +
  `worker-src 'self' blob:; ` +
  `base-uri 'self'; ` +
  `form-action 'self'`;

/**
 * Script injected into every rendered HTML page.
 *
 * Responsibilities:
 *  - postMessage sync with the parent app (nav / title / error / mouse)
 *  - runtime request routing: fetch / XHR / sendBeacon calls issued by the
 *    page's own JS are re-pointed through the proxy (fixes SPAs like YouTube
 *    whose API calls would otherwise hit this server directly and 404)
 *  - SPA history sync: pushState / popstate are reported so the parent URL
 *    bar and back/forward stack track in-page navigations
 *  - ad + popup blocking: window.open to ad hosts is killed, runtime-injected
 *    ad elements are removed/hidden, beforeunload traps are muted
 *  - document.cookie relay: cookies the page sets client-side are stored in
 *    the server-side jar so sessions survive across reloads
 */
export function controlScript(pageUrl: string, cookies?: string[]): string {
  const urlJson = JSON.stringify(pageUrl).replace(/</g, "\\u003c");
  const prefixJson = JSON.stringify(ROUTE_PREFIX).replace(/</g, "\\u003c");
  const adReJson = JSON.stringify(AD_HOST_RE_SOURCE).replace(/</g, "\\u003c");
  const cookiesJson = JSON.stringify(cookies ?? []).replace(/</g, "\\u003c");
  return `<script data-veil-ctrl>(function(){
  /* self-conceal: page JS must not find the proxy marker in the DOM */
  try{if(document.currentScript&&document.currentScript.removeAttribute)document.currentScript.removeAttribute("data-veil-ctrl")}catch(e){}
  var P=${prefixJson},BASE=${urlJson},ADRE=${adReJson},CK=${cookiesJson};
  var CUR=BASE;
  var RF=window.fetch;
  var AD=null;try{AD=new RegExp(ADRE,"i")}catch(e){}
  function isAdHost(h){try{return AD?AD.test(String(h||"").toLowerCase()):false}catch(e){return false}}
  function send(t,d){try{parent.postMessage({__veil:1,type:t,url:CUR,d:d||{}},"*")}catch(e){}}

  // ---- virtual cookie jar (per-site) ----
  // Proxied pages must NEVER touch this origin's REAL cookie jar: real
  // cookies ride on every later request to the app (the Cookie header),
  // and heavy sites (YouTube & friends) set dozens of them — the header
  // swells past Node's 16KB limit and the whole app starts failing with
  // 431s. The jar here is virtual and relayed to the server-side jar.
  var JAR={},Cpend=[],CflushT=0,Chost="";
  try{Chost=new URL(BASE).hostname}catch(e){}
  function jarFlush(){
    CflushT=0;
    try{RF.call(window,"/api/veil-cookie",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({host:Chost,cookies:Cpend})})}catch(e){}
    Cpend=[];
  }
  function vcSet(v,relay){
    try{
      var s=String(v),seg=s.split(";"),nv=seg[0]||"",eq=nv.indexOf("=");
      var name=(eq===-1?nv:nv.slice(0,eq)).trim();
      if(!name)return;
      var value=(eq===-1?"":nv.slice(eq+1)).trim();
      var dead=false;
      for(var j=1;j<seg.length;j++){
        var p=seg[j].trim().toLowerCase();
        if(p.indexOf("max-age")===0&&parseInt(p.slice(8),10)<=0)dead=true;
        else if(p.indexOf("expires")===0){
          var dt=Date.parse(seg[j].trim().slice(8));
          if(!isNaN(dt)&&dt<=Date.now())dead=true;
        }
      }
      if(dead)delete JAR[name];else JAR[name]=value;
      if(relay){Cpend.push(s);if(!CflushT)CflushT=setTimeout(jarFlush,400)}
    }catch(e){}
  }
  function vcGet(){
    var out=[];
    for(var k in JAR)if(Object.prototype.hasOwnProperty.call(JAR,k))out.push(k+"="+JAR[k]);
    return out.join("; ");
  }

  // ---- replay JS-visible cookies captured by the server jar ----
  try{for(var ci=0;ci<CK.length;ci++){vcSet(CK[ci],false)}}catch(e){}

  // ---- initial nav + title ----
  try{send("nav",{title:document.title||""})}catch(e){}

  // ---- service workers: routed through the veil ----
  // Offline app shells, PWAs and embedded site browsers (engine-style
  // "browse" portals) refuse to boot without one — a blanket block broke
  // their whole init ("init error / disabled here"). Instead the script URL
  // and scope are mapped onto the veiled path space: the browser's own
  // max-scope rule then contains the worker to /api/p/<site>/… — it can
  // never claim the app's own routes. The proxy prepends swShim() to the
  // worker script itself, keeping its fetches/importScripts/WebSockets on
  // the veil too.
  try{
    if(navigator.serviceWorker&&navigator.serviceWorker.register){
      var oReg=navigator.serviceWorker.register.bind(navigator.serviceWorker);
      function swScope(s){
        try{
          var str=(s==null?"":String(s));
          if(!str)return null;
          if(str.indexOf(P)===0)return str;
          var abs=new URL(str,BASE);
          if(abs.protocol!=="http:"&&abs.protocol!=="https:")return null;
          return P+abs.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
        }catch(e){return null}
      }
      /* Per-page-load script-URL buster: a byte-identical re-register is a
       * NO-OP in the browser (update check: same bytes -> keep the running
       * worker), so a site that re-registers on every boot to get fresh
       * worker state never actually gets it — the stale instance (dead
       * MessagePorts, half-dead transports) keeps serving every reload.
       * A fresh URL per page load forces a NEW registration and a fresh
       * script evaluation; skipWaiting+claim in the veiled worker shim
       * then hand the current page to the new copy immediately. */
      var VEIL_SWBUST="__veilsw="+(Date.now().toString(36)+Math.random().toString(36).slice(2,8));
      function swBust(u){
        var str=String(u);
        if(str.indexOf(P)!==0)return str;
        return str+(str.indexOf("?")>=0?"&":"?")+VEIL_SWBUST;
      }
      navigator.serviceWorker.register=function(script,opts){
        try{
          var s=String(script);
          var r=routeArg(s);
          if(typeof r==="string"&&r&&r!==s){
            var no={};
            if(opts&&typeof opts==="object")for(var k in opts)no[k]=opts[k];
            var sc=no.scope!=null?swScope(no.scope):null;
            if(sc)no.scope=sc;else delete no.scope;
            return oReg(swBust(r),no);
          }
          /* Already-veiled script URL (site built it from getBasePath()):
           * native register works as-is; only normalize a raw scope. */
          if(s.indexOf(P)===0){
            if(opts&&typeof opts==="object"&&opts.scope!=null){
              var sc2=swScope(opts.scope);
              if(sc2&&sc2!==String(opts.scope))return oReg(swBust(s),Object.assign({},opts,{scope:sc2}));
            }
            return oReg(swBust(s),opts);
          }
        }catch(e){}
        return oReg(script,opts);
      };
      if(navigator.serviceWorker.getRegistration){
        var oGetReg=navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
        navigator.serviceWorker.getRegistration=function(scope){
          try{
            if(typeof scope==="string"&&scope){
              var sc=swScope(scope);
              if(sc)return oGetReg(sc);
            }
          }catch(e){}
          return oGetReg(scope);
        };
      }
    }
  }catch(e){}

  // ---- WebRTC leak guard ----
  // RTCPeerConnection ICE/STUN traffic bypasses the proxy entirely and
  // hands the visitor's real IP to whatever STUN server a page names —
  // the single biggest anonymity leak a web proxy can carry. No proxied
  // site may open one.
  try{
    var VBlocked=function(){throw new Error("WebRTC is disabled in this context")};
    VBlocked.prototype=null;
    if(window.RTCPeerConnection)window.RTCPeerConnection=VBlocked;
    if(window.webkitRTCPeerConnection)window.webkitRTCPeerConnection=VBlocked;
    if(window.RTCSessionDescription)window.RTCSessionDescription=function(d){return d||{}};
  }catch(e){}

  // ---- URL helpers ----
  function rawLoc(){
    try{
      var lp=location.pathname;
      if(lp.indexOf(P)===0){
        return lp.slice(P.length).replace(/^(https?)\\//i,"$1://")+location.search+location.hash;
      }
    }catch(e){}
    return null;
  }
  function absOf(u){try{return new URL(u,CUR||BASE).href}catch(e){return null}}
  function decodeRoutedPath(pp){
    // "https/host/…" → "https://host/…" (null when the path is not a routed
    // target). Regex-free so the template escaping stays trivial.
    var i=pp.indexOf("/");
    if(i<0)return null;
    var sch=pp.slice(0,i);
    if((sch!=="http"&&sch!=="https")||pp.charAt(sch.length)!=="/")return null;
    return sch+"://"+pp.slice(sch.length+1);
  }
  function targetOf(u){
    try{
      var a=new URL(u,CUR||BASE);
      if(a.origin===location.origin){
        // Pages build URLs from location.href — which already carries the
        // route prefix (gn-math.dev pushes "?id=…" exactly that way). Decode
        // an already-routed path instead of rebasing the WHOLE prefix onto
        // BASE, which double-stacked it ("…/api/p/https/host/api/p/…").
        if(a.pathname.indexOf(P)===0){
          var inner=decodeRoutedPath(a.pathname.slice(P.length));
          if(inner){
            var b=new URL(inner+a.search+a.hash);
            if(b.protocol==="http:"||b.protocol==="https:")return b.href;
            return null;
          }
        }
        a=new URL(a.pathname+a.search+a.hash,BASE);
      }
      if(a.protocol!=="http:"&&a.protocol!=="https:")return null;
      return a.href;
    }catch(e){return null}
  }
  function toRoute(u){
    try{
      if(typeof u!=="string"||!u)return null;
      if(u.indexOf(P)===0)return null;
      if(/^(data|blob):/i.test(u))return null;
      var a=new URL(u,BASE);
      if(a.protocol!=="http:"&&a.protocol!=="https:")return null;
      if(a.origin===location.origin){
        // The page's JS built this URL from *our* origin (location.*) —
        // rebase the path onto the veiled page's real origin.
        a=new URL(a.pathname+a.search+a.hash,BASE);
      }
      return P+a.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
    }catch(e){return null}
  }
  function routeArg(u){
    try{
      if(typeof u!=="string"||!u)return u;
      if(u.indexOf(P)===0)return u;
      // Absolute same-origin URL already carrying the route prefix — strip
      // the origin so it stays routed instead of being re-routed double.
      if(u.indexOf(location.origin+P)===0)return u.slice(location.origin.length);
      var r=toRoute(u);if(r)return r;
    }catch(e){}
    return u;
  }

  // ---- SPA history sync (parent URL bar + back/forward stack) ----
  // Wrap at BOTH the own-property and History.prototype level: some app
  // shells (YouTube/SPF) invoke the prototype method directly, which would
  // bypass an own-property wrapper and commit raw same-origin URLs.
  function wrapPush(orig){
    return function(s,t,u){
      try{
        if(u!==null&&u!==undefined&&u!==""){
          var us=String(u);
          if(us.indexOf(P)===0){var rl=rawLoc();if(rl)CUR=rl;arguments[2]=us}
          else{arguments[2]=routeArg(us);CUR=targetOf(us)||CUR}
        }
      }catch(e){}
      var res=orig.apply(this,arguments);
      try{send("nav",{title:document.title||""})}catch(e){}
      return res;
    };
  }
  function wrapReplace(orig){
    return function(s,t,u){
      try{
        if(u!==null&&u!==undefined&&u!==""){
          arguments[2]=routeArg(String(u));
        }
      }catch(e){}
      return orig.apply(this,arguments);
    };
  }
  try{
    var HP=History.prototype;
    var npush=HP.pushState, nrep=HP.replaceState;
    var wp=wrapPush(npush), wr=wrapReplace(nrep);
    HP.pushState=wp;HP.replaceState=wr;
    try{history.pushState=wp;history.replaceState=wr}catch(e){}
  }catch(e){}
  try{
    var push=history.pushState;
    if(push!==undefined&&!history.hasOwnProperty("pushState")){history.pushState=wrapPush(push)}
  }catch(e){}
  try{window.addEventListener("popstate",function(){try{var rl=rawLoc();if(rl)CUR=rl;send("nav",{title:document.title||""})}catch(e){}})}catch(e){}

  // ---- Navigation API: the un-bypassable guard ----
  // Some app shells (YouTube) commit raw same-origin URLs through a native
  // history reference captured cross-realm, so wrapper patching is not
  // enough. The Navigation API fires for every URL commit no matter how it
  // was made — intercept same-origin commits that are not veiled and commit
  // the routed URL instead.
  try{
    if(window.navigation&&window.navigation.addEventListener){
      window.navigation.addEventListener("navigate",function(e){
        try{
          if(!e.canIntercept)return;
          if(e.hashChange)return;
          var dest=e.destination.url;
          var a=new URL(dest);
          if(a.origin!==location.origin)return;
          if(a.pathname.indexOf(P)===0)return;
          var t=new URL(a.pathname+a.search+a.hash,BASE);
          if(t.protocol!=="http:"&&t.protocol!=="https:")return;
          var routed=P+t.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
          if(routed===dest)return;
          var isPush=e.navigationType==="push";
          e.intercept({handler:function(){
            try{
              if(isPush)history.pushState({},"",routed);
              else history.replaceState({},"",routed);
            }catch(e2){}
          }});
        }catch(err){}
      });
    }
  }catch(e){}

  // ---- routed location.assign / location.replace ----
  // (location.href itself is unforgeable; the server-side referer fallback
  // covers raw href navigations.)
  try{
    var oa=Location.prototype.assign;
    Location.prototype.assign=function(u){
      try{var r=routeArg(String(u));if(typeof r==="string"&&r!==String(u))return oa.call(this,r)}catch(e){}
      return oa.call(this,u);
    };
  }catch(e){}
  try{
    var orp=Location.prototype.replace;
    Location.prototype.replace=function(u){
      try{var r=routeArg(String(u));if(typeof r==="string"&&r!==String(u))return orp.call(this,r)}catch(e){}
      return orp.call(this,u);
    };
  }catch(e){}

  // ---- anchor-click rescue (SPA-rendered absolute hrefs) ----
  // Server HTML hrefs are rewritten upstream, but SPAs render NEW anchors
  // at runtime from API data with ABSOLUTE hrefs (https://site/game/x).
  // A plain click on those navigates the frame straight out of the veil
  // onto the frame-blocked site — a blank frame. Rewriting the href in the
  // CAPTURE phase (before routers run) keeps the default navigation on our
  // origin; routers that intercept instead push the rewritten href through
  // the wrapped pushState. Only absolute http(s) hrefs are touched:
  // relative ones already resolve via the <base> tag / router wrappers.
  try{
    document.addEventListener("click",function(e){
      try{
        if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
        var t=e.target;
        var a=t&&t.closest?t.closest("a[href]"):null;
        if(!a)return;
        var tgt=a.getAttribute("target");
        if(tgt&&tgt!=="_self")return;
        if(a.hasAttribute("download"))return;
        var h=a.getAttribute("href");
        if(!h||h.charAt(0)==="#"||h.indexOf(P)===0||!/^https?:\\/\\//i.test(h))return;
        if(h.indexOf(location.origin+"/")===0||h===location.origin)return;
        var routed=toRoute(h);
        if(routed&&routed!==h)a.setAttribute("href",routed);
      }catch(err){}
    },true);
  }catch(e){}

  // ---- runtime request routing: fetch / XHR / sendBeacon ----
  var HINT="x-veil-page";
  try{
    var of=window.fetch;
    if(of){
      window.fetch=function(input,init){
        try{
          var url=null;
          if(typeof input==="string")url=input;
          else if(typeof URL!=="undefined"&&input instanceof URL)url=input.href;
          else if(input&&typeof input.url==="string")url=input.url;
          var r=url?toRoute(url):null;
          if(r){
            if(typeof input==="string"||(typeof URL!=="undefined"&&input instanceof URL)){
              input=r;
              if(!init)init={headers:{}};
            }else{
              // Passing a non-empty init alongside a Request that has a body
              // makes the whole fetch reject ("Failed to fetch") — rebuild
              // the Request and fetch it bare, adding the hint via headers.
              input=new Request(r,input);
              init=undefined;
              try{input.headers.set(HINT,BASE)}catch(e2){}
            }
          }
          if(init&&typeof init==="object"){
            try{
              if(!init.headers)init.headers={};
              if(typeof init.headers.set==="function")init.headers.set(HINT,BASE);
              else init.headers[HINT]=BASE;
            }catch(e2){}
          }
        }catch(e){}
        return of.call(window,input,init);
      };
    }
  }catch(e){}
  try{
    var oo=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){
      var rest=Array.prototype.slice.call(arguments,2);
      try{var r=routeArg(u);if(r!==u)u=r}catch(e){}
      var res=oo.apply(this,[m,u].concat(rest));
      try{this.setRequestHeader(HINT,BASE)}catch(e){}
      return res;
    };
  }catch(e){}
  try{
    if(navigator.sendBeacon){
      var osb=navigator.sendBeacon;
      navigator.sendBeacon=function(u,d){
        try{var r=routeArg(u);if(typeof r==="string"&&r!==u)u=r}catch(e){}
        return osb.call(navigator,u,d);
      };
    }
  }catch(e){}

  // ---- runtime element URL routing (img/script/iframe/media src, link href) ----
  // Markup URLs are rewritten server-side, but pages ASSIGN urls at runtime:
  // gn-math.dev sets img.src to ROOT-RELATIVE cover paths after the fact, and
  // root-relative strings ignore the <base> tag per the URL spec — they landed
  // on our origin unrouted and every cover 404'd (the gn-math title grid looked
  // broken). Route property assignments the way the anchor-click rescue routes
  // navigation: resolve against the element's own document base (which carries
  // the <base> tag sites inject for their own subresources), rebase same-origin
  // results onto the veiled page's real origin, then send everything through
  // the proxy prefix. Already-routed values and non-http(s) schemes pass
  // through untouched.
  try{
    function veilDocBase(el){
      try{
        var d=(el&&el.ownerDocument)?el.ownerDocument:document;
        return d.baseURI||d.URL||d.documentURI||BASE;
      }catch(e){return BASE}
    }
    function veilRouteProp(el,v){
      try{
        if(typeof v!=="string"||!v)return v;
        if(v.indexOf(P)===0)return v;
        if(/^(data|blob|about|javascript|mailto|tel):/i.test(v))return v;
        var abs=new URL(v,veilDocBase(el));
        if(abs.protocol!=="http:"&&abs.protocol!=="https:")return v;
        if(abs.origin===location.origin){
          abs=new URL(abs.pathname+abs.search+abs.hash,BASE);
        }
        var h=abs.href,i=h.indexOf("://");
        return P+(i>=0?h.slice(0,i)+"/"+h.slice(i+3):h);
      }catch(e){return v}
    }
    function veilPatchSrcProp(ctor){
      try{
        if(!ctor||!ctor.prototype)return;
        var d=ctor.prototype;
        var pd=Object.getOwnPropertyDescriptor(d,"src");
        if(!pd||!pd.set||!pd.configurable)return;
        var set=pd.set,get=pd.get;
        Object.defineProperty(d,"src",{
          configurable:true,enumerable:pd.enumerable,
          get:function(){try{return get?get.call(this):""}catch(e){return ""}},
          set:function(v){try{var r=veilRouteProp(this,v);if(typeof r==="string")v=r}catch(e){}set.call(this,v)}
        });
      }catch(e){}
    }
    function veilPatchHrefProp(ctor){
      try{
        if(!ctor||!ctor.prototype)return;
        var d=ctor.prototype;
        var pd=Object.getOwnPropertyDescriptor(d,"href");
        if(!pd||!pd.set||!pd.configurable)return;
        var set=pd.set,get=pd.get;
        Object.defineProperty(d,"href",{
          configurable:true,enumerable:pd.enumerable,
          get:function(){try{return get?get.call(this):""}catch(e){return ""}},
          set:function(v){try{var r=veilRouteProp(this,v);if(typeof r==="string")v=r}catch(e){}set.call(this,v)}
        });
      }catch(e){}
    }
    if(window.HTMLImageElement)veilPatchSrcProp(window.HTMLImageElement);
    if(window.HTMLScriptElement)veilPatchSrcProp(window.HTMLScriptElement);
    if(window.HTMLIFrameElement)veilPatchSrcProp(window.HTMLIFrameElement);
    if(window.HTMLSourceElement)veilPatchSrcProp(window.HTMLSourceElement);
    if(window.HTMLTrackElement)veilPatchSrcProp(window.HTMLTrackElement);
    if(window.HTMLEmbedElement)veilPatchSrcProp(window.HTMLEmbedElement);
    if(window.HTMLAudioElement)veilPatchSrcProp(window.HTMLAudioElement);
    if(window.HTMLVideoElement)veilPatchSrcProp(window.HTMLVideoElement);
    if(window.HTMLLinkElement)veilPatchHrefProp(window.HTMLLinkElement);
    // Anchors + image maps: a page assigning a.href at runtime then the user
    // clicking it is a TOP-LEVEL navigation straight to the third party —
    // the injected CSP does not govern top-level navigations, so this was
    // the one remaining hole a proxied page could push a visitor's browser
    // through (real IP to the target host + a visible SNI/DNS event for the
    // local network). Route the assignment instead.
    if(window.HTMLAnchorElement)veilPatchHrefProp(window.HTMLAnchorElement);
    if(window.HTMLAreaElement)veilPatchHrefProp(window.HTMLAreaElement);
    // Forms: CSP form-action 'self' already refuses direct cross-origin
    // submits (that refusal also breaks the site) — routing the runtime
    // .action assignment keeps forms working AND on-veil.
    if(window.HTMLFormElement){
      try{
        var fd=HTMLFormElement.prototype;
        var fpd=Object.getOwnPropertyDescriptor(fd,"action");
        if(fpd&&fpd.set&&fpd.configurable){
          var fset=fpd.set,fget=fpd.get;
          Object.defineProperty(fd,"action",{
            configurable:true,enumerable:fpd.enumerable,
            get:function(){try{return fget?fget.call(this):""}catch(e){return ""}},
            set:function(v){try{var r=veilRouteProp(this,v);if(typeof r==="string")v=r}catch(e){}fset.call(this,v)}
          });
        }
      }catch(e){}
    }
    // srcset / imagesrcset runtime assignments (responsive-image swaps):
    // each candidate is "url [descriptor]" — route every candidate URL,
    // leave descriptors and empty strings alone.
    function veilRouteSrcset(v){
      try{
        if(typeof v!=="string"||!v)return v;
        return v.split(",").map(function(part){
          var s=part.trim();
          if(!s)return s;
          var sp=s.indexOf(" ");
          var url=sp<0?s:s.slice(0,sp), rest=sp<0?"":s.slice(sp);
          var r=veilRouteProp(null,url);
          return (typeof r==="string"?r:url)+rest;
        }).join(", ");
      }catch(e){return v}
    }
    function veilPatchSrcsetProp(ctor){
      try{
        if(!ctor||!ctor.prototype)return;
        var d=ctor.prototype;
        var pd=Object.getOwnPropertyDescriptor(d,"srcset");
        if(!pd||!pd.set||!pd.configurable)return;
        var set=pd.set,get=pd.get;
        Object.defineProperty(d,"srcset",{
          configurable:true,enumerable:pd.enumerable,
          get:function(){try{return get?get.call(this):""}catch(e){return ""}},
          set:function(v){try{var r=veilRouteSrcset(v);if(typeof r==="string")v=r}catch(e){}set.call(this,v)}
        });
      }catch(e){}
    }
    if(window.HTMLImageElement)veilPatchSrcsetProp(window.HTMLImageElement);
    if(window.HTMLSourceElement)veilPatchSrcsetProp(window.HTMLSourceElement);
  }catch(e){}

  // ---- EventSource via the veil (SSE to third parties is a direct connect) ----
  try{
    if(window.EventSource){
      var OE=window.EventSource;
      window.EventSource=function(u,cfg){
        try{var r=routeArg(String(u));if(typeof r==="string")u=r}catch(e){}
        return cfg===undefined?new OE(u):new OE(u,cfg);
      };
      window.EventSource.prototype=OE.prototype;
      window.EventSource.CONNECTING=0;window.EventSource.OPEN=1;window.EventSource.CLOSED=2;
    }
  }catch(e){}

  // ---- Worker / SharedWorker via the veil ----
  // A worker constructor with an absolute third-party URL makes the browser
  // fetch that script DIRECTLY (worker-src 'self' would refuse it — routing
  // it keeps heavy sites working through the veil instead of breaking).
  try{
    if(window.Worker){
      var OWk=window.Worker;
      window.Worker=function(u,opts){
        try{var r=routeArg(String(u));if(typeof r==="string")u=r}catch(e){}
        return opts===undefined?new OWk(u):new OWk(u,opts);
      };
      window.Worker.prototype=OWk.prototype;
    }
    if(window.SharedWorker){
      var OSWk=window.SharedWorker;
      /* Chrome freezes a SharedWorker once its last document goes away
       * (closing its sockets) but RESUMES the very same instance — script
       * state and all — when the next page connects. A worker holding a
       * dead socket (wisp transports, live connections) comes back
       * half-alive and the site breaks ("websocket did not open"). A
       * per-page-load cache-buster guarantees a fresh worker (fresh
       * sockets) per document, while the value being stable within one
       * load keeps multi-connection pages sharing a single worker. */
      var VEIL_WBUST="__veilw="+(Date.now().toString(36)+Math.random().toString(36).slice(2,8));
      window.SharedWorker=function(u,opts){
        try{
          var r=routeArg(String(u));
          if(typeof r==="string"&&r)u=r;
          if(!/^(data|blob):/i.test(String(u))){
            u=String(u)+(String(u).indexOf("?")>=0?"&":"?")+VEIL_WBUST;
          }
        }catch(e){}
        return opts===undefined?new OSWk(u):new OSWk(u,opts);
      };
      window.SharedWorker.prototype=OSWk.prototype;
    }
  }catch(e){}

  // Residual, documented: location.href = "https://external" cannot be
  // patched (window.location is [LegacyUnforgeable]) and the Navigation API
  // reports canIntercept=false for cross-origin destinations, so a page that
  // programmatically redirects its TOP-LEVEL frame straight at a third party
  // is the one JS-driven path that still leaves the veil. Everything else
  // (anchors, image maps, forms, src, href, srcset, fetch, XHR, beacon,
  // EventSource, WebSocket, Worker) is routed above.

  // ---- WebSocket via the veil relay (multiplayer through the veil) ----
  // Veiled pages are served from our single exposed origin, so a page's
  // ws:// / wss:// connections must ride the WebSocket relay to reach the
  // real server. Two effects: (1) restricted networks where only our origin
  // is reachable still get multiplayer; (2) the game server sees the SAME
  // egress IP that made the veiled HTTP calls (matchmaking, session APIs) —
  // mismatched IPs are what Bloxd/Colyseus rooms reject as "no internet
  // connection". The wrapper must be installed before page scripts run
  // (this script is injected as the first <head> child) because libraries
  // capture globalThis.WebSocket at module-load time (colyseus does).
  // Subprotocol hygiene: colyseus first tries new WebSocket(url, {headers,
  // protocols}) (the Node "ws" signature) which the browser REJECTS — it
  // catches and retries with protocols only. We sanitize non-string/array
  // protocol values so the first attempt already succeeds through the relay.
  try{
    var OW=window.WebSocket;
    if(OW){
      function veilProtos(p){
        if(typeof p==="string")return p;
        if(Array.isArray(p)){
          var out=[];for(var i=0;i<p.length;i++)if(typeof p[i]==="string")out.push(p[i]);
          return out.length?out:undefined;
        }
        return undefined;
      }
      function veilRelayBase(){
        var h=location.host||"";
        /* Direct-to-app access (no gateway in front — e.g. localhost:3000):
         * the XTransformPort convention only exists on the gateway, so dial
         * the relay service itself on this box. */
        if(/^(localhost|127\.0\.0\.1):3000$/.test(h))return "ws://localhost:3003";
        return (location.protocol==="https:"?"wss://":"ws://")+h;
      }
      function VeilWs(url,protocols){
        var target=null;
        try{
          var abs=new URL(String(url),location.href);
          if(abs.protocol==="ws:"||abs.protocol==="wss:"){
            target=abs.href;
            /* WS URLs the page's JS built from OUR origin (location.host —
             * xylora's wisp endpoint, socket.io upgrades, echo servers):
             * pointing the relay at our own origin would be refused by its
             * SSRF guard. Re-anchor raw same-host paths onto the veiled
             * page's real origin, and decode already-veiled same-origin
             * paths back to the site's ws(s) URL. */
            if(abs.host===location.host){
              if(abs.pathname.indexOf(P)===0){
                var inner=abs.pathname.slice(P.length).replace(/^(https?)\\//i,"$1://");
                if(inner)target=inner.replace(/^http/i,"ws")+abs.search;
              }else{
                var vb=new URL(BASE);
                target=(vb.protocol==="https:"?"wss://":"ws://")+vb.host+abs.pathname+abs.search;
              }
            }
          }
        }catch(e){}
        var pp=veilProtos(protocols);
        if(!target)return pp===undefined?new OW(url):new OW(url,pp);
        var relay=veilRelayBase()+"/?XTransformPort=3003&target="+encodeURIComponent(target);
        return pp===undefined?new OW(relay):new OW(relay,pp);
      }
      VeilWs.prototype=OW.prototype;
      VeilWs.CONNECTING=0;VeilWs.OPEN=1;VeilWs.CLOSING=2;VeilWs.CLOSED=3;
      window.WebSocket=VeilWs;
    }
  }catch(e){}

  // ---- popup-ad blocking + routed window.open ----
  try{
    var ow=window.open;
    window.open=function(u){
      try{
        if(typeof u==="string"&&u){
          var a=new URL(u,BASE);
          if(a.protocol==="http:"||a.protocol==="https:"){
            if(isAdHost(a.hostname))return null;
            var r=toRoute(u);if(r)arguments[0]=r;
          }
        }
      }catch(e){}
      return ow.apply(window,arguments);
    };
  }catch(e){}

  // ---- mute beforeunload traps (popup-ad sites use them) ----
  try{
    window.addEventListener("beforeunload",function(e){try{e.stopImmediatePropagation()}catch(e2){}},true);
    try{Object.defineProperty(window,"onbeforeunload",{get:function(){return null},set:function(){},configurable:true})}catch(e2){}
  }catch(e){}

  // ---- document.cookie → the virtual jar (never the real origin jar) ----
  // The getter feeds the page its per-site jar and the setter stores +
  // relays into the server jar: the app origin's real cookies are never
  // read or written by a proxied page again (the 431 fix). Matches the
  // runtime layer's own virtual jar — whichever installs last wins, and
  // both are virtual.
  try{
    Object.defineProperty(document,"cookie",{
      get:function(){return vcGet()},
      set:function(v){vcSet(v,true)},
      configurable:true
    });
  }catch(e){}

  // ---- DOM ad scrub: remove ad scripts, hide ad frames/images ----
  function attrFor(el){
    try{
      var t=el.tagName;
      if(t==="OBJECT")return el.getAttribute("data");
      if(t==="LINK")return el.getAttribute("href");
      return el.getAttribute("src");
    }catch(e){}
    return null;
  }
  function hostOf(s){
    try{
      if(!s)return null;
      if(s.indexOf(P)===0){
        var m=s.slice(P.length).match(/^https?\\/([^\\/?#]+)/i);
        if(m)return decodeURIComponent(m[1]).toLowerCase();
        return null;
      }
      var a=new URL(s,BASE);
      if(a.protocol==="http:"||a.protocol==="https:")return a.hostname.toLowerCase();
    }catch(e){}
    return null;
  }
  function scrubEl(el){
    try{
      var s=attrFor(el);
      if(!s)return;
      var h=hostOf(s);
      if(h&&isAdHost(h)){
        if(el.tagName==="SCRIPT"){if(el.parentNode)el.parentNode.removeChild(el)}
        else{try{el.style.setProperty("display","none","important")}catch(e2){}}
      }
    }catch(e){}
  }
  function scrubAll(root){
    try{
      var els=root.querySelectorAll("script[src],iframe[src],img[src],embed[src],object[data],source[src],link[href]");
      for(var i=0;i<els.length;i++)scrubEl(els[i]);
    }catch(e){}
  }
  var scrubT=0;
  function scheduleScrub(){if(!scrubT)scrubT=setTimeout(function(){scrubT=0;try{scrubAll(document)}catch(e){}},250)}
  try{
    if(window.MutationObserver){
      var mo=new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          var add=muts[i].addedNodes;
          for(var j=0;j<add.length;j++){
            var n=add[j];
            if(!n||n.nodeType!==1)continue;
            scrubEl(n);
            if(n.querySelectorAll)scheduleScrub();
          }
        }
      });
      mo.observe(document.documentElement||document,{childList:true,subtree:true});
    }
  }catch(e){}
  try{document.addEventListener("DOMContentLoaded",function(){scrubAll(document)})}catch(e){}
  try{window.addEventListener("load",function(){scrubAll(document)})}catch(e){}

  // ---- title watcher + mouse reporting for the parent control bar ----
  try{var last=document.title;var mu=function(){try{if(document.title!==last){last=document.title;send("title",{title:last})}}catch(e){}setTimeout(mu,700)};setTimeout(mu,700)}catch(e){}
  var lastM=0;
  document.addEventListener("mousemove",function(e){
    var now=Date.now();
    if(e.clientY<=120&&now-lastM>90){lastM=now;send("mouse",{y:e.clientY})}
  },true);
  document.addEventListener("mouseleave",function(){send("mouse",{y:999})},true);
  /* Escape pressed inside the veiled page returns to Veil's start page
     (capture phase so pages that swallow keydown can't strand the user) —
     BUT never while the page itself is fullscreen (a video or game: that
     Escape exits the fullscreen, it must not dump the whole session) and
     never while the page has an open <dialog> (that Escape closes the
     dialog). This was the "randomly back on the start page" bug. */
  /* PANIC relay: the parent can't see keydowns that land in this frame —
     it hands us the panic combo (veil:panic-cfg) and we match it here,
     then relay the hit home; the parent navigates the whole tab away. */
  var PC={on:false,key:"ctrl+y"};
  try{
    window.addEventListener("message",function(e){
      try{
        var d=e.data;
        if(d&&d.__veil===1&&d.type==="veil:panic-cfg"){PC.on=!!d.on;PC.key=String(d.key||"ctrl+y").toLowerCase()}
      }catch(x){}
    },false);
    send("panic-ready",{});
  }catch(e){}
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){
      try{
        if(document.fullscreenElement)return;
        if(document.querySelector("dialog[open]"))return;
        send("esc",{})
      }catch(x){}
    }
    try{
      if(!PC.on)return;
      var k=(e.key||"").toLowerCase();
      if(!k||k==="control"||k==="shift"||k==="alt"||k==="meta")return;
      var m=[];
      if(e.ctrlKey)m.push("ctrl");
      if(e.metaKey)m.push("meta");
      if(e.altKey)m.push("alt");
      if(e.shiftKey)m.push("shift");
      m.push(k);
      if(m.join("+")===PC.key){e.preventDefault();e.stopPropagation();try{send("panic",{})}catch(x){}}
    }catch(x){}
  },true);
})()</script>`;
}

/**
 * Routing shim prepended to service worker scripts served through the veil
 * (the proxy detects them via the `Service-Worker: script` request header).
 * The worker context has no DOM runtime, so it gets its own tiny router:
 * fetch / importScripts / WebSocket dials that would escape to bare paths
 * or the shell origin are re-anchored onto the veiled path space (or the
 * ws-relay), keeping the worker's traffic inside the veil. Without this, a
 * registered worker's own fetches land on this origin unrouted and 404 —
 * SW-dependent sites boot into a broken shell.
 */
export function swShim(scriptUrl: string): string {
  const urlJson = JSON.stringify(scriptUrl).replace(/</g, "\\u003c");
  const prefixJson = JSON.stringify(ROUTE_PREFIX).replace(/</g, "\\u003c");
  /* NOTE: plain JS — this is prepended to a worker SCRIPT, never inlined
   * into HTML, so it must carry no markup of its own. */
  return `/*! veil-sw-shim */(function(){
if(self.__veilSW)return;self.__veilSW=1;
/* Fresh worker per page load: sites that re-register their worker on every
 * boot portals intend exactly this — but without
 * skipWaiting/claim the OLD worker keeps serving the page with stale module
 * state (dead MessagePorts to the previous page's transports), and every
 * request dies with "websocket did not open". Claiming immediately hands
 * the page to the freshly-registered copy with clean state. */
try{
  if(self.registration){
    self.addEventListener("install",function(){try{self.skipWaiting()}catch(e){}});
    self.addEventListener("activate",function(e){try{if(e&&e.waitUntil)e.waitUntil(self.clients.claim())}catch(x){}});
  }
}catch(e){}
var P=${prefixJson},BASE=${urlJson};
var SELF_O=null,SELF_HOST=null;
try{SELF_O=self.location.origin;SELF_HOST=self.location.host}catch(e){}
function toRoute(u){
  try{
    if(typeof u!=="string"||!u)return u;
    if(u.indexOf(P)===0)return u;
    if(/^(data|blob):/i.test(u))return u;
    var a=new URL(u,BASE);
    if(a.protocol!=="http:"&&a.protocol!=="https:")return u;
    if(a.origin===SELF_O){
      /* already-routed same-origin URL (built from location) — pass it
       * through untouched; raw same-origin paths re-anchor onto the site */
      if(a.pathname.indexOf(P)===0)return a.href;
      a=new URL(a.pathname+a.search+a.hash,BASE);
    }
    return P+a.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
  }catch(e){return u}
}
var oF=self.fetch;
if(oF){
  self.fetch=function(input,init){
    try{
      if(typeof input==="string"){
        var r=toRoute(input);
        if(r!==input)input=r;
      }else if(input&&typeof input.url==="string"){
        var r2=toRoute(input.url);
        if(r2!==input.url)input=new Request(r2,input);
      }
    }catch(e){}
    return oF.call(self,input,init);
  };
}
var oIS=self.importScripts;
if(oIS){
  self.importScripts=function(){
    try{
      for(var i=0;i<arguments.length;i++)if(typeof arguments[i]==="string")arguments[i]=toRoute(arguments[i]);
    }catch(e){}
    return oIS.apply(self,arguments);
  };
}
try{
  var OW=self.WebSocket;
  if(OW){
    function veilRelayBase(){
      var h=self.location.host||"";
      /* Direct-to-app access (no gateway in front — e.g. localhost:3000):
       * the XTransformPort convention only exists on the gateway, so dial
       * the relay service itself on this box. */
      if(/^(localhost|127\.0\.0\.1):3000$/.test(h))return "ws://localhost:3003";
      return (self.location.protocol==="https:"?"wss://":"ws://")+h;
    }
    function VSWs(url,protocols){
      var target=null;
      try{
        var abs=new URL(String(url),self.location.href);
        if(abs.protocol==="ws:"||abs.protocol==="wss:"){
          target=abs.href;
          if(SELF_HOST&&abs.host===SELF_HOST){
            if(abs.pathname.indexOf(P)===0){
              var inner=abs.pathname.slice(P.length).replace(/^(https?)\\//i,"$1://");
              if(inner)target=inner.replace(/^http/i,"ws")+abs.search;
            }else{
              var b=new URL(BASE);
              target=(b.protocol==="https:"?"wss://":"ws://")+b.host+abs.pathname+abs.search;
            }
          }
        }
      }catch(e){}
      if(!target)return protocols===undefined?new OW(url):new OW(url,protocols);
      /* absolute ws(s):// relay URL — relative URLs and the http->ws scheme
       * mapping are not reliable in every worker context, and a constructor
       * throw here reads as "websocket did not open" one layer up */
      var relay=veilRelayBase()+"/?XTransformPort=3003&target="+encodeURIComponent(target);
      return protocols===undefined?new OW(relay):new OW(relay,protocols);
    }
    VSWs.prototype=OW.prototype;
    VSWs.CONNECTING=0;VSWs.OPEN=1;VSWs.CLOSING=2;VSWs.CLOSED=3;
    self.WebSocket=VSWs;
  }
}catch(e){}
})();`;
}

/** Attributes whose values are URLs that need routing. */
const URL_ATTRS = [
  "href",
  "src",
  "action",
  "poster",
  "background",
  "formaction",
  "data-src",
  "data-original",
  "data-lazy",
  "data-lazy-src",
  "data-bg",
  "data-url",
  "data-href",
  "data-poster",
];

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Rewrite a full HTML document so every subresource stays on this origin. */
export function rewriteHtml(html: string, pageUrl: string, opts?: { cookies?: string[] }): string {
  // 0. Protect script/style *contents* FIRST — before anything scans the raw
  //    document for <base> tags or URL-bearing attributes. Sites build tags
  //    inside their own JS: gn-math.dev's inline script carries
  //    '<base href="' + zoneBaseFor(url, html) + '">' as a string, and the
  //    raw-text scans below used to match it — deriving a garbage base URL
  //    from the JS expression AND stripping the <base …> out of the site's
  //    own code (its zone viewer lost every base tag, its regex literals
  //    were shredded, and every href="#" routed to a literal "not found").
  //    Blocks are restored in step 9 (styles get their CSS rewritten there,
  //    once `base` is known).
  const blocks: { tag: string; attrs: string; content: string }[] = [];
  html = html.replace(
    /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    (_m: string, tag: string, attrs: string, content: string) => {
      const i = blocks.push({ tag, attrs, content }) - 1;
      return `<${tag}${attrs} data-veil-blk="${i}"></${tag}>`;
    }
  );

  // 1. Honor the document's own <base href> (BEFORE dropping it): relative
  //    URLs must resolve against the declared base, not the page URL's own
  //    directory. gn-math.dev game files live in one /s/…/ dir while their
  //    scripts/assets ship from a different declared base — ignoring it
  //    made every subresource 404 and games never boot. Safe now: the JS
  //    string fakes are stashed, so only real markup <base> tags match.
  let base = pageUrl;
  const declared = /<base\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(html);
  if (declared) {
    const raw = (declared[1] ?? declared[2] ?? declared[3] ?? "").trim();
    if (raw) {
      try {
        const resolved = new URL(raw, pageUrl);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") base = resolved.href;
      } catch {
        /* keep pageUrl */
      }
    }
  }

  // 2. Drop existing <base> tags (we inject our own, pointing at the
  //    declared base) and CSP meta tags.
  html = html.replace(/<base\b[^>]*>/gi, "");
  html = html.replace(
    /<meta[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi,
    ""
  );
  // …and the site's own referrer metas: ours is injected in step 10, and a
  // later-in-document site meta would override it (last one wins), killing
  // the same-origin referers the fallback router depends on for escaped
  // runtime URLs (JS dynamic imports, worker fetches).
  html = html.replace(
    /<meta\b[^>]*\bname\s*=\s*["']?referrer["']?[^>]*>/gi,
    ""
  );

  // 3. Rewrite URL-bearing attributes.
  for (const attr of URL_ATTRS) {
    html = html.replace(
      new RegExp(`(\\s${attr}\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "gi"),
      (m: string, pre: string, _q: string, dq?: string, sq?: string, uq?: string) => {
        const original = (dq ?? sq ?? uq ?? "").trim();
        if (!original) return m;
        const decoded = original
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        const routed = resolveAndRoute(decoded, base);
        if (routed === original) return m;
        return `${pre}"${escapeAttr(routed)}"`;
      }
    );
  }

  // 4. Rewrite srcset / imagesrcset (multi-URL attributes).
  html = html.replace(
    /(\s(?:srcset|imagesrcset)\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (m: string, pre: string, _q: string, dq?: string, sq?: string) => {
      const value = (dq ?? sq ?? "").replace(/&amp;/g, "&");
      const parts = value
        .split(",")
        .map((part: string) => {
          const t = part.trim();
          if (!t) return null;
          const sp = t.search(/\s/);
          const u = sp === -1 ? t : t.slice(0, sp);
          const desc = sp === -1 ? "" : t.slice(sp);
          return resolveAndRoute(u, base) + desc;
        })
        .filter(Boolean)
        .join(", ");
      if (!parts) return m;
      return `${pre}"${escapeAttr(parts)}"`;
    }
  );

  // 5. Rewrite url() inside inline style attributes.
  html = html.replace(
    /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (m: string, pre: string, _q: string, dq?: string, sq?: string) => {
      const value = dq ?? sq ?? "";
      const out = rewriteCss(value, base);
      if (out === value) return m;
      return `${pre}"${escapeAttr(out)}"`;
    }
  );

  // 6. Rewrite <meta http-equiv="refresh" content="N;url=...">.
  html = html.replace(
    /<meta([^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*)>/gi,
    (m: string, attrs: string) => {
      const rewritten = attrs.replace(
        /(content\s*=\s*)("([^"]*)"|'([^']*)')/i,
        (mm: string, pre: string, _qq: string, cdq?: string, csq?: string) => {
          const value = cdq ?? csq ?? "";
          const r = value.match(/^\s*(\d+)\s*[;,]\s*url\s*=\s*(.+?)\s*$/i);
          if (!r) return mm;
          const target = r[2].replace(/^["']|["']$/g, "");
          return `${pre}"${r[1]};url=${escapeAttr(resolveAndRoute(target, base))}"`;
        }
      );
      return `<meta${rewritten}>`;
    }
  );

  // 7. Remove integrity/crossorigin/nonce (subresources are modified; SRI would fail).
  html = html.replace(
    /\s+(integrity|crossorigin|nonce)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    ""
  );

  // 8. Keep links inside the frame instead of popping new tabs we cannot track.
  html = html.replace(/(\starget\s*=\s*)(["'])(?:_blank|_new)(\2)/gi, "$1$2_self$3");

  // 9. Restore protected script/style contents (styles now get their CSS
  //    rewritten — the stash happens before `base` is derived).
  html = html.replace(
    /<(script|style)\b([^>]*?)\s*data-veil-blk="(\d+)"([^>]*)><\/\1\s*>/gi,
    (_m: string, tag: string, a1: string, i: string, a2: string) => {
      const b = blocks[Number(i)];
      const content =
        b && tag.toLowerCase() === "style" ? rewriteCss(b.content, base) : (b?.content ?? "");
      return `<${tag}${a1}${a2}>${content}</${tag}>`;
    }
  );

  // 10. Inject our <base> (helps JS-built relative URLs) + ad CSS + control script.
  let dir = base;
  try {
    dir = new URL("./", base).href;
  } catch {
    /* keep base */
  }
  const injection =
    `<base href="${escapeAttr(toRouteUrl(dir))}">` +
    /* same-origin referrer policy: same-origin requests (everything the
       veiled page loads from this origin) carry their full veiled URL —
       that is what the referer-based fallback router reads to re-route
       runtime-escaped paths (dynamic imports above all). Cross-origin
       requests send NOTHING, so the visitor's origin never leaks to any
       third party either way. */
    `<meta name="referrer" content="same-origin">` +
    /* THE LEAK SEAL: a page-level CSP that forbids ANY direct third-party
       subresource. The rewriter maps every URL onto this origin, so after
       rewriting everything is same-origin; if the rewriter ever misses one
       (a runtime-built URL, an exotic attribute), the resource is BLOCKED
       here instead of silently loading from the third-party host and
       handing them the visitor's real IP + headers. WebSockets to outside
       hosts (connect-src) are cut by the same rule — a page's live feature
       degrades instead of tunneling around the proxy. */
    `<meta http-equiv="Content-Security-Policy" content="${CSP_VALUE}">` +
    AD_HIDE_CSS +
    controlScript(base, opts?.cookies);
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + injection);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => m + injection);
  } else {
    html = injection + html;
  }
  return html;
}

/** Decode the handful of XML entities Bing's RSS feed uses. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return "";
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Extract a simple tag's text from an RSS <item> block. */
function rssTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

export type SerpItem = { title: string; link: string; description: string };

/** Parse Bing's RSS SERP into result items. */
export function parseBingRss(xml: string): SerpItem[] {
  const items: SerpItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const title = decodeXmlEntities(rssTag(m[1], "title")).replace(/<[^>]+>/g, "");
    const link = decodeXmlEntities(rssTag(m[1], "link"));
    const description = decodeXmlEntities(rssTag(m[1], "description")).replace(/<[^>]+>/g, "");
    if (title && /^https?:\/\//i.test(link)) {
      items.push({ title, link, description });
    }
  }
  return items;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse Brave Search's server-rendered HTML into result items.
 *
 * Brave inlines organic results in the initial HTML (their AI answer block
 * is noscript-hidden and carries no data-pos, so it is skipped naturally).
 * Blocks look like:
 *   <div class="snippet svelte-…" data-pos="N" data-type="web">…
 *     <a href="https://…">… <div class="title …">Title</div> …
 *     <div class="generic-snippet …"><div class="content …">desc</div>
 */
export function parseBraveSerp(html: string): SerpItem[] {
  const items: SerpItem[] = [];
  const seen = new Set<string>();
  const parts = html.split(/(?=<div class="snippet )/);
  for (const p of parts.slice(1)) {
    const head = p.match(
      /^<div class="snippet [^"]*" data-pos="\d+" data-type="(web|cluster)"/
    );
    if (!head) continue;
    const url = p.match(/<a href="(https?:\/\/[^"]+)"/);
    if (!url) continue;
    const link = url[1];
    // Skip Brave-internal links (favicons, images, pagination…).
    if (/(^|\.)brave\.(com|net)$/i.test(safeHostOf(link))) continue;
    if (seen.has(link)) continue;
    const titleM = p.match(/<div class="title[^"]*"[^>]*>([\s\S]{1,200}?)<\/div>/);
    const title = titleM ? stripTags(titleM[1]) : "";
    const descM = p.match(
      /<div class="generic-snippet[^"]*"[^>]*>[\s\S]{0,400}?<div class="content[^"]*"[^>]*>([\s\S]{0,600}?)<\/div>/
    );
    const description = descM ? stripTags(descM[1]).slice(0, 260) : "";
    if (title) {
      seen.add(link);
      items.push({ title, link, description });
    }
  }
  return items;
}

function safeHostOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

/**
 * Veil-rendered search results page (used for engines whose HTML SERP needs
 * JavaScript — Bing's shell renders empty through the veil, so we fetch their
 * RSS feed instead; Brave's HTML parses server-side). Result links are routed
 * through the proxy like every other veiled link.
 */
export function serpPage(
  engine: string,
  engineSearchUrl: string,
  pageUrl: string,
  query: string,
  items: SerpItem[],
  note?: string
): string {
  const safeQuery = query.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : c === "&" ? "&amp;" : c
  );
  const safeEngine = engine.replace(/[<>&"]/g, "");
  const safeNote = note ? note.replace(/[<>&"]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : c)) : "";
  const rows = items
    .map((it) => {
      const routed = resolveAndRoute(it.link, pageUrl);
      const safeTitle = it.title
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const safeDesc = it.description
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const host = safeHostOf(it.link) || it.link.slice(0, 60);
      let path = "";
      try {
        const u = new URL(it.link);
        path = (u.pathname + (u.search || "")).slice(0, 90);
      } catch {
        path = "";
      }
      const safeHost = host.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const safePath = path.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<li class="r">
  <a class="t" href="${escapeAttr(routed)}">${safeTitle}</a>
  <div class="u">${safeHost}<span class="p">${safePath}</span></div>
  ${safeDesc ? `<div class="d">${safeDesc}</div>` : ""}
</li>`;
    })
    .join("\n");
  const formAction = toRouteUrl(engineSearchUrl);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeEngine} · ${safeQuery} — Veil</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#09090b;color:#e4e4e7;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .bar{position:sticky;top:0;z-index:5;background:rgba(9,9,11,.92);backdrop-filter:blur(10px);border-bottom:1px solid #27272a;padding:18px 20px 16px}
  .wrap{max-width:680px;margin:0 auto}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  .brand .v{font-weight:700;color:#fafafa;letter-spacing:.02em}
  .brand .b{font-size:12px;color:#a1a1aa;border:1px solid #27272a;background:#18181b;padding:3px 9px;border-radius:99px}
  form{display:flex;gap:8px}
  input[type=text]{flex:1;min-width:0;height:46px;border-radius:12px;border:1px solid #27272a;background:#18181b;color:#fafafa;padding:0 16px;font-size:15px;outline:none}
  input[type=text]:focus{border-color:rgba(16,185,129,.55);box-shadow:0 0 0 3px rgba(16,185,129,.15)}
  button{height:46px;border-radius:12px;border:0;background:#10b981;color:#04211a;font-weight:600;font-size:14px;padding:0 20px;cursor:pointer}
  button:hover{background:#34d399}
  .meta{margin:10px 2px 0;font-size:12.5px;color:#71717a}
  ol{list-style:none;margin:0;padding:10px 20px 60px}
  .r{padding:16px 14px;border-radius:14px;transition:background .15s}
  .r:hover{background:#111113}
  .t{display:block;font-size:17px;font-weight:600;color:#34d399;text-decoration:none;line-height:1.35}
  .t:hover{text-decoration:underline}
  .t:visited{color:#34d399}
  .u{margin-top:3px;font-size:12.5px;color:#a1a1aa;font-family:ui-monospace,monospace;word-break:break-all}
  .u .p{color:#52525b}
  .d{margin-top:5px;font-size:13.5px;color:#a1a1aa;max-width:62ch}
  .empty{padding:80px 20px;text-align:center;color:#71717a}
  .foot{position:fixed;bottom:0;left:0;right:0;padding:10px;text-align:center;font-size:11.5px;color:#3f3f46;background:rgba(9,9,11,.9);border-top:1px solid #1c1c1f}
</style></head>
<body>
<div class="bar"><div class="wrap">
  <div class="brand"><span class="v">Veil</span><span class="b">${safeEngine} results</span>${safeNote ? `<span class="b">${safeNote}</span>` : ""}</div>
  <form action="${escapeAttr(formAction)}" method="GET">
    <input type="text" name="q" value="${safeQuery}" placeholder="Search the web…" aria-label="Search query" autofocus>
    <button type="submit">Search</button>
  </form>
  <div class="meta">${items.length} result${items.length === 1 ? "" : "s"} · rendered by Veil · no scripts, no trackers</div>
</div></div>
<ol>${rows}</ol>
${items.length === 0 ? '<div class="empty">No results came back — try different words.</div>' : ""}
<div class="foot">served through the veil</div>
${controlScript(pageUrl)}
</body></html>`;
}

export function errorPage(target: string, message: string, detail?: string): string {
  const safeMsg = message.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  );
  const safeTarget = target.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;"
  );
  const safeDetail = (detail ?? "").replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#e4e4e7;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .card{max-width:520px;width:calc(100% - 48px);background:#18181b;border:1px solid #27272a;border-radius:16px;padding:40px 36px;text-align:center}
  .icon{width:56px;height:56px;border-radius:16px;background:rgba(239,68,68,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
  h1{font-size:19px;margin:0 0 8px;font-weight:600;color:#fafafa}
  p{margin:0 0 6px;color:#a1a1aa}
  .url{font-family:ui-monospace,monospace;font-size:12.5px;color:#71717a;word-break:break-all;background:#09090b;border:1px solid #27272a;padding:8px 12px;border-radius:8px;margin-top:14px}
  .detail{font-size:12.5px;color:#52525b;margin-top:10px}
  button{margin-top:26px;background:#10b981;color:#04211a;border:0;padding:11px 26px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer}
  button:hover{background:#34d399}
</style></head>
<body><div class="card">
  <div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></div>
  <h1>Could not load this site</h1>
  <p>${safeMsg}</p>
  ${safeDetail ? `<div class="detail">${safeDetail}</div>` : ""}
  <div class="url">${safeTarget}</div>
  <button onclick="try{parent.postMessage({__veil:1,type:'home-request',d:{}},'*')}catch(e){}">Go back home</button>
</div>
<script data-veil-ctrl>try{parent.postMessage({__veil:1,type:"error",url:${JSON.stringify(target).replace(/</g, "\\u003c")},d:{message:${JSON.stringify(message).replace(/</g, "\\u003c")}}},"*")}catch(e){}</script>
</body></html>`;
}

/**
 * Veil's own page for bot-walled sites. Big-name sites (Reddit,
 * Cloudflare-fronted properties, ...) often refuse connections from
 * datacenter IPs outright -- the site's own block page renders as a
 * confusing white blob or scary "network security" text inside the veil.
 * This page says what actually happened and what the user can do, in the
 * same visual language as errorPage.
 */
export function wallPage(target: string, host: string): string {
  const safeHost = host.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;"
  );
  const safeTarget = target.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : c === "&" ? "&amp;" : ""
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#e4e4e7;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px 0}
  .card{max-width:560px;width:calc(100% - 48px);background:#18181b;border:1px solid #27272a;border-radius:16px;padding:40px 36px;text-align:center}
  .icon{width:56px;height:56px;border-radius:16px;background:rgba(250,204,21,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
  h1{font-size:19px;margin:0 0 8px;font-weight:600;color:#fafafa}
  p{margin:0 0 6px;color:#a1a1aa}
  .url{font-family:ui-monospace,monospace;font-size:12.5px;color:#71717a;word-break:break-all;background:#09090b;border:1px solid #27272a;padding:8px 12px;border-radius:8px;margin-top:14px}
  .why{margin-top:18px;border:1px dashed #3f3f46;border-radius:12px;padding:14px 16px;text-align:left;background:#09090b}
  .why b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin-bottom:6px}
  .why p{font-size:13px;color:#a1a1aa;margin:0 0 8px}
  .why p:last-child{margin:0}
  .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px}
  button{background:#10b981;color:#04211a;border:0;padding:11px 22px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer}
  button.alt{background:#27272a;color:#e4e4e7}
  button:hover{filter:brightness(1.12)}
</style></head>
<body><div class="card">
  <div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>
  <h1>${safeHost} refused this connection</h1>
  <p>The site blocks traffic from proxy networks -- Veil's server was recognized and turned away at the door.</p>
  <div class="why">
    <b>What this means</b>
    <p>This is the site's own anti-bot wall (the kind Cloudflare and Reddit use), not a Veil malfunction. It refuses every visitor from shared server IPs like this one, no matter how the page is loaded.</p>
    <p>Worth trying: the site's lightweight or mobile edition, or searching for the same content -- most sites have mirrors and feeds that read fine through the veil.</p>
  </div>
  <div class="url">${safeTarget}</div>
  <div class="row">
    <button onclick="try{parent.postMessage({__veil:1,type:'home-request',d:{}},'*')}catch(e){}">Go back home</button>
    <button class="alt" onclick="try{parent.postMessage({__veil:1,type:'search-request',d:{q:'${safeHost.replace(/'/g, "")}'}},'*')}catch(e){}">Search this site's content</button>
  </div>
</div>
<script data-veil-ctrl>try{parent.postMessage({__veil:1,type:"error",url:${JSON.stringify(target).replace(/</g, "\\u003c")},d:{message:${JSON.stringify(`${host} blocks proxy networks -- the site refused Veil's server.`).replace(/</g, "\\u003c")}}},"*")}catch(e){}</script>
</body></html>`;
}
