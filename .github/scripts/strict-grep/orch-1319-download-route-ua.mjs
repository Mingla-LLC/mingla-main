#!/usr/bin/env node
/**
 * ORCH-1319 [Smart /download route] — G-2.
 * Invariant: I-1319-DOWNLOAD-ROUTE-UA-REDIRECT.
 *
 * Over mingla-marketing/app/download/page.tsx (comment-stripped):
 *   (a) reads the request UA via headers() and resolves it with
 *       resolvePlatformFromUa.
 *   (b) references BOTH APP_STORE_URL and PLAY_STORE_URL (from lib/store-links)
 *       and performs a redirect( call.
 *   (c) renders the QR (DownloadQr / download-qr) AND AppStoreBadges on the
 *       desktop branch.
 *
 * G-2b (adversarial):
 *   - the redirect targets must be the SHARED constants, not inline store-URL
 *     literals (no `apps.apple.com` / `play.google.com` string in the page).
 *   - SSR-safe: the page must NOT read `navigator` / `window`.
 *   - no PII/lead form: no `<form` / `explorer-app` / `type="email"` / testflight.
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const ROUTE = "mingla-marketing/app/download/page.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const BANNED = [
  { re: /apps\.apple\.com/, why: "inlines a literal App Store URL — use APP_STORE_URL from lib/store-links (G-2b)" },
  { re: /play\.google\.com/, why: "inlines a literal Play URL — use PLAY_STORE_URL from lib/store-links (G-2b)" },
  { re: /\bnavigator\b/, why: "reads `navigator` in a Server Component (SSR-unsafe) (G-2b)" },
  { re: /\bwindow\b/, why: "reads `window` in a Server Component (SSR-unsafe) (G-2b)" },
  { re: /<form/i, why: "renders a form on the download route (no PII capture) (G-2b)" },
  { re: /type="email"/, why: "renders an email input on the download route (G-2b)" },
  { re: /explorer-app/, why: "references the deleted explorer-app lead path (G-2b)" },
  { re: /testflight/i, why: "contains a testflight token (the beta link is retired)" },
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

  // (b) both store constants + a redirect.
  if (!/APP_STORE_URL/.test(src) || !/PLAY_STORE_URL/.test(src)) {
    failures.push(`${ROUTE}: must reference BOTH APP_STORE_URL and PLAY_STORE_URL (from lib/store-links).`);
  }
  if (!/redirect\(/.test(src)) {
    failures.push(`${ROUTE}: must perform a redirect( for the iOS/Android UA branches.`);
  }

  // (c) desktop page RENDERS QR + badges (JSX mount, not just an import).
  if (!/<DownloadQr/.test(src)) {
    failures.push(`${ROUTE}: the desktop branch must render <DownloadQr /> (not just import it).`);
  }
  if (!/<AppStoreBadges/.test(src)) {
    failures.push(`${ROUTE}: the desktop branch must render <AppStoreBadges /> (both live badges).`);
  }

  // G-2b adversarial bans.
  for (const { re, why } of BANNED) {
    if (re.test(src)) failures.push(`${ROUTE}: ${why}.`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkRoute(s, f); return f; };

  const good = `
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppStoreBadges } from '@/components/ui/app-store-badges'
import { DownloadQr } from '@/components/marketing/download-qr'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'
export const dynamic = 'force-dynamic'
export default async function DownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)
  if (platform === 'ios') redirect(APP_STORE_URL)
  if (platform === 'android') redirect(PLAY_STORE_URL)
  return (<main><DownloadQr size={220} /><AppStoreBadges size="lg" /></main>)
}
`;
  if (run(good).length !== 0) selfFailures.push("compliant route wrongly flagged");

  // Inline store URL literal → fire.
  const literal = good.replace("redirect(APP_STORE_URL)", "redirect('https://apps.apple.com/app/id6760440898')");
  if (run(literal).length === 0) selfFailures.push("inline App Store literal not flagged");

  // Missing resolver → fire.
  const noResolver = good.replace(/resolvePlatformFromUa/g, "somethingElse");
  if (run(noResolver).length === 0) selfFailures.push("missing resolvePlatformFromUa not flagged");

  // window read (SSR-unsafe) → fire.
  const win = good.replace("const platform = resolvePlatformFromUa(ua)", "const platform = window.foo");
  if (run(win).length === 0) selfFailures.push("window read not flagged");

  // Missing QR → fire.
  const noQr = good.replace(/<DownloadQr size=\{220\} \/>/g, "");
  if (run(noQr).length === 0) selfFailures.push("missing DownloadQr not flagged");

  // A form → fire.
  const form = good.replace("<AppStoreBadges size=\"lg\" />", "<AppStoreBadges size=\"lg\" /><form></form>");
  if (run(form).length === 0) selfFailures.push("form on download route not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1319 G-2 download-route-ua self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1319 G-2 download-route-ua self-test PASS (6/6 cases).");
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, ROUTE);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1319 G-2 FAIL — target not found at ${ROUTE} (route missing).`);
  process.exit(1);
}
const failures = [];
checkRoute(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1319 G-2 (I-1319-DOWNLOAD-ROUTE-UA-REDIRECT) FAIL — /download must UA-redirect\n" +
      "iOS/Android to the live store constants and render the QR+badges page otherwise,\n" +
      "SSR-safe with no inline store literals / navigator-window / form.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1319 G-2 PASS — /download resolves UA via resolvePlatformFromUa, redirects to\n" +
    "the shared store constants, renders QR+badges on desktop, SSR-safe, no form.",
);
