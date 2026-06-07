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
const STYLE_TAG =
  `<style id="${MARKER}">@media (max-width:767px){*,*::before,*::after{` +
  `-webkit-backdrop-filter:none !important;backdrop-filter:none !important}}</style>`;
const PREBOOT_SCRIPT = `<script id="${PREBOOT_MARKER}">(function(){try{var p=location.pathname;if(p!=="/"&&p!=="/index.html")return;var isPhone=matchMedia&&matchMedia("(max-width: 767px)").matches;if(!isPhone)return;var raw=localStorage.getItem("sb-gqnoajqerqhnvulmnyvv-auth-token");if(!raw)return;var session=JSON.parse(raw);if(session&&session.access_token){location.replace("/home");}}catch(_e){}})();</script>`;
const CHUNK_RECOVERY_SCRIPT = `<script id="${CHUNK_RECOVERY_MARKER}">(function(){function isChunkUrl(value){return typeof value==="string"&&value.indexOf("/_expo/static/js/web/")!==-1&&/\\.js(?:$|[?#])/.test(value)}function recover(reason){try{var key="mingla-mobile-web-chunk-recovery";var last=sessionStorage.getItem(key);var now=String(Date.now());if(last){console.warn("[mobile-web] chunk recovery already attempted",reason);location.replace("/home?recovered=chunk");return}sessionStorage.setItem(key,now);console.warn("[mobile-web] stale chunk detected; reloading",reason);location.reload()}catch(_e){location.replace("/home?recovered=chunk")}}window.addEventListener("error",function(event){var target=event&&event.target;var src=target&&(target.src||target.href);if(isChunkUrl(src)){recover(src)}} ,true);window.addEventListener("unhandledrejection",function(event){var reason=event&&event.reason;var text=String(reason&&((reason.message||reason.name)||reason)||"");if(/Loading chunk|loadBundleAsync|ChunkLoadError|Importing a module script failed|Failed to fetch dynamically imported module/i.test(text)){recover(text)}});})();</script>`;

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
      const loader = `<script id="${SCRIPT_DEFERRAL_MARKER}">(function(){var scripts=${JSON.stringify(scripts)};function isPhone(){try{return matchMedia("(max-width: 767px), (pointer: coarse)").matches||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)}catch(_e){return false}}function blockedStatus(path){var map={"/hub/events":"approved","/marketing":"approved","/marketing/campaigns/compose":"approved","/account":"approved","/hub/trips":"approved","/event/create":"approved","/hub/experiences":"blocked","/ari":"blocked","/connect-account-management":"blocked"};return map[path]||"approved"}function renderRecovery(status){document.documentElement.style.background="#090b0f";document.body.style.margin="0";document.body.style.minHeight="100vh";document.body.style.background="#090b0f";document.body.innerHTML='<main style="box-sizing:border-box;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:#090b0f;color:#fff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><section style="width:100%;max-width:440px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(255,255,255,.08);padding:28px"><p style="margin:0 0 10px;color:#eb7825;font-size:12px;font-weight:800;text-transform:uppercase">Mingla Business</p><h1 style="margin:0 0 14px;font-size:26px;line-height:1.15">This route is staying protected.</h1><p style="margin:0 0 22px;color:rgba(255,255,255,.72);font-size:15px;line-height:1.45">'+(status==="pending-proof"?"This phone-browser route still needs physical Android Chrome and mobile Safari proof before direct entry opens.":"This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home launcher.")+'</p><a href="/home" style="display:flex;min-height:48px;align-items:center;justify-content:center;border-radius:12px;background:#eb7825;color:#111;text-decoration:none;font-weight:800">Return to Home</a></section></main>'}function loadAt(i){if(i>=scripts.length)return;var s=document.createElement("script");s.defer=true;s.src=scripts[i];s.setAttribute("data-${JS_CACHE_BUST_MARKER}","true");s.onload=function(){loadAt(i+1)};s.onerror=function(){try{sessionStorage.setItem("mingla-mobile-web-chunk-recovery",String(Date.now()))}catch(_e){} location.replace("/home?recovered=chunk")};document.body.appendChild(s)}var status=blockedStatus(location.pathname.replace(/\\/$/,""));if(isPhone()&&status!=="approved"){renderRecovery(status);return}loadAt(0);})();</script>`;
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
