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
//
// ---------------------------------------------------------------------------
// Issue #1485 [web-missing-chunk-404] P2-1: ONE recovery decision, TWO owners.
//
// Business web has two places that can react to a failed chunk:
//
//   1. THIS inline <head> script — runs BEFORE any bundle exists, and is the
//      ONLY thing that can see a *resource* `error` (a `<script src>` that
//      404s, including the ENTRY bundle itself). A resource error carries no
//      `event.message`, only `event.target.src`, so `chunkReloadGuard` — which
//      keys entirely off `event.message` / `event.error.message` AND ships
//      inside the very bundle that failed — can never cover this class. It is
//      kept for exactly that reason (INVESTIGATION D-3).
//   2. `src/diagnostics/chunkReloadGuard.ts` — post-boot, sees script-execution
//      and dynamic-import failures by message text.
//
// They MUST NOT both act on one failure and MUST NOT double-reload, so they
// share ONE decision record: the same sessionStorage key and the same 10s
// time-based cooldown as `chunkReloadGuard`'s `RELOAD_TS_KEY` /
// `RELOAD_COOLDOWN_MS`. Whichever owner fires first stamps the shared key and
// reloads; the other reads the stamp in the same tick and stands down. The
// literals are pinned equal to the guard's by
// `__tests__/issue1485_p2_1_one_chunk_recovery_owner.test.ts` (the inline
// script cannot import anything — it is <head>-blocking, ES5, dependency-free).
//
// Two behaviours were REMOVED here because they destroyed the user's URL. Both
// used a replace-navigation to a hard-coded dashboard route (the retired
// "recovered" query form, deliberately not repeated verbatim so the CI pin in
// `src/utils/__tests__/orch_1090_mobile_web_chunk_auth_recovery.test.ts` can
// scan this whole file for it):
//   * the second-failure branch replace-navigated away, ejecting an anonymous
//     buyer off `/checkout/<eventId>` onto the AUTHENTICATED brand dashboard
//     and erasing the checkout URL from history — the back button could not
//     bring it back;
//   * the `catch` fallback did the same on the FIRST failure whenever
//     sessionStorage threw (private / blocked-storage browsers).
// Recovery now only ever reloads the CURRENT url, and blocked storage fails
// safe: no reload, no navigation, ever.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";

const HTML_PATH = "dist/index.html";
const MARKER = "mingla-mobile-web-no-blur";
const CHUNK_RECOVERY_MARKER = "mingla-mobile-web-chunk-recovery";
// #1485 P2-1: the SHARED cooldown record — must stay byte-equal to
// chunkReloadGuard.ts's RELOAD_TS_KEY / RELOAD_COOLDOWN_MS (CI-pinned).
const CHUNK_RECOVERY_KEY = "mingla:last-chunk-reload";
const CHUNK_RECOVERY_COOLDOWN_MS = 10000;
// ---------------------------------------------------------------------------
// Issue #1876 F-3: the suppression branch is a PERMANENT DEAD END, so it has to
// terminate in something the user can see and act on.
//
// The 10,000 ms cooldown above is the ONLY thing that guarantees recovery can
// never reload-loop, so it cannot be relaxed. That makes its suppression branch
// unreachable-by-design for a second attempt: once it fires, nothing else will
// ever run. #1485 left that branch as a bare `console.warn` and deferred to
// "the ErrorBoundary's recoverable fallback" — but the ErrorBoundary ships
// INSIDE the entry bundle. When the ENTRY bundle is the missing file, React
// never mounts, there is no boundary, and `<div id="root">` stays empty
// forever. The deployed <body> on 2026-08-11 was a <noscript> + an empty #root
// + three <script defer> tags and nothing else: a permanently white page with
// no message and no way out. Constitution rule 3, live in production.
//
// So the suppression branch (and the blocked-storage `catch`, which never gets
// even one reload) now arms a 1500 ms timer that paints `#mingla-boot-error`
// into document.body.
//
// THE 1500 ms + EMPTY-#root TEST IS THE WHOLE SAFETY ARGUMENT. A suppressed
// LAZY-ROUTE failure is survivable — React is alive, the app is on screen, and
// a card thrown over a working app would be a WORSE bug than the blank page it
// replaces. So the card renders only if #root is STILL empty when the timer
// fires. It is appended as a SIBLING of #root, never into it, so React can
// still mount over #root untouched if a late chunk lands.
//
// CONSTRAINTS ON EDITING THE SCRIPT BELOW — all CI-enforced, all easy to trip:
//   * `${...}` interpolation is limited to CHUNK_RECOVERY_MARKER /
//     CHUNK_RECOVERY_KEY / CHUNK_RECOVERY_COOLDOWN_MS. The #1485 suites rebuild
//     the shipped bytes with `new Function` bound to exactly those three names,
//     so any other interpolation throws a ReferenceError in CI. New literals go
//     INLINE (that is why 1500 and the copy strings are hard-coded here).
//   * ES5 only, no backticks, no `</script`, no navigation primitive other than
//     `window.location.reload()` — pinned by
//     `issue1485_p2_1_recovery_never_navigates.tester.adversarial.test.ts` I.4/N.2.
//   * Reach the DOM through `window.document` / `window.setTimeout` and guard
//     both. The #1485 harnesses execute these bytes against a SYNTHETIC window
//     with neither, and a bare `document` reference would throw where those
//     suites assert nothing escapes.
// ---------------------------------------------------------------------------
const JS_CACHE_BUST_MARKER = "orch1091-js-cache-bust";
const JS_CACHE_BUST_PARAM = "orch1091";
const STYLE_TAG =
  `<style id="${MARKER}">@media (max-width:767px){*,*::before,*::after{` +
  `-webkit-backdrop-filter:none !important;backdrop-filter:none !important}}</style>`;
const CHUNK_RECOVERY_SCRIPT = `<script id="${CHUNK_RECOVERY_MARKER}">(function(){var KEY="${CHUNK_RECOVERY_KEY}";var LEGACY_KEY="${CHUNK_RECOVERY_MARKER}";var COOLDOWN_MS=${CHUNK_RECOVERY_COOLDOWN_MS};try{var boot=window.sessionStorage;var carried=boot.getItem(LEGACY_KEY);if(carried!==null){if(boot.getItem(KEY)===null){boot.setItem(KEY,carried)}boot.removeItem(LEGACY_KEY)}}catch(_m){/* storage blocked: nothing to migrate, and nothing to recover with */}function isChunkUrl(value){return typeof value==="string"&&value.indexOf("/_expo/static/js/web/")!==-1&&/\\.js(?:$|[?#])/.test(value)}var BOOT_ERROR_ID="mingla-boot-error";var BOOT_ERROR_DELAY_MS=1500;var bootErrorArmed=false;function bootRootIsEmpty(doc){var root=doc.getElementById("root");return !root||!root.childNodes||root.childNodes.length===0}function paintBootError(doc){if(!doc.body){return}if(doc.getElementById(BOOT_ERROR_ID)){return}if(!bootRootIsEmpty(doc)){return}var host=doc.createElement("div");host.id=BOOT_ERROR_ID;host.setAttribute("role","alert");host.style.cssText="box-sizing:border-box;max-width:22rem;margin:15vh auto 0;padding:24px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";var title=doc.createElement("h1");title.textContent="This page didn't finish loading";title.style.cssText="margin:0 0 8px;font-size:18px;line-height:24px;font-weight:600;color:#1f2430";var copy=doc.createElement("p");copy.textContent="Mingla just updated in the background. Reload and you'll be right back where you were.";copy.style.cssText="margin:0 0 20px;font-size:15px;line-height:22px;color:#4a5160";var button=doc.createElement("button");button.type="button";button.textContent="Reload";button.style.cssText="min-width:44px;min-height:44px;padding:0 24px;border:0;border-radius:8px;background:#eb7825;color:#ffffff;font-size:16px;line-height:44px;font-weight:600;cursor:pointer";button.onclick=function(){window.location.reload()};host.appendChild(title);host.appendChild(copy);host.appendChild(button);doc.body.appendChild(host)}function armBootError(){if(bootErrorArmed){return}var doc=window.document;if(!doc||typeof doc.createElement!=="function"||typeof doc.getElementById!=="function"){return}if(typeof window.setTimeout!=="function"){return}bootErrorArmed=true;window.setTimeout(function(){try{if(doc.body){paintBootError(doc);return}if(typeof doc.addEventListener==="function"){doc.addEventListener("DOMContentLoaded",function(){try{paintBootError(doc)}catch(_d){}})}}catch(_t){}},BOOT_ERROR_DELAY_MS)}function recover(reason){try{var store=window.sessionStorage;var now=Date.now();var last=Number(store.getItem(KEY)||0);if(isFinite(last)&&now-last<COOLDOWN_MS){console.warn("[mobile-web] chunk recovery suppressed by the shared cooldown",reason);armBootError();return}store.setItem(KEY,String(now));console.warn("[mobile-web] stale chunk detected; reloading",reason);window.location.reload()}catch(_e){console.warn("[mobile-web] chunk recovery unavailable (sessionStorage blocked); not reloading",reason);armBootError()}}window.addEventListener("error",function(event){var target=event&&event.target;var src=target&&(target.src||target.href);if(isChunkUrl(src)){recover(src)}} ,true);window.addEventListener("unhandledrejection",function(event){var reason=event&&event.reason;var text=String(reason&&((reason.message||reason.name)||reason)||"");if(/Loading chunk|loadBundleAsync|ChunkLoadError|Importing a module script failed|Failed to fetch dynamically imported module/i.test(text)){recover(text)}});})();</script>`;

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
