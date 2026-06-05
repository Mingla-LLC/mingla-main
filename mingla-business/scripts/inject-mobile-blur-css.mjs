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

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const HTML_PATH = "dist/index.html";
const MARKER = "mingla-mobile-web-no-blur";
const PREBOOT_MARKER = "mingla-mobile-web-home-preboot";
const STYLE_TAG =
  `<style id="${MARKER}">@media (max-width:767px){*,*::before,*::after{` +
  `-webkit-backdrop-filter:none !important;backdrop-filter:none !important}}</style>`;
const PREBOOT_SCRIPT = `<script id="${PREBOOT_MARKER}">(function(){try{var p=location.pathname;if(p!=="/"&&p!=="/index.html")return;var isPhone=matchMedia&&matchMedia("(max-width: 767px)").matches;if(!isPhone)return;var raw=localStorage.getItem("sb-gqnoajqerqhnvulmnyvv-auth-token");if(!raw)return;var session=JSON.parse(raw);if(session&&session.access_token){location.replace("/home");}}catch(_e){}})();</script>`;

try {
  if (!existsSync(HTML_PATH)) {
    console.warn(`[mobile-blur-fix] ${HTML_PATH} not found — skipping (no-op).`);
    process.exit(0);
  }
  let html = readFileSync(HTML_PATH, "utf8");
  if (html.includes(MARKER) && html.includes(PREBOOT_MARKER)) {
    console.log("[mobile-blur-fix] already present — skipping.");
    process.exit(0);
  }
  if (!html.includes("</head>")) {
    console.warn("[mobile-blur-fix] no </head> in dist/index.html — skipping.");
    process.exit(0);
  }
  const headInsert = `${html.includes(PREBOOT_MARKER) ? "" : PREBOOT_SCRIPT}${html.includes(MARKER) ? "" : STYLE_TAG}`;
  html = html.replace("</head>", `${headInsert}</head>`);
  writeFileSync(HTML_PATH, html);
  console.log("[mobile-blur-fix] injected mobile preboot + blur-kill into dist/index.html <head>.");
} catch (err) {
  console.warn(`[mobile-blur-fix] failed (non-fatal): ${err?.message ?? err}`);
}
process.exit(0);
