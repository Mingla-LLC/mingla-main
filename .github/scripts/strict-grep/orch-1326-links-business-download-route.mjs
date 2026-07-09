#!/usr/bin/env node
/**
 * ORCH-1326 [links business tab reflects the live app].
 * Invariant: I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE.
 *
 * The /links Business tab CTA now targets a device-smart server route
 * `/business/download` (the business app is live on the App Store — ORCH-1324).
 * This gate pins BOTH sides of that:
 *
 * Over mingla-marketing/app/business/download/page.tsx (comment-stripped) REQUIRE:
 *   (a) reads the request UA via headers() and resolves it with
 *       resolvePlatformFromUa (SSR-safe, UA-only).
 *   (b) references BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL (the business
 *       store/web constants from lib/store-links — never hardcoded).
 *   (c) performs a redirect( call and branches on `platform ===` (device-driven).
 *
 * Route BAN (the deliberate business differences + SSOT):
 *   - apps.apple.com / business.usemingla.com literals (must use the consts).
 *   - navigator / window (Server Component must be SSR-safe).
 *   - DownloadQr / AppStoreBadges / <QRCode (NO QR — the difference vs /download:
 *     business owners on desktop go straight to the web app).
 *   - <form / type="email" (no PII capture).
 *   - testflight (the beta link is retired).
 *   - PLAY_STORE_URL (business Android → the web app, NEVER a Play listing).
 *
 * G-b (adversarial): the destination must be PLATFORM-DRIVEN. FAIL if
 * BUSINESS_WEB_URL is absent (non-iOS stranded / everyone → App Store) or the
 * route lacks `platform ===` (a single hardcoded destination).
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
  { re: /PLAY_STORE_URL/, why: "references PLAY_STORE_URL — business Android goes to the web app, never a Play listing" },
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

  // (b) both business constants present.
  const hasStore = /BUSINESS_APP_STORE_URL/.test(src);
  const hasWeb = /BUSINESS_WEB_URL/.test(src);
  if (!hasStore || !hasWeb) {
    failures.push(
      `${ROUTE}: must reference BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL ` +
        `(business store/web links from lib/store-links) — got store=${hasStore}, web=${hasWeb}.`,
    );
  }
  // G-b — BUSINESS_WEB_URL is the non-iOS destination; its absence strands
  // Android + desktop owners (everyone → the App Store).
  if (!hasWeb) {
    failures.push(
      `${ROUTE}: BUSINESS_WEB_URL is absent — non-iOS (Android/desktop) has nowhere ` +
        `to go; the destination must not collapse to everyone → the App Store (G-b).`,
    );
  }

  // (c) a redirect + a device-driven branch.
  if (!/redirect\(/.test(src)) {
    failures.push(`${ROUTE}: must perform a redirect( to the resolved destination.`);
  }
  if (!/platform ===/.test(src)) {
    failures.push(
      `${ROUTE}: does not branch on \`platform ===\` — the destination must be chosen ` +
        `from the DETECTED platform, not a single hardcode (G-b).`,
    );
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

  const goodRoute = `
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
export const dynamic = 'force-dynamic'
export default async function BusinessDownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)
  if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL)
  redirect(BUSINESS_WEB_URL)
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
  const literal = goodRoute.replace("redirect(BUSINESS_APP_STORE_URL)", "redirect('https://apps.apple.com/app/id6768737367')");
  if (runRoute(literal).length === 0) selfFailures.push("route inline App Store literal not flagged");

  // Route reads window (SSR-unsafe) → fire.
  const win = goodRoute.replace("const platform = resolvePlatformFromUa(ua)", "const platform = window.foo");
  if (runRoute(win).length === 0) selfFailures.push("route window read not flagged");

  // Route imports DownloadQr → fire.
  const qr = goodRoute.replace(
    "import { redirect } from 'next/navigation'",
    "import { redirect } from 'next/navigation'\nimport { DownloadQr } from '@/components/marketing/download-qr'",
  );
  if (runRoute(qr).length === 0) selfFailures.push("route DownloadQr import not flagged");

  // Route missing BUSINESS_WEB_URL (everyone → App Store) → fire.
  const noWeb = goodRoute.replace(/BUSINESS_WEB_URL/g, "BUSINESS_APP_STORE_URL");
  if (runRoute(noWeb).length === 0) selfFailures.push("route missing BUSINESS_WEB_URL not flagged");

  // Route references PLAY_STORE_URL → fire.
  const play = goodRoute.replace("redirect(BUSINESS_WEB_URL)", "if (platform === 'android') redirect(PLAY_STORE_URL)\n  redirect(BUSINESS_WEB_URL)");
  if (runRoute(play).length === 0) selfFailures.push("route PLAY_STORE_URL not flagged");

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
  console.log("ORCH-1326 links-business-download-route self-test PASS (11/11 cases).");
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
    "ORCH-1326 (I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE) FAIL — the\n" +
      "/business/download route must UA-redirect iOS → BUSINESS_APP_STORE_URL, else →\n" +
      "BUSINESS_WEB_URL (both from lib/store-links, never hardcoded), SSR-safe, with NO\n" +
      "QR/badges/form/Play; and the /links business CTA must target LINKS_BUSINESS_\n" +
      "DOWNLOAD_PATH ('/business/download', destination 'business_download').\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1326 PASS — /business/download resolves the UA via resolvePlatformFromUa and\n" +
    "redirects iOS → BUSINESS_APP_STORE_URL, else → BUSINESS_WEB_URL (shared consts),\n" +
    "SSR-safe, no QR/badges/form/Play; the /links business CTA targets\n" +
    "'/business/download' (destination 'business_download').",
);
