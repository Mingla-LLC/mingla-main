#!/usr/bin/env node
/**
 * ORCH-1326 [links business tab reflects the live app], AMENDED BY ORCH-1381
 * [business-getapp-android-choice].
 * Invariant: I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE.
 *
 * The /links Business tab CTA targets `/business/download`. ORCH-1381 changed what
 * that route IS: it no longer REDIRECTS — it renders an explicit inline choice
 * ("Download the app": iOS → business App Store, Android → the LIVE business Play
 * listing; plus "Use on web"). The old redirect requirement and the blanket
 * "never a Play listing" ban are SUPERSEDED (the business Play listing went live
 * 2026-07-15 — COMMS-0101).
 *
 * Over mingla-marketing/app/business/download/page.tsx (comment-stripped) REQUIRE:
 *   (a) reads the request UA via headers() and resolves it with
 *       resolvePlatformFromUa (SSR-safe, UA-only).
 *   (b) delegates the destination decision to resolveBusinessAppTarget( — the
 *       consts now live in lib/business-app-target.ts; requiring them HERE would
 *       re-create the very triplication ORCH-1381 removed.
 *   (c) renders the choice as plain <a> anchors and branches on `canInstall`
 *       (desktop has no install action).
 *
 * Route BAN (the deliberate business differences + SSOT):
 *   - apps.apple.com / business.usemingla.com literals (must use the consts).
 *   - navigator / window (Server Component must be SSR-safe).
 *   - DownloadQr / AppStoreBadges / <QRCode (NO QR — the difference vs /download:
 *     business owners on desktop go straight to the web app).
 *   - <form / type="email" (no PII capture).
 *   - testflight (the beta link is retired).
 *   - \bPLAY_STORE_URL\b — the CONSUMER Play const. The business route must use
 *     BUSINESS_PLAY_STORE_URL via resolveBusinessAppTarget. NOTE the word
 *     boundaries: the pre-ORCH-1381 regex was UNANCHORED, so it substring-matched
 *     `BUSINESS_PLAY_STORE_URL` and failed any PR that added the business const.
 *     `\b` does not match between `_` and `P` (both word chars), so
 *     `\bPLAY_STORE_URL\b` correctly ignores BUSINESS_PLAY_STORE_URL while still
 *     catching a bare consumer PLAY_STORE_URL.
 *
 * G-b (adversarial): FAIL if the route carries the ORCH-1324 collapsed ternary
 * `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` — that is the
 * exact bug ORCH-1381 killed (it sends every Android owner to the web app).
 *
 * Over mingla-marketing/lib/links-config.ts (comment-stripped) REQUIRE:
 *   references LINKS_BUSINESS_DOWNLOAD_PATH AND the string '/business/download'
 *   AND `destination: 'business_download'` (the business tab is NOT wired back to
 *   the bare /business CTA — the app is live).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const ROUTE = "mingla-marketing/app/business/download/page.tsx";
const CONFIG = "mingla-marketing/lib/links-config.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROUTE_BANNED = [
  { re: /apps\.apple\.com/, why: "inlines a literal App Store URL — use BUSINESS_APP_STORE_URL from lib/store-links" },
  { re: /business\.usemingla\.com/, why: "inlines the literal business web URL — use BUSINESS_WEB_URL from lib/store-links" },
  { re: /\bnavigator\b/, why: "reads `navigator` in a Server Component (SSR-unsafe)" },
  { re: /\bwindow\b/, why: "reads `window` in a Server Component (SSR-unsafe)" },
  { re: /DownloadQr/, why: "imports DownloadQr — the business route has NO QR (owners on desktop go straight to the web app)" },
  { re: /AppStoreBadges/, why: "imports AppStoreBadges — the business route has NO badges/QR panel" },
  { re: /<QRCode/, why: "renders a <QRCode — the business route has NO QR" },
  { re: /<form/i, why: "renders a form on the business download route (no PII capture)" },
  { re: /type="email"/, why: "renders an email input on the business download route" },
  { re: /testflight/i, why: "contains a testflight token (the beta link is retired)" },
  // ORCH-1381 A1 — WORD-ANCHORED. The old unanchored /PLAY_STORE_URL/ substring-
  // matched BUSINESS_PLAY_STORE_URL and failed any PR adding the business const.
  { re: /\bPLAY_STORE_URL\b/, why: "references the CONSUMER PLAY_STORE_URL — the business route must use BUSINESS_PLAY_STORE_URL via resolveBusinessAppTarget" },
  // ORCH-1381 G-b — the collapsed ternary IS the bug (every Android owner → web).
  { re: /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/, why: "carries the ORCH-1324 collapsed ternary — sends every Android owner to the web app instead of the LIVE business Play listing (ORCH-1381 G-b)" },
];

function checkRoute(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // (a) server UA read + resolver.
  if (!/headers\(/.test(src)) {
    failures.push(`${ROUTE}: must read the request UA via headers().`);
  }
  if (!/resolvePlatformFromUa/.test(src)) {
    failures.push(`${ROUTE}: must resolve the platform with resolvePlatformFromUa (server, UA-only).`);
  }

  // (b) ORCH-1381 A3 — the decision is DELEGATED to the shared helper. The
  // BUSINESS_* consts deliberately no longer appear here: requiring them would
  // re-create the 5-call-site triplication ORCH-1381 removed.
  if (!/resolveBusinessAppTarget\(/.test(src)) {
    failures.push(
      `${ROUTE}: must resolve its destinations via resolveBusinessAppTarget( from ` +
        `lib/business-app-target — the platform→destination decision lives in exactly ` +
        `ONE module (ORCH-1381).`,
    );
  }

  // (c) ORCH-1381 A2 — the route RENDERS the choice; it no longer redirects.
  if (!/<a[\s>]/.test(src)) {
    failures.push(`${ROUTE}: must render the choice as plain <a> anchors (no redirect, no client JS).`);
  }
  // ORCH-1381 A4 — desktop has no install action, so the render must branch on it.
  if (!/canInstall/.test(src)) {
    failures.push(`${ROUTE}: must branch on target.canInstall — desktop has no install action (G-b).`);
  }

  // Route bans.
  for (const { re, why } of ROUTE_BANNED) {
    if (re.test(src)) failures.push(`${ROUTE}: ${why}.`);
  }
}

function checkConfig(rawSrc, failures) {
  const src = stripComments(rawSrc);

  if (!/LINKS_BUSINESS_DOWNLOAD_PATH/.test(src)) {
    failures.push(`${CONFIG}: must reference LINKS_BUSINESS_DOWNLOAD_PATH (the business device-smart path).`);
  }
  if (!/'\/business\/download'/.test(src)) {
    failures.push(`${CONFIG}: must define the '/business/download' path string.`);
  }
  if (!/destination: 'business_download'/.test(src)) {
    failures.push(
      `${CONFIG}: the business tab CTA must carry \`destination: 'business_download'\` — it ` +
        `must NOT be wired back to the bare /business CTA (the business app is live).`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const runRoute = (s) => { const f = []; checkRoute(s, f); return f; };
  const runConfig = (s) => { const f = []; checkConfig(s, f); return f; };

  // ORCH-1381 — the compliant route RENDERS the inline choice (no redirect).
  const goodRoute = `
import { headers } from 'next/headers'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
export const dynamic = 'force-dynamic'
export default async function BusinessDownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)
  const target = resolveBusinessAppTarget(platform)
  return (
    <main>
      {target.canInstall && target.installHref !== null ? (
        <a href={target.installHref}>{BUSINESS_APP_CHOICE_COPY.download}</a>
      ) : null}
      <a href={target.webHref}>{BUSINESS_APP_CHOICE_COPY.useWeb}</a>
      <p>{target.canInstall ? BUSINESS_APP_CHOICE_COPY.moreNote : BUSINESS_APP_CHOICE_COPY.desktopNote}</p>
    </main>
  )
}
`;
  if (runRoute(goodRoute).length !== 0) selfFailures.push("compliant route wrongly flagged: " + JSON.stringify(runRoute(goodRoute)));

  const goodConfig = `
export const LINKS_BUSINESS_DOWNLOAD_PATH = '/business/download'
export const LINKS_TABS = [
  { id: 'business', cta: { label: 'Get the app', href: LINKS_BUSINESS_DOWNLOAD_PATH, destination: 'business_download', intent: 'glass' } },
]
`;
  if (runConfig(goodConfig).length !== 0) selfFailures.push("compliant config wrongly flagged: " + JSON.stringify(runConfig(goodConfig)));

  // Route missing resolver → fire.
  const noResolver = goodRoute.replace(/resolvePlatformFromUa/g, "somethingElse");
  if (runRoute(noResolver).length === 0) selfFailures.push("route missing resolvePlatformFromUa not flagged");

  // Route inlines apps.apple.com literal → fire.
  const literal = goodRoute.replace("href={target.installHref}", "href=\"https://apps.apple.com/app/id6768737367\"");
  if (runRoute(literal).length === 0) selfFailures.push("route inline App Store literal not flagged");

  // Route reads window (SSR-unsafe) → fire.
  const win = goodRoute.replace("const platform = resolvePlatformFromUa(ua)", "const platform = window.foo");
  if (runRoute(win).length === 0) selfFailures.push("route window read not flagged");

  // Route imports DownloadQr → fire.
  const qr = goodRoute.replace(
    "import { headers } from 'next/headers'",
    "import { headers } from 'next/headers'\nimport { DownloadQr } from '@/components/marketing/download-qr'",
  );
  if (runRoute(qr).length === 0) selfFailures.push("route DownloadQr import not flagged");

  // ORCH-1381 — the route reverted to the collapsed ternary (android → web) → fire.
  const ternary = goodRoute.replace(
    "const target = resolveBusinessAppTarget(platform)",
    "const target = resolveBusinessAppTarget(platform)\n  const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL",
  );
  if (runRoute(ternary).length === 0) selfFailures.push("route ORCH-1324 collapsed ternary (android→web) not flagged");

  // ORCH-1381 — the route stopped delegating to the shared helper → fire.
  const noHelper = goodRoute.replace(/resolveBusinessAppTarget/g, "someLocalGuess");
  if (runRoute(noHelper).length === 0) selfFailures.push("route missing resolveBusinessAppTarget not flagged");

  // ORCH-1381 A1 — BUSINESS_PLAY_STORE_URL must NOT trip the consumer-Play ban.
  // (The pre-1381 unanchored /PLAY_STORE_URL/ substring-matched it and failed the PR.)
  const businessPlay = goodRoute.replace(
    "const target = resolveBusinessAppTarget(platform)",
    "const target = resolveBusinessAppTarget(platform) // BUSINESS_PLAY_STORE_URL rides inside the helper\n  const note = BUSINESS_PLAY_STORE_URL",
  );
  if (runRoute(businessPlay).length !== 0) {
    selfFailures.push("BUSINESS_PLAY_STORE_URL wrongly flagged by the consumer PLAY_STORE_URL ban (the \\b anchor is broken): " + JSON.stringify(runRoute(businessPlay)));
  }

  // …but the bare CONSUMER PLAY_STORE_URL still fires.
  const play = goodRoute.replace(
    "const target = resolveBusinessAppTarget(platform)",
    "const target = resolveBusinessAppTarget(platform)\n  const wrong = PLAY_STORE_URL",
  );
  if (runRoute(play).length === 0) selfFailures.push("bare consumer PLAY_STORE_URL not flagged");

  // Config missing '/business/download' → fire.
  const noPath = goodConfig.replace(/'\/business\/download'/g, "'/business'");
  if (runConfig(noPath).length === 0) selfFailures.push("config missing '/business/download' not flagged");

  // Config reverted to bare /business CTA (no business_download destination) → fire.
  const bareCta = goodConfig.replace("destination: 'business_download'", "destination: 'business'");
  if (runConfig(bareCta).length === 0) selfFailures.push("config reverted business_download destination not flagged");

  // A banned token inside a COMMENT must be stripped → compliant route still passes.
  const commented = goodRoute + "\n// note: no apps.apple.com literal / no testflight / no DownloadQr here\n";
  if (runRoute(commented).length !== 0) selfFailures.push("commented banned token wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1326 links-business-download-route self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1326 links-business-download-route self-test PASS (12/12 cases, ORCH-1381-amended).");
  process.exit(0);
}

// ---- Live mode
const failures = [];

const routeAbs = path.join(root, ROUTE);
if (!fs.existsSync(routeAbs)) {
  console.error(`ORCH-1326 FAIL — target not found at ${ROUTE} (business download route missing).`);
  process.exit(1);
}
checkRoute(fs.readFileSync(routeAbs, "utf8"), failures);

const configAbs = path.join(root, CONFIG);
if (!fs.existsSync(configAbs)) {
  console.error(`ORCH-1326 FAIL — target not found at ${CONFIG} (links config missing).`);
  process.exit(1);
}
checkConfig(fs.readFileSync(configAbs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1326 (I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE, ORCH-1381-amended)\n" +
      "FAIL — the /business/download route must READ the UA via headers()+\n" +
      "resolvePlatformFromUa, resolve its destinations through resolveBusinessAppTarget(\n" +
      "(the ONE decision module), and RENDER the inline choice as plain <a> anchors\n" +
      "branching on canInstall — SSR-safe, no redirect, no QR/badges/form, no consumer\n" +
      "PLAY_STORE_URL, and never the ORCH-1324 collapsed ternary; the /links business CTA\n" +
      "must target LINKS_BUSINESS_DOWNLOAD_PATH ('/business/download', destination\n" +
      "'business_download').\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1326 PASS (ORCH-1381-amended) — /business/download resolves the UA via\n" +
    "resolvePlatformFromUa, delegates to resolveBusinessAppTarget, and renders the inline\n" +
    "choice as plain <a> anchors branching on canInstall (iOS → business App Store,\n" +
    "Android → business Play, desktop → web only); SSR-safe, no redirect/QR/badges/form,\n" +
    "no consumer PLAY_STORE_URL, no collapsed ternary; the /links business CTA targets\n" +
    "'/business/download' (destination 'business_download').",
);
