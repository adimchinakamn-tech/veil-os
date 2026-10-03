/**
 * Veil — client-side runtime interception layer.
 *
 * Injected into every rendered HTML page alongside the injected <base>.
 * This is the client half of the engine: it catches every dynamic URL the
 * page's JavaScript produces (fetch, XHR, WebSocket, EventSource, beacons,
 * property/attribute writes, pushState, window.open) and routes it through
 * the server-side endpoint so nothing ever leaks to the bare origin.
 *
 * It also virtualizes document.cookie and storage so each site gets its own
 * isolated jar (the app's real cookies/storage are never exposed to pages),
 * and spoofs document.referrer so remote-side checks see the real site URL.
 */

/** Attributes routed when written via setAttribute. */
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

/**
 * Build the runtime script.
 * @param navUrl absolute URL reported to the parent (the page's own address)
 * @param baseUrl absolute URL used for resolving references (respects <base>)
 * @param jsCookies JS-visible cookies for this host (or null)
 */
export function runtimeScript(navUrl: string, baseUrl: string, jsCookies: string | null): string {
  const navJson = JSON.stringify(navUrl).replace(/</g, "\\u003c");
  const baseJson = JSON.stringify(baseUrl).replace(/</g, "\\u003c");
  const hostJson = JSON.stringify(new URL(baseUrl).hostname).replace(/</g, "\\u003c");
  const cookieJson = jsCookies ? JSON.stringify(jsCookies).replace(/</g, "\\u003c") : "null";
  const prefixJson = JSON.stringify("/api/p/").replace(/</g, "\\u003c");
  const wsRelay = "/?XTransformPort=3003&target=";

  return `<script data-veil-rt>(function(){
if(window.__veilRT)return;window.__veilRT=1;
var P=${prefixJson},NAV=${navJson},BASE=${baseJson},HOST=${hostJson},INIT_COOKIES=${cookieJson};
var WS_RELAY=${JSON.stringify(wsRelay)};
var SKIP=/^(data:|blob:|javascript:|mailto:|tel:|about:|sms:|ftp:|irc:|magnet:|chrome:|chrome-extension:|moz-extension:|intent:|itms:|market:)/i;
function send(t,d){try{RP.postMessage({__veil:1,type:t,url:NAV,d:d||{}},"*")}catch(e){}}
function toRoute(u){
  if(typeof u!=="string")return u;
  if(u===""||u.charAt(0)==="#")return u;
  if(u.indexOf(P)===0)return u;
  if(SKIP.test(u))return u;
  try{
    var abs=new URL(u,BASE);
    if(abs.protocol!=="http:"&&abs.protocol!=="https:")return u;
    /* Already a same-origin veil route (page JS built it from location.href
     * or document.baseURI) — pass through as-is, never double-route it. */
    if(isSelfRoute(abs))return abs.pathname+abs.search+abs.hash;
    /* URL built from OUR shell origin (location.origin + path — YouTube's
     * InnerTube client does exactly this: "http://localhost:3000/youtubei/…").
     * Left alone it hits the SSRF guard and the app reports "offline".
     * Re-anchor the path onto the REAL page origin, then route it. */
    if(SELF_P&&abs.origin===SELF_O&&abs.pathname.indexOf(P)!==0){
      var re=new URL(abs.pathname+abs.search+abs.hash,BASE);
      if(re.protocol==="http:"||re.protocol==="https:"){
        return P+re.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
      }
    }
    return P+abs.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
  }catch(e){return u}
}
function routeSrcset(v){
  return String(v).split(",").map(function(part){
    var t=part.trim();if(!t)return null;
    var sp=t.search(/\\s/);
    return sp===-1?toRoute(t):toRoute(t.slice(0,sp))+t.slice(sp);
  }).filter(Boolean).join(", ");
}
function routeStyle(v){
  return String(v).replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi,function(m,q,u){return "url(\\""+toRoute(u)+"\\")"});
}

/* ---------- frame masquerade ------------------------------------------
 * Embedded SDKs (YouTube Playables, playable-platform loaders, ad
 * safeframes...) refuse to boot when window.parent/window.top differ
 * from window. Titles hosted here expect a top-level page, so every
 * framed page presents itself as top-level: parent/top report window
 * itself and frameElement reports null. The REAL parent is captured
 * first (RP) and is used exclusively by this runtime to talk to the
 * Veil shell. */
var RP=(function(){var p=window.parent;try{
  if(p!==window){
    Object.defineProperty(window,"parent",{get:function(){return window},configurable:true});
    Object.defineProperty(window,"top",{get:function(){return window},configurable:true});
    try{Object.defineProperty(window,"frameElement",{get:function(){return null},configurable:true})}catch(e){}
  }
}catch(e){}return p})();
/* Origin + route prefix of THIS frame — detects URLs the page's JS built
 * from location.href/document.baseURI that are ALREADY routed (e.g.
 * "http://host:3000/api/p/https/cdn.../44.js"). Re-routing those yields
 * /api/p/http/localhost:3000/api/p/… which the SSRF guard 403s — exactly
 * what froze heavy title loaders mid-boot (webpack chunks resolved against
 * baseURI). Such URLs must pass through untouched. */
var SELF_O=window.location.origin;
var SELF_P=window.location.pathname.indexOf(P)===0;
function isSelfRoute(abs){
  try{return SELF_P&&abs.origin===SELF_O&&abs.pathname.indexOf(P)===0}catch(e){return false}
}

/* ---------- JS-driven navigation (location.href=..., assign, replace) -
 * Without this, a page that sets location directly navigates the frame
 * to the bare external origin (escaping the veil). location.href is an
 * unforgeable own property of the location instance, so the modern
 * approach is the Navigation API: the "navigate" event fires BEFORE the
 * navigation commits and is cancelable — we preventDefault() the escape
 * and re-enter through a synthetic anchor carrying the routed URL.
 * location.assign/replace are prototype methods, so those are hooked
 * directly as belt-and-suspenders for engines without the event. */
try{
  var OA=Location.prototype.assign,ORP=Location.prototype.replace;
  if(OA)Location.prototype.assign=function(u){try{if(arguments.length)arguments[0]=toRoute(String(u))}catch(e){};return OA.apply(this,arguments)};
  if(ORP)Location.prototype.replace=function(u){try{if(arguments.length)arguments[0]=toRoute(String(u))}catch(e){};return ORP.apply(this,arguments)};
}catch(e){}
try{
  if(window.navigation&&window.navigation.addEventListener){
    window.navigation.addEventListener("navigate",function(ev){
      try{
        if(!ev.cancelable)return;
        var d=ev.destination;
        if(!d||d.sameDocument)return;
        var dest=String(d.url||"");
        if(!dest)return;
        var du=new URL(dest,window.location.href);
        /* Staying inside our origin on the veil route (a rewritten link
         * click, a form submit, or our own synthetic re-entry) — let it
         * commit untouched so this never loops. */
        if(du.origin===window.location.origin&&du.pathname.indexOf(P)===0)return;
        /* Only http(s) escapes matter; everything else is harmless. */
        if(du.protocol!=="http:"&&du.protocol!=="https:")return;
        /* Same document modulo the fragment — let the browser scroll. */
        if(du.href.split("#")[0]===window.location.href.split("#")[0])return;
        /* Block the escape, then re-enter through the veil. */
        ev.preventDefault();
        var routed=P+du.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
        var a=document.createElement("a");
        a.href=routed;
        a.setAttribute("data-veil-renav","1");
        a.style.display="none";
        document.documentElement.appendChild(a);
        a.click();
        setTimeout(function(){try{a.remove()}catch(x){}},0);
      }catch(e){}
    });
  }
}catch(e){}

/* ---------- report initial state ---------- */
try{send("nav",{title:document.title||""})}catch(e){}
try{var last=document.title;var mu=function(){try{if(document.title!==last){last=document.title;send("title",{title:last})}}catch(e){}setTimeout(mu,700)};setTimeout(mu,700)}catch(e){}
document.addEventListener("mousemove",function(e){
  var now=Date.now();
  if(e.clientY<=120&&now-(window.__veilLastM||0)>90){window.__veilLastM=now;send("mouse",{y:e.clientY})}
},true);
document.addEventListener("mouseleave",function(){send("mouse",{y:999})},true);
/* Escape pressed inside the frame surfaces the control bar in the shell. */
document.addEventListener("keydown",function(e){
  if(e.key==="Escape")try{send("esc",{})}catch(x){}
},true);
window.addEventListener("error",function(ev){
  try{if(ev&&ev.message)send("reserr",{message:String(ev.message).slice(0,200)})}catch(e){}
},true);

/* ---------- service workers: routed, not blocked ----------
 * The ACTIVE implementation lives in rewrite.ts controlScript (register +
 * getRegistration scope routing). This legacy layer keeps the same policy:
 * SW registration is allowed with a veiled scope, so SW-dependent sites
 * boot. See swShim() in rewrite.ts for the worker-side router. */
try{if(navigator.serviceWorker&&navigator.serviceWorker.register&&!(navigator.serviceWorker.__veilRouted)){try{Object.defineProperty(navigator.serviceWorker,"__veilRouted",{value:1})}catch(e2){}}}catch(e){}

/* ---------- spoof document.referrer with the real page URL ---------- */
try{Object.defineProperty(Document.prototype,"referrer",{get:function(){return NAV},configurable:true})}catch(e){}

/* ---------- fetch ---------- */
var oFetch=window.fetch;
function veilIsStream(b){return b&&typeof b==="object"&&typeof b.getReader==="function"}
/* Same-origin veiled responses can carry Set-Cookie headers the page
 * NEEDS to see (Brave search clearance, Cloudflare passes, YouTube
 * session rolls). Browsers hide Set-Cookie from JS — except through
 * Headers.getSetCookie() on same-origin responses, which we are. Capture
 * them into the virtual cookie jar so clearances survive re-requests. */
function veilCaptureCookies(resp){
  try{
    if(!resp||!resp.headers||typeof resp.headers.getSetCookie!=="function")return;
    var sc=resp.headers.getSetCookie();
    if(!sc||!sc.length)return;
    for(var i=0;i<sc.length;i++){
      try{document.cookie=sc[i]}catch(e){}
    }
  }catch(e){}
}
function veilFetchRaw(input,init){
  var pr=oFetch.call(window,input,init);
  try{
    return pr.then(function(resp){veilCaptureCookies(resp);return resp},function(err){throw err});
  }catch(e){return pr}
}
window.fetch=function(input,init){
  try{
    var url=typeof input==="string"?input:(input&&typeof input.url==="string"&&input instanceof Request)?input.url:(input&&input instanceof URL)?input.href:null;
    if(url!==null){
      var routed=toRoute(url);
      /* Streaming request bodies (InnerTube/SABR "duplex" fetches) cannot
       * run over an HTTP/1.1 origin — Chrome aborts the connection with
       * ERR_ALPN_NEGOTIATION_FAILED before a byte leaves. Buffer the stream
       * client-side and replay it as a classic buffered body; these request
       * bodies are finite, so the app never notices. (https/h2 origins run
       * them natively and skip this path.) */
      var stream=null;
      if(location.protocol==="http:"){
        if(init&&veilIsStream(init.body))stream=init.body;
        else if(input instanceof Request&&input.body&&input.duplex==="half")stream=input.body;
      }
      if(stream){
        var self=this;
        var headers={};
        try{
          if(input instanceof Request)input.headers.forEach(function(v,k){headers[k]=v});
          else if(init&&init.headers&&typeof init.headers.forEach==="function")init.headers.forEach(function(v,k){headers[k]=v});
          else if(init&&init.headers)headers=init.headers;
        }catch(e){headers={}}
        var method=(init&&init.method)||(input instanceof Request&&input.method)||"POST";
        var creds=(init&&init.credentials)||(input instanceof Request&&input.credentials);
        return new Response(stream).arrayBuffer().then(function(buf){
          var ni={method:method,headers:headers,body:buf};
          if(creds)ni.credentials=creds;
          if(init&&init.signal)ni.signal=init.signal;
          if(init&&init.mode)ni.mode=init.mode;
          if(init&&init.cache)ni.cache=init.cache;
          if(init&&init.redirect)ni.redirect=init.redirect;
          if(init&&init.keepalive)ni.keepalive=true;
          return veilFetchRaw(routed,ni);
        },function(){
          return veilFetchRaw(routed,init||{});
        });
      }
      if(typeof input==="string")input=routed;
      else if(input&&typeof input.url==="string"&&input instanceof Request)input=new Request(routed,input);
      else if(input&&input instanceof URL)input=routed;
    }
  }catch(e){}
  return veilFetchRaw(input,init);
};

/* ---------- XMLHttpRequest ---------- */
try{
  var oOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    try{if(arguments.length>1)arguments[1]=toRoute(String(u))}catch(e){}
    return oOpen.apply(this,arguments);
  };
}catch(e){}

/* ---------- WebSocket via the relay ---------- */
try{
  var OW=window.WebSocket;
  function VeilWs(url,protocols){
    var target=null;
    try{
      var abs=new URL(String(url),BASE);
      if(abs.protocol==="ws:"||abs.protocol==="wss:"){
        target=abs.href;
        /* same-host ws URLs re-anchor onto the veiled page's real origin
         * (see controlScript's VeilWs for the full rationale) */
        if(abs.host===location.host){
          if(abs.pathname.indexOf(P)===0){
            var inner=abs.pathname.slice(P.length).replace(/^(https?)\//i,"$1://");
            if(inner)target=inner.replace(/^http/i,"ws")+abs.search;
          }else{
            var b=new URL(BASE);
            target=(b.protocol==="https:"?"wss://":"ws://")+b.host+abs.pathname+abs.search;
          }
        }
      }
    }catch(e){}
    if(!target)return new OW(url,protocols);
    var relay=WS_RELAY+encodeURIComponent(target);
    return new OW(relay,protocols);
  }
  VeilWs.prototype=OW.prototype;
  VeilWs.CONNECTING=0;VeilWs.OPEN=1;VeilWs.CLOSING=2;VeilWs.CLOSED=3;
  window.WebSocket=VeilWs;
}catch(e){}

/* ---------- EventSource ---------- */
try{
  var OES=window.EventSource;
  if(OES){
    function VeilES(url,cfg){return new OES(toRoute(String(url)),cfg)}
    VeilES.prototype=OES.prototype;
    VeilES.CONNECTING=0;VeilES.OPEN=1;VeilES.CLOSED=2;
    window.EventSource=VeilES;
  }
}catch(e){}

/* ---------- sendBeacon ---------- */
try{
  if(navigator.sendBeacon){
    var oBeacon=navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=function(u,data){try{arguments[0]=toRoute(String(u))}catch(e){};return oBeacon(arguments[0],data)};
  }
}catch(e){}

/* ---------- setAttribute for URL-bearing attributes ---------- */
try{
  var URLATTRS=${JSON.stringify(URL_ATTRS)};
  var URLSET={};for(var i=0;i<URLATTRS.length;i++)URLSET[URLATTRS[i]]=1;
  var oSetAttr=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){
    try{
      var ln=String(name).toLowerCase();
      if(typeof value==="string"){
        if(URLSET[ln])value=toRoute(value);
        else if(ln==="srcset"||ln==="imagesrcset")value=routeSrcset(value);
        else if(ln==="style"&&value.indexOf("url(")!==-1)value=routeStyle(value);
      }
    }catch(e){}
    return oSetAttr.call(this,name,value);
  };
}catch(e){}

/* ---------- element URL properties (img.src etc.) ---------- */
function hookProp(proto,prop,fx){
  try{
    var d=Object.getOwnPropertyDescriptor(proto,prop);
    if(!d||!d.set||!d.get)return;
    Object.defineProperty(proto,prop,{
      get:function(){return d.get.call(this)},
      set:function(v){try{v=fx(String(v))}catch(e){};return d.set.call(this,v)},
      configurable:true,enumerable:d.enumerable
    });
  }catch(e){}
}
try{
  var H=window;
  hookProp(H.HTMLImageElement.prototype,"src",toRoute);
  hookProp(H.HTMLImageElement.prototype,"srcset",routeSrcset);
  hookProp(H.HTMLScriptElement.prototype,"src",toRoute);
  hookProp(H.HTMLIFrameElement.prototype,"src",toRoute);
  hookProp(H.HTMLMediaElement.prototype,"src",toRoute);
  hookProp(H.HTMLSourceElement.prototype,"src",toRoute);
  hookProp(H.HTMLSourceElement.prototype,"srcset",routeSrcset);
  hookProp(H.HTMLTrackElement.prototype,"src",toRoute);
  hookProp(H.HTMLEmbedElement.prototype,"src",toRoute);
  hookProp(H.HTMLObjectElement.prototype,"data",toRoute);
  hookProp(H.HTMLAnchorElement.prototype,"href",toRoute);
  hookProp(H.HTMLLinkElement.prototype,"href",toRoute);
  hookProp(H.HTMLAreaElement.prototype,"href",toRoute);
  hookProp(H.HTMLFormElement.prototype,"action",toRoute);
  hookProp(H.HTMLButtonElement.prototype,"formAction",toRoute);
  hookProp(H.HTMLInputElement.prototype,"formAction",toRoute);
  hookProp(H.HTMLVideoElement.prototype,"poster",toRoute);
}catch(e){}

/* ---------- CSS background images written via style props ----------
 * YouTube (and many SPAs) set el.style.backgroundImage = url(...) for
 * thumbnails and hover previews instead of attributes. */
try{
  var CSP=window.CSSStyleDeclaration&&CSSStyleDeclaration.prototype;
  if(CSP){
    ["backgroundImage","background"].forEach(function(prop){
      try{
        var sd=Object.getOwnPropertyDescriptor(CSP,prop);
        if(!sd||!sd.set||!sd.get)return;
        Object.defineProperty(CSP,prop,{
          get:function(){return sd.get.call(this)},
          set:function(v){try{v=String(v);if(v.indexOf("url(")>=0)v=routeStyle(v)}catch(e){};return sd.set.call(this,v)},
          configurable:true,enumerable:sd.enumerable
        });
      }catch(e){}
    });
  }
}catch(e){}

/* ---------- MutationObserver: nodes injected via innerHTML ----------
 * Modern SPAs (YouTube above all) build most of the DOM with innerHTML
 * and template injection — the property hooks above never fire for those
 * nodes because they were never assigned through the prototypes. The
 * observer re-routes URL attributes on inserted subtrees (and attribute
 * writes that slipped past the hooks). Rewrites are idempotent — an
 * already-routed value passes through toRoute unchanged — so re-entrant
 * mutation records settle immediately instead of looping. */
try{
  if(window.MutationObserver){
    var OBS=URLATTRS.concat(["srcset","imagesrcset","style"]);
    var TAGOK=/^(IMG|SCRIPT|LINK|IFRAME|FRAME|SOURCE|VIDEO|AUDIO|TRACK|EMBED|OBJECT|A|AREA|FORM|INPUT|BUTTON|USE)$/;
    function rwAttrEl(el,name){
      try{
        var v=el.getAttribute(name);
        if(typeof v!=="string"||!v)return;
        var nv;
        if(name==="style")nv=v.indexOf("url(")>=0?routeStyle(v):v;
        else if(name==="srcset"||name==="imagesrcset")nv=routeSrcset(v);
        else nv=toRoute(v);
        if(nv!==v)oSetAttr.call(el,name,nv);
      }catch(e){}
    }
    function scanNode(n){
      if(!n||n.nodeType!==1)return;
      var i,k,el;
      if(TAGOK.test(n.tagName)){
        for(i=0;i<OBS.length;i++)rwAttrEl(n,OBS[i]);
      }else if(n.getAttribute&&n.getAttribute("style")){
        rwAttrEl(n,"style");
      }
      try{
        var list=n.querySelectorAll("[src],[href],[srcset],[poster],[action],[background],[formaction],[data-src],[data-original],[data-bg],[data-url],[data-href],[style]");
        for(k=0;k<list.length;k++){
          el=list[k];
          for(i=0;i<OBS.length;i++)rwAttrEl(el,OBS[i]);
        }
      }catch(e){}
    }
    var veilMO=new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){
        var m=muts[i];
        if(m.type==="attributes"){
          if(m.target&&m.target.nodeType===1)rwAttrEl(m.target,m.attributeName);
        }else{
          var add=m.addedNodes;
          for(var j=0;j<add.length;j++)scanNode(add[j]);
        }
      }
    });
    scanNode(document.documentElement);
    veilMO.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:OBS});
  }
}catch(e){}

/* ---------- history push/replace -> keep parent in sync ----------
 * SPA routers (YouTube's polymer history above all) pushState() their own
 * bare site paths ("/watch?v=…"). Left alone, the frame's location escapes
 * the /api/p/ prefix — the URL bar reload 404s and page JS that builds
 * URLs from location breaks. Rewrite the pushed URL onto the veil route
 * (same-origin path, so the History API accepts it) and report the REAL
 * page URL to the parent. */
try{
  ["pushState","replaceState"].forEach(function(m){
    var orig=history[m];
    history[m]=function(state,title,url){
      try{
        if(typeof url==="string"&&url!==""&&url.charAt(0)!=="#"){
          var routed=toRoute(url);
          if(routed!==url){
            /* The rewritten path must stay same-origin for the History API. */
            if(routed.indexOf("/")===0||routed.indexOf(location.origin+"/")===0){
              arguments[2]=routed;
            }
          }
        }
      }catch(e){}
      var r=orig.apply(this,arguments);
      try{
        var abs=url?new URL(String(url),BASE).href:NAV;
        send("push",{url:abs,replace:m==="replaceState"});
      }catch(e){}
      return r;
    };
  });
}catch(e){}

/* ---------- window.open -> route target, notify parent ---------- */
try{
  var oOpenW=window.open;
  window.open=function(u){
    try{
      if(typeof u==="string"&&u!=="about:blank"&&!SKIP.test(u)){
        var abs=new URL(u,BASE);
        if(abs.protocol==="http:"||abs.protocol==="https:"){
          /* Same-origin veil route — open as-is (never double-route). */
          if(!isSelfRoute(abs)){
            var routed=P+abs.href.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/\\//,"$1/");
            arguments[0]=routed;
          }
          send("open",{url:abs.href});
        }
      }
    }catch(e){}
    return oOpenW.apply(window,arguments);
  };
}catch(e){}

/* ---------- virtualized document.cookie (per-site jar) ---------- */
(function(){
  var jar={};
  function parseInit(s){
    String(s).split(";").forEach(function(pair){
      var eq=pair.indexOf("=");
      if(eq<0)return;
      var k=pair.slice(0,eq).trim(),v=pair.slice(eq+1).trim();
      if(k)jar[k]={v:v};
    });
  }
  if(INIT_COOKIES)parseInit(INIT_COOKIES);
  function persist(str){
    try{
      /* Scope the relay to the calling viewer. Same-origin first-party
       * traffic carries the veil_viewer cookie automatically; the
       * offline shell's cross-origin embeds instead stamp ?vv= on the
       * iframe URL — pick it up from our own location and forward it
       * so one file's jar never bleeds into another browser's. */
      var vv="";
      try{
        var q=new URLSearchParams(location.search).get("vv");
        if(q&&/^[A-Za-z0-9_-]{6,64}$/.test(q))vv="?vv="+encodeURIComponent(q);
      }catch(e){}
      oFetch("/api/cookies"+vv,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({host:HOST,cookie:str}),keepalive:true}).catch(function(){});
    }catch(e){}
  }
  try{
    var d=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");
    if(d&&d.configurable){
      Object.defineProperty(document,"cookie",{
        get:function(){
          var out=[];
          for(var k in jar)if(jar.hasOwnProperty(k))out.push(k+"="+jar[k].v);
          return out.join("; ");
        },
        set:function(str){
          try{
            var s=String(str);
            var seg=s.split(";");
            var nv=seg[0]||"";
            var eq=nv.indexOf("=");
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
            if(dead)delete jar[name];else jar[name]={v:value};
            persist(s);
          }catch(e){}
        },
        configurable:true
      });
    }
  }catch(e){}
})();

/* ---------- storage isolation (prefix per site, memory fallback) ---------- */
(function(){
  var realLS=null,realSS=null;
  try{realLS=window.localStorage;window.localStorage.getItem("__v");}catch(e){realLS=null}
  try{realSS=window.sessionStorage;window.sessionStorage.getItem("__v");}catch(e){realSS=null}
  function makeStore(real,kind){
    var mem={};
    var pref="v:"+kind+":"+HOST+":";
    function full(k){return pref+k}
    function withReal(f,fallback){
      if(!real)return fallback();
      try{return f()}catch(e){return fallback()}
    }
    return {
      get length(){
        return withReal(function(){
          var n=0;for(var i=0;i<real.length;i++)if(real.key(i).indexOf(pref)===0)n++;
          return n;
        },function(){var n=0;for(var k in mem)if(mem.hasOwnProperty(k))n++;return n});
      },
      key:function(i){return withReal(function(){
        var n=0;for(var j=0;j<real.length;j++){var k=real.key(j);if(k.indexOf(pref)===0){if(n===i)return k.slice(pref.length);n++}}
        return null;
      },function(){var n=0;for(var k in mem)if(mem.hasOwnProperty(k)){if(n===i)return k;n++}return null})},
      getItem:function(k){
        k=String(k);
        return withReal(function(){var v=real.getItem(full(k));return v===null&&mem[k]!==undefined?mem[k]:v},function(){return mem.hasOwnProperty(k)?mem[k]:null});
      },
      setItem:function(k,v){
        k=String(k);v=String(v);mem[k]=v;
        withReal(function(){real.setItem(full(k),v)},function(){});
      },
      removeItem:function(k){
        k=String(k);delete mem[k];
        withReal(function(){real.removeItem(full(k))},function(){});
      },
      clear:function(){
        mem={};
        withReal(function(){
          var keys=[];for(var i=0;i<real.length;i++){var k=real.key(i);if(k.indexOf(pref)===0)keys.push(k)}
          keys.forEach(function(k){real.removeItem(k)});
        },function(){});
      }
    };
  }
  try{
    if(realLS)Object.defineProperty(window,"localStorage",{get:function(){return makeStore(realLS,"ls")},configurable:true});
    if(realSS)Object.defineProperty(window,"sessionStorage",{get:function(){return makeStore(realSS,"ss")},configurable:true});
  }catch(e){}
})();
})()</script>`;
}
