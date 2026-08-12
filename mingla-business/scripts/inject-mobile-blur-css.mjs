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
// ---------------------------------------------------------------------------
// #1876 REWORK — the first attempt shipped a card with ZERO VISIBLE PIXELS.
//
// P0-1, REACHABILITY. The card was a static-flow sibling appended AFTER #root,
// with `margin:15vh auto 0`. The deployed shell's `<style id="expo-reset">`
// sets `html,body{height:100%}`, `body{overflow:hidden}` and
// `#root{display:flex;height:100%;flex:1}` — so an EMPTY #root still occupies
// the whole viewport and the sibling after it starts at 100vh + 15vh. Measured
// in Chromium on the real shell: card top 772px in a 664px viewport (iPhone
// 13), 0 visible pixels, and wheel / touch-drag / keyboard all scrolled 0px
// because `body{overflow:hidden}` propagates to the viewport. The user saw the
// same pure-white rectangle the bug is named after, while every DOM-presence
// assertion went green. The host is now `position:fixed` and centred on the
// viewport, so it cannot be pushed anywhere by the flow it sits in.
//
// P1-1, REMOVAL, AND WHY IT SHIPS IN THE SAME COMMIT. The emptiness test was
// sampled ONCE and the card was never removed, so a slow-but-successful boot
// committing at 1501 ms got a permanent "didn't load" card over a healthy app.
// That false positive was invisible for exactly the same reason the real card
// was invisible — so fixing placement ALONE would have converted an invisible
// false positive into a visible one, which is worse than the bug we started
// with. `watchBootRoot` therefore makes emptiness an INVARIANT that holds for
// as long as the card is on screen: a MutationObserver on #root (with a
// bounded `setInterval` fallback where MutationObserver is unavailable) removes
// the card the moment React commits, without touching #root and without
// reloading. It disconnects itself on removal.
//
// P2-1, THE LATCH BELONGS ON THE CARD, NOT ON THE ARM. `bootErrorArmed` was set
// once and never reset, so a SURVIVABLE failure (React alive, timer correctly
// renders nothing) permanently disabled the terminal UI for the rest of the
// document — a genuinely blank state later got no card at all. It is now
// `bootErrorPending`, cleared when the timer fires. The "one card, ever" latch
// is, and always was, `doc.getElementById(BOOT_ERROR_ID)` inside
// `paintBootError`; that is the contract, and it is the only one needed.
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
const CHUNK_RECOVERY_SCRIPT = `<script id="${CHUNK_RECOVERY_MARKER}">(function(){var KEY="${CHUNK_RECOVERY_KEY}";var LEGACY_KEY="${CHUNK_RECOVERY_MARKER}";var COOLDOWN_MS=${CHUNK_RECOVERY_COOLDOWN_MS};try{var boot=window.sessionStorage;var carried=boot.getItem(LEGACY_KEY);if(carried!==null){if(boot.getItem(KEY)===null){boot.setItem(KEY,carried)}boot.removeItem(LEGACY_KEY)}}catch(_m){/* storage blocked: nothing to migrate, and nothing to recover with */}function isChunkUrl(value){return typeof value==="string"&&value.indexOf("/_expo/static/js/web/")!==-1&&/\\.js(?:$|[?#])/.test(value)}var BOOT_ERROR_ID="mingla-boot-error";var BOOT_ERROR_DELAY_MS=1500;var BOOT_ROOT_POLL_MS=250;var bootErrorPending=false;var bootRootObserver=null;var bootRootPoll=null;function bootRootIsEmpty(doc){var root=doc.getElementById("root");return !root||!root.childNodes||root.childNodes.length===0}function stopBootRootWatch(){if(bootRootObserver){try{if(typeof bootRootObserver.disconnect==="function"){bootRootObserver.disconnect()}}catch(_sd){}bootRootObserver=null}if(bootRootPoll!==null){try{if(typeof window.clearInterval==="function"){window.clearInterval(bootRootPoll)}}catch(_sp){}bootRootPoll=null}}function clearBootError(doc){var host=doc.getElementById(BOOT_ERROR_ID);if(host){if(typeof host.remove==="function"){host.remove()}else if(host.parentNode&&typeof host.parentNode.removeChild==="function"){host.parentNode.removeChild(host)}}stopBootRootWatch()}function watchBootRoot(doc){stopBootRootWatch();var root=doc.getElementById("root");if(!root){return}var onChange=function(){try{if(!bootRootIsEmpty(doc)){clearBootError(doc)}}catch(_wc){}};var Watcher=window.MutationObserver;if(typeof Watcher==="function"){try{bootRootObserver=new Watcher(onChange);bootRootObserver.observe(root,{childList:true,subtree:true});return}catch(_wo){bootRootObserver=null}}if(typeof window.setInterval==="function"){bootRootPoll=window.setInterval(onChange,BOOT_ROOT_POLL_MS)}}function paintBootError(doc){if(!doc.body){return}if(doc.getElementById(BOOT_ERROR_ID)){return}if(!bootRootIsEmpty(doc)){return}var host=doc.createElement("div");host.id=BOOT_ERROR_ID;host.setAttribute("role","alert");host.style.cssText="box-sizing:border-box;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;width:calc(100% - 32px);max-width:22rem;max-height:calc(100% - 32px);overflow:auto;padding:24px;background:#ffffff;border-radius:12px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";var title=doc.createElement("h1");title.textContent="This page didn't finish loading";title.style.cssText="margin:0 0 8px;font-size:18px;line-height:24px;font-weight:600;color:#1f2430";var copy=doc.createElement("p");copy.textContent="Mingla just updated in the background. Reload and you'll be right back where you were.";copy.style.cssText="margin:0 0 20px;font-size:15px;line-height:22px;color:#4a5160";var button=doc.createElement("button");button.type="button";button.textContent="Reload";button.style.cssText="min-width:44px;min-height:44px;padding:0 24px;border:0;border-radius:8px;background:#eb7825;color:#ffffff;font-size:16px;line-height:44px;font-weight:600;cursor:pointer";button.onclick=function(){window.location.reload()};host.appendChild(title);host.appendChild(copy);host.appendChild(button);doc.body.appendChild(host);watchBootRoot(doc)}function armBootError(){if(bootErrorPending){return}var doc=window.document;if(!doc||typeof doc.createElement!=="function"||typeof doc.getElementById!=="function"){return}if(typeof window.setTimeout!=="function"){return}bootErrorPending=true;window.setTimeout(function(){bootErrorPending=false;try{if(doc.body){paintBootError(doc);return}if(typeof doc.addEventListener==="function"){doc.addEventListener("DOMContentLoaded",function(){try{paintBootError(doc)}catch(_d){}})}}catch(_t){}},BOOT_ERROR_DELAY_MS)}function recover(reason){try{var store=window.sessionStorage;var now=Date.now();var last=Number(store.getItem(KEY)||0);if(isFinite(last)&&now-last<COOLDOWN_MS){console.warn("[mobile-web] chunk recovery suppressed by the shared cooldown",reason);armBootError();return}store.setItem(KEY,String(now));console.warn("[mobile-web] stale chunk detected; reloading",reason);window.location.reload()}catch(_e){console.warn("[mobile-web] chunk recovery unavailable (sessionStorage blocked); not reloading",reason);armBootError()}}window.addEventListener("error",function(event){var target=event&&event.target;var src=target&&(target.src||target.href);if(isChunkUrl(src)){recover(src)}} ,true);window.addEventListener("unhandledrejection",function(event){var reason=event&&event.reason;var text=String(reason&&((reason.message||reason.name)||reason)||"");if(/Loading chunk|loadBundleAsync|ChunkLoadError|Importing a module script failed|Failed to fetch dynamically imported module/i.test(text)){recover(text)}});})();</script>`;

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
