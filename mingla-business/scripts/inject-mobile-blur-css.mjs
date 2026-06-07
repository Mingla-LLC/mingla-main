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
// ORCH-1098 Stage 3: the static-home preboot redirect and the orch1093/1095
// per-route firewall/deferral loader were REMOVED. The real Expo app now boots
// on phone browsers (the BottomNav reanimated OOM is fixed in BottomNav.web.tsx),
// so phones no longer need a static stand-in or hand-rolled per-route fallbacks.
// What remains is genuinely orthogonal and still valid: (1) the mobile blur-kill
// <style> (compositor perf helper), and (2) the stale-chunk recovery script +
// ORCH-1091 cache-bust query param (load-bearing once any code-splitting exists).
//
// Runs after `expo export -p web` (see vercel.json buildCommand). Fails open:
// never breaks the build.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";

const HTML_PATH = "dist/index.html";
const MARKER = "mingla-mobile-web-no-blur";
const CHUNK_RECOVERY_MARKER = "mingla-mobile-web-chunk-recovery";
const JS_CACHE_BUST_MARKER = "orch1091-js-cache-bust";
const JS_CACHE_BUST_PARAM = "orch1091";
const STYLE_TAG =
  `<style id="${MARKER}">@media (max-width:767px){*,*::before,*::after{` +
  `-webkit-backdrop-filter:none !important;backdrop-filter:none !important}}</style>`;
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
  if (html.includes(MARKER) && html.includes(CHUNK_RECOVERY_MARKER)) {
    console.log("[mobile-blur-fix] already present — skipping.");
    process.exit(0);
  }
  if (!html.includes("</head>")) {
    console.warn("[mobile-blur-fix] no </head> in dist/index.html — skipping.");
    process.exit(0);
  }
  const headInsert = `${html.includes(CHUNK_RECOVERY_MARKER) ? "" : CHUNK_RECOVERY_SCRIPT}${html.includes(MARKER) ? "" : STYLE_TAG}`;
  // ORCH-1091: cache-bust the Expo chunk URLs so phones can't serve a broken
  // stale chunk after a deploy. The scripts stay inline in the HTML (the real
  // Expo app boots directly now — no deferral loader, no light-route firewall).
  if (!html.includes(JS_CACHE_BUST_MARKER)) {
    html = html.replace(
      /src="(\/_expo\/static\/js\/web\/[^"?]+\.js)"/g,
      `src="$1?v=${JS_CACHE_BUST_PARAM}" data-${JS_CACHE_BUST_MARKER}="true"`,
    );
  }
  html = html.replace("</head>", `${headInsert}</head>`);
  writeFileSync(HTML_PATH, html);
  console.log("[mobile-blur-fix] injected mobile chunk recovery + blur-kill into dist/index.html <head>.");
} catch (err) {
  console.warn(`[mobile-blur-fix] failed (non-fatal): ${err?.message ?? err}`);
}
process.exit(0);
