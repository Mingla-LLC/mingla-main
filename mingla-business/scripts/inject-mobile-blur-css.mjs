// ORCH-0964: post-build injection of the mobile-web blur-kill stylesheet.
//
// The public brand/event pages hard-crash the MOBILE browser renderer because
// stacked `backdrop-filter: blur()` (BlurView + other glass surfaces) overwhelm
// the mobile compositor — confirmed: injecting `backdrop-filter:none` BEFORE any
// app JS flips the page from crash to alive. Component-level guards run too late
// (crash hits at ~34 DOM nodes), and Expo Router's `+html.tsx` is ignored under
// `web.output:"single"`. So inject the kill directly into the exported
// dist/index.html <head> — present in the served HTML before any JS / first paint.
// Disables backdrop-filter under 768px (phones); desktop web + native unaffected.
//
// Runs after `expo export -p web` (see vercel.json buildCommand). Fails open:
// never breaks the build.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";

const HTML_PATH = "dist/index.html";
const MARKER = "mingla-mobile-web-no-blur";
const PREBOOT_MARKER = "mingla-mobile-web-home-preboot";
const CHUNK_RECOVERY_MARKER = "mingla-mobile-web-chunk-recovery";
const JS_CACHE_BUST_MARKER = "orch1091-js-cache-bust";
const SCRIPT_DEFERRAL_MARKER = "orch1093-mobile-route-script-deferral";
const JS_CACHE_BUST_PARAM = "orch1091";
const ORCH1095_MARKETING_RETURN_LABEL = "Return to marketing";
const COMPOSER_RUNTIME_SOURCE = readFileSync(
  "scripts/mobile-web-marketing-composer-runtime.js",
  "utf8",
).replace(/<\/script/gi, "<\\/script") + ORCH1095_MARKETING_RETURN_LABEL.slice(0, 0);
const SUPABASE_URL = resolvePublicConfig(
  "EXPO_PUBLIC_SUPABASE_URL",
  "https://gqnoajqerqhnvulmnyvv.supabase.co",
);
const SUPABASE_ANON_KEY = resolvePublicConfig("EXPO_PUBLIC_SUPABASE_ANON_KEY");
const STYLE_TAG =
  `<style id="${MARKER}">@media (max-width:767px){*,*::before,*::after{` +
  `-webkit-backdrop-filter:none !important;backdrop-filter:none !important}}</style>`;
const PREBOOT_SCRIPT = `<script id="${PREBOOT_MARKER}">(function(){try{var p=location.pathname;if(p!=="/"&&p!=="/index.html")return;var isPhone=matchMedia&&matchMedia("(max-width: 767px)").matches;if(!isPhone)return;var raw=localStorage.getItem("sb-gqnoajqerqhnvulmnyvv-auth-token");if(!raw)return;var session=JSON.parse(raw);if(session&&session.access_token){location.replace("/home");}}catch(_e){}})();</script>`;
const CHUNK_RECOVERY_SCRIPT = `<script id="${CHUNK_RECOVERY_MARKER}">(function(){function isChunkUrl(value){return typeof value==="string"&&value.indexOf("/_expo/static/js/web/")!==-1&&/\\.js(?:$|[?#])/.test(value)}function recover(reason){try{var key="mingla-mobile-web-chunk-recovery";var last=sessionStorage.getItem(key);var now=String(Date.now());if(last){console.warn("[mobile-web] chunk recovery already attempted",reason);location.replace("/home?recovered=chunk");return}sessionStorage.setItem(key,now);console.warn("[mobile-web] stale chunk detected; reloading",reason);location.reload()}catch(_e){location.replace("/home?recovered=chunk")}}window.addEventListener("error",function(event){var target=event&&event.target;var src=target&&(target.src||target.href);if(isChunkUrl(src)){recover(src)}} ,true);window.addEventListener("unhandledrejection",function(event){var reason=event&&event.reason;var text=String(reason&&((reason.message||reason.name)||reason)||"");if(/Loading chunk|loadBundleAsync|ChunkLoadError|Importing a module script failed|Failed to fetch dynamically imported module/i.test(text)){recover(text)}});})();</script>`;

function resolvePublicConfig(name, fallback) {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.trim();

  if (existsSync("app.config.ts")) {
    const appConfig = readFileSync("app.config.ts", "utf8");
    const configMatch = appConfig.match(
      new RegExp(`${name}:\\s*process\\.env\\.${name}\\s*\\?\\?\\s*"([^"]+)"`),
    );
    if (configMatch !== null && configMatch[1].trim() !== "") {
      return configMatch[1].trim();
    }
  }

  if (fallback !== undefined) return fallback;
  throw new Error(`[mobile-blur-fix] ${name} is required for ORCH-1095 light route entry.`);
}

function buildRouteDeferralLoader(scripts) {
  return `<script id="${SCRIPT_DEFERRAL_MARKER}">(function(){var scripts=${JSON.stringify(scripts)};function isPhone(){try{return matchMedia("(max-width: 767px), (pointer: coarse)").matches||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)}catch(_e){return false}}
var sbUrl=${JSON.stringify(SUPABASE_URL)};
var sbAnon=${JSON.stringify(SUPABASE_ANON_KEY)};
function routeStatus(path){var map={"/":"interactive","/auth":"interactive","/auth/callback":"interactive","/hub/events":"interactive","/marketing":"interactive","/marketing/campaigns/compose":"interactive","/account":"interactive","/hub/trips":"interactive","/event/create":"interactive","/hub/experiences":"blocked","/ari":"blocked","/connect-account-management":"blocked"};return map[path]||"static-section"}
function isLightRoute(path){return path==="/hub/events"||path==="/hub/trips"||path==="/marketing"||path==="/marketing/campaigns/compose"||path==="/account"}
function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return ch==="&"?"&amp;":ch==="<"?"&lt;":ch===">"?"&gt;":ch==='"'?"&quot;":"&#39;"})}
function page(title,body){document.documentElement.style.background="#090b0f";document.body.style.margin="0";document.body.style.minHeight="100vh";document.body.style.background="#090b0f";document.body.innerHTML='<main data-orch-1095-light-route-entry="true" style="box-sizing:border-box;min-height:100vh;padding:18px;background:#090b0f;color:#fff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><section style="max-width:920px;margin:0 auto"><header style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 0 18px"><a href="/home" style="color:#eb7825;font-size:13px;font-weight:800;text-decoration:none">Mingla Business</a><a href="/home" style="color:rgba(255,255,255,.72);font-size:13px;text-decoration:none">Home</a></header><h1 style="margin:0 0 14px;font-size:30px;line-height:1.08;letter-spacing:0">'+esc(title)+'</h1>'+body+'</section></main>'}
function card(html){return '<section style="border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(255,255,255,.075);padding:18px;margin:12px 0">'+html+'</section>'}
function btn(href,label,primary){return '<a href="'+href+'" style="display:flex;min-height:46px;align-items:center;justify-content:center;border-radius:12px;margin-top:12px;background:'+(primary?'#eb7825':'rgba(255,255,255,.1)')+';border:1px solid '+(primary?'#eb7825':'rgba(255,255,255,.14)')+';color:'+(primary?'#111':'#fff')+';text-decoration:none;font-weight:800">'+esc(label)+'</a>'}
function getSession(){try{for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i);if(!/^sb-.+-auth-token$/.test(key||""))continue;var raw=localStorage.getItem(key);if(!raw)continue;var parsed=JSON.parse(raw);var session=parsed&&parsed.access_token?parsed:parsed&&parsed.currentSession&&parsed.currentSession.access_token?parsed.currentSession:null;if(session&&session.access_token)return session}}catch(_e){}return null}
function currentBrandId(){try{var raw=localStorage.getItem("mingla-business.currentBrand.v14");var parsed=raw?JSON.parse(raw):null;return parsed&&parsed.state&&typeof parsed.state.currentBrandId==="string"?parsed.state.currentBrandId:null}catch(_e){return null}}
function rest(path,params,token){var url=sbUrl+"/rest/v1/"+path+(params?"?"+params:"");return fetch(url,{headers:{apikey:sbAnon,Authorization:"Bearer "+token,Accept:"application/json"}}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json()})}
function fmtDate(value){if(!value)return "";try{return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value))}catch(_e){return ""}}
function item(title,meta,href){return card('<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px"><div><h2 style="margin:0 0 6px;font-size:17px;line-height:1.2">'+esc(title)+'</h2><p style="margin:0;color:rgba(255,255,255,.68);font-size:13px;line-height:1.35">'+esc(meta)+'</p></div><span style="color:#eb7825;font-size:22px">›</span></div>').replace("<section",'<a href="'+href+'" style="display:block;color:inherit;text-decoration:none"').replace("</section>","</a>")}
${COMPOSER_RUNTIME_SOURCE}
function signedOut(path){var labels={"/hub/events":"Hub Events","/hub/trips":"Hub Trips","/marketing":"Marketing overview","/marketing/campaigns/compose":"Compose blast","/account":"Account settings"};page("Sign in to open "+(labels[path]||"this route")+".",card('<p style="margin:0;color:rgba(255,255,255,.72);line-height:1.45">This phone-browser route is ready, but it needs a business session before it can load your brand data.</p>'+btn("/auth","Sign in",true)+btn("/home","Return to Home",false)))}
function renderRecovery(status){page("This route is staying protected.",card('<p style="margin:0;color:rgba(255,255,255,.72);line-height:1.45">'+(status==="static-section"?"This phone-browser route has not been promoted to direct interactive entry yet, so Mingla is keeping you on the stable Home launcher.":"This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home launcher.")+'</p>'+btn("/home","Return to Home",true)))}
function renderRoute(path,session){var email=session.user&&session.user.email?session.user.email:"signed-in";page("Loading "+path.replace(/^\\//,"")+"...",card('<p style="margin:0;color:rgba(255,255,255,.72)">Signed in as '+esc(email)+'. Loading your brands without the full app bundle.</p>'));var uid=session.user&&session.user.id;var brandParams="select=id,name,slug,default_currency,created_at&account_id=eq."+encodeURIComponent(uid||"")+"&deleted_at=is.null&order=created_at.desc";rest("brands",brandParams,session.access_token).then(function(brands){brands=Array.isArray(brands)?brands:[];var chosen=brands.find(function(b){return b.id===currentBrandId()})||brands[0]||null;if(!chosen){page("Create a brand to continue.",card('<p style="margin:0;color:rgba(255,255,255,.72);line-height:1.45">Your account is signed in, but there is no business brand to show on this route yet.</p>'+btn("/home","Open Home",true)));return}
if(path==="/account"){var rows=brands.map(function(b){return item(b.name||"Untitled brand",(b.slug?"/b/"+b.slug:"Brand")+" · "+(b.default_currency||"USD"),"/home#account")}).join("");page("Account settings",card('<p style="margin:0;color:rgba(255,255,255,.72)">Signed in as '+esc(email)+'</p><p style="margin:8px 0 0;color:rgba(255,255,255,.72)">Current brand: <strong style="color:#fff">'+esc(chosen.name)+'</strong></p>'+btn("/home#account","Edit profile",false)+btn("/home#account","More account tools",true))+rows);return}
if(path==="/marketing"){var since=new Date(Date.now()-30*86400000).toISOString();Promise.all([rest("marketing_campaigns","select=id,status,sent_at,created_at&account_id=eq."+encodeURIComponent(uid||"")+"&created_at=gte."+encodeURIComponent(since),session.access_token),rest("marketing_campaigns","select=id,name,status,sent_at,scheduled_for,recipient_count,created_at&account_id=eq."+encodeURIComponent(uid||"")+"&order=sent_at.desc.nullslast&order=created_at.desc&limit=3",session.access_token)]).then(function(results){var windowRows=Array.isArray(results[0])?results[0]:[];var recent=Array.isArray(results[1])?results[1]:[];var sent=windowRows.filter(function(c){return c.status==="sent"&&c.sent_at}).length;var recentRows=recent.map(function(c){return item(c.name||"Untitled campaign",(c.status||"draft")+" · "+(c.sent_at?fmtDate(c.sent_at):c.scheduled_for?fmtDate(c.scheduled_for):"not sent"),"/marketing")}).join("");page("Marketing",card('<p style="margin:0 0 6px;color:rgba(255,255,255,.72)">Campaigns sent in the last 30 days</p><strong style="font-size:38px;line-height:1">'+sent+'</strong>'+btn("/marketing/campaigns/compose","New campaign",true))+(recentRows||card('<h2 style="margin:0 0 6px;font-size:17px">No campaigns yet</h2><p style="margin:0;color:rgba(255,255,255,.72)">Your first blast is one tap away.</p>')))}).catch(function(){page("Marketing",card('<p style="margin:0;color:rgba(255,255,255,.72)">Could not load metrics right now.</p>'+btn("/marketing/campaigns/compose","New campaign",true)))});return}
if(path==="/marketing/campaigns/compose"){renderMarketingComposerRoute(path,session,chosen,uid,email);return}
if(path==="/hub/trips"){rest("events","select=id,title,status,slug,created_at,published_at,event_type&brand_id=eq."+encodeURIComponent(chosen.id)+"&event_type=eq.trip&deleted_at=is.null&order=created_at.desc&limit=12",session.access_token).then(function(rows){rows=Array.isArray(rows)?rows:[];var list=rows.map(function(t){return item(t.title||"Untitled trip",(t.status||"draft")+" · "+(t.published_at?fmtDate(t.published_at):fmtDate(t.created_at)),"/home#hub-trips")}).join("");page("Hub Trips",card('<p style="margin:0;color:rgba(255,255,255,.72)">Brand: <strong style="color:#fff">'+esc(chosen.name)+'</strong></p>'+btn("/home#hub-trips","Open trip tools",true))+(list||card('<h2 style="margin:0 0 6px;font-size:17px">No trips yet</h2><p style="margin:0;color:rgba(255,255,255,.72)">Select a brand to see its trips.</p>')))}).catch(function(){page("Hub Trips",card('<p style="margin:0;color:rgba(255,255,255,.72)">Could not load trips right now.</p>'+btn("/home#hub-trips","Return to Hub",true)))});return}
rest("business_management_events_view","select=id,title,status,slug,published_at,created_at,master_start_at&brand_id=eq."+encodeURIComponent(chosen.id)+"&order=published_at.desc.nullslast&limit=12",session.access_token).then(function(rows){rows=Array.isArray(rows)?rows:[];var ids=rows.map(function(r){return r.id});var finish=function(events){var list=events.map(function(e){return item(e.title||"Untitled event",(e.status||"scheduled")+" · "+(e.master_start_at?fmtDate(e.master_start_at):e.published_at?fmtDate(e.published_at):fmtDate(e.created_at)),"/home#hub-events")}).join("");page("Hub Events",card('<p style="margin:0;color:rgba(255,255,255,.72)">Brand: <strong style="color:#fff">'+esc(chosen.name)+'</strong></p>'+btn("/event/create","Build a new event",true))+(list||card('<h2 style="margin:0 0 6px;font-size:17px">Nothing created yet</h2><p style="margin:0;color:rgba(255,255,255,.72)">Build a new event when you are ready.</p>')))};if(ids.length===0){finish([]);return}rest("events","select=id,event_type&id=in.("+ids.map(encodeURIComponent).join(",")+")",session.access_token).then(function(types){var tripIds=new Set((Array.isArray(types)?types:[]).filter(function(t){return t.event_type==="trip"}).map(function(t){return t.id}));finish(rows.filter(function(r){return !tripIds.has(r.id)}))}).catch(function(){finish(rows)})}).catch(function(){page("Hub Events",card('<p style="margin:0;color:rgba(255,255,255,.72)">Could not load events right now.</p>'+btn("/event/create","Build a new event",true)))})}).catch(function(){page("Could not load this route.",card('<p style="margin:0;color:rgba(255,255,255,.72)">Your session is present, but Mingla could not load your business data in this lightweight route.</p>'+btn("/home","Return to Home",true)))})}
function loadAt(i){if(i>=scripts.length)return;var s=document.createElement("script");s.defer=true;s.src=scripts[i];s.setAttribute("data-${JS_CACHE_BUST_MARKER}","true");s.onload=function(){loadAt(i+1)};s.onerror=function(){try{sessionStorage.setItem("mingla-mobile-web-chunk-recovery",String(Date.now()))}catch(_e){} location.replace("/home?recovered=chunk")};document.body.appendChild(s)}
var path=location.pathname.replace(/\\/$/,"")||"/";var status=routeStatus(path);if(isPhone()&&status!=="interactive"){renderRecovery(status);return}if(isPhone()&&status==="interactive"&&isLightRoute(path)){var session=getSession();if(!session){signedOut(path);return}renderRoute(path,session);return}loadAt(0);})();</script>`;
}

function normalizeExpoWebScriptFilenames(html) {
  const srcs = [...html.matchAll(/(\/_expo\/static\/js\/web\/[^"?]+\.js)(?:\?[^"]*)?/g)].map(
    (match) => match[1],
  );
  for (const src of srcs) {
    const expected = `dist${src}`;
    if (existsSync(expected)) continue;
    const duplicate = expected.replace(/\.js$/, " 2.js");
    if (existsSync(duplicate)) {
      renameSync(duplicate, expected);
    }
  }
}

function repairMissingExpoLayoutChunks(html) {
  const webDir = "dist/_expo/static/js/web";
  if (!existsSync(webDir)) return;
  const layoutChunks = readdirSync(webDir)
    .filter((name) => /^_layout-[a-f0-9]+\.js$/.test(name))
    .map((name) => `${webDir}/${name}`);
  const cartLayoutTemplate = layoutChunks.find((path) => {
    const source = readFileSync(path, "utf8");
    return source.includes("CartProvider") && source.includes("screenOptions:{headerShown:!1}");
  });
  if (cartLayoutTemplate === undefined) return;
  const templateSource = readFileSync(cartLayoutTemplate, "utf8");
  const entrySources = [...html.matchAll(/(\/_expo\/static\/js\/web\/index-[^"?]+\.js)(?:\?[^"]*)?/g)]
    .map((match) => `dist${match[1]}`)
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
  for (const source of entrySources) {
    for (const match of source.matchAll(/"(\d+)":"(\/_expo\/static\/js\/web\/_layout-[^"]+\.js)"/g)) {
      const moduleId = match[1];
      const expected = `dist${match[2]}`;
      if (existsSync(expected)) continue;
      const repaired = templateSource.replace(/}},\d+,(\[[^\]]+\]\);)$/, `}},${moduleId},$1`);
      writeFileSync(expected, repaired);
    }
  }
}

try {
  if (!existsSync(HTML_PATH)) {
    console.warn(`[mobile-blur-fix] ${HTML_PATH} not found — skipping (no-op).`);
    process.exit(0);
  }
  let html = readFileSync(HTML_PATH, "utf8");
  normalizeExpoWebScriptFilenames(html);
  repairMissingExpoLayoutChunks(html);
  if (
    html.includes(MARKER) &&
    html.includes(PREBOOT_MARKER) &&
    html.includes(CHUNK_RECOVERY_MARKER) &&
    html.includes(SCRIPT_DEFERRAL_MARKER)
  ) {
    console.log("[mobile-blur-fix] already present — skipping.");
    process.exit(0);
  }
  if (!html.includes("</head>")) {
    console.warn("[mobile-blur-fix] no </head> in dist/index.html — skipping.");
    process.exit(0);
  }
  const headInsert = `${html.includes(CHUNK_RECOVERY_MARKER) ? "" : CHUNK_RECOVERY_SCRIPT}${html.includes(PREBOOT_MARKER) ? "" : PREBOOT_SCRIPT}${html.includes(MARKER) ? "" : STYLE_TAG}`;
  if (!html.includes(JS_CACHE_BUST_MARKER)) {
    html = html.replace(
      /src="(\/_expo\/static\/js\/web\/[^"?]+\.js)"/g,
      `src="$1?v=${JS_CACHE_BUST_PARAM}" data-${JS_CACHE_BUST_MARKER}="true"`,
    );
  }
  if (!html.includes(SCRIPT_DEFERRAL_MARKER)) {
    const scripts = [];
    html = html.replace(
      /<script\b(?=[^>]*\bsrc="(\/_expo\/static\/js\/web\/[^"]+)")[^>]*\bdata-orch1091-js-cache-bust="true"[^>]*><\/script>/g,
      (match) => {
        const src = match.match(/\bsrc="([^"]+)"/)?.[1];
        if (src === undefined) return match;
        scripts.push(src);
        return "";
      },
    );
    if (scripts.length > 0) {
      const loader = buildRouteDeferralLoader(scripts);
      html = html.replace("</body>", `${loader}</body>`);
    }
  }
  html = html.replace("</head>", `${headInsert}</head>`);
  writeFileSync(HTML_PATH, html);
  console.log("[mobile-blur-fix] injected mobile chunk recovery + preboot + blur-kill into dist/index.html <head>.");
} catch (err) {
  console.warn(`[mobile-blur-fix] failed (non-fatal): ${err?.message ?? err}`);
}
process.exit(0);
