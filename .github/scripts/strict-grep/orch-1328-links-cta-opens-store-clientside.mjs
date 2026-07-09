#!/usr/bin/env node
/**
 * ORCH-1328 [links-cta-soft-nav-blank-page].
 * Invariant: I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE (DRAFT until CLOSE).
 *
 * The usemingla.com/links per-tab CTA must open the store / web app DIRECTLY on
 * the tap gesture (client-side, device-aware, from the store-links SSOT) so
 * /links stays mounted — it must NEVER again be a Next `<Link>` soft-navigation
 * into the /download or /business/download external-redirect route, which
 * stranded the tab on a blank (Explorer) / footer-only (Business) route shell
 * (INVESTIGATION_ORCH-1328).
 *
 * Over mingla-marketing/components/marketing/links-experience.tsx
 * (comment-stripped) REQUIRE:
 *   1. imports detectClientPlatform (from @/lib/device-platform).
 *   2. references ALL FOUR store consts: APP_STORE_URL, PLAY_STORE_URL,
 *      BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL (lib/store-links SSOT).
 *   3. the CTA is a real control: a `<button` AND `onClick={() => onCtaClick(`.
 *   4. opens the store client-side: `window.open(` present AND the
 *      `window.location.assign(` popup-block fallback present (no silent failure).
 *   5. fires `links_page_cta_clicked`.
 *   6. device-driven: branches on `platform ===` (not a single hardcode).
 *
 * BAN (the exact regression this ORCH kills):
 *   - a `next/link` import AND the `<Link` JSX element — the CTA must never
 *     soft-navigate again (this file needs no next/link).
 *   - `<a href="/download"` / `<a href="/business/download"` — no anchor
 *     navigation into the external-redirect routes.
 *   - hardcoded store literals: `apps.apple.com`, `play.google.com` (URLs only
 *     via the store-links consts).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a banned
 * token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET = "mingla-marketing/components/marketing/links-experience.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Word-boundary anchored so `\bAPP_STORE_URL\b` does NOT match inside
// `BUSINESS_APP_STORE_URL` (preceded by `_`, a word char → no boundary), i.e.
// each of the four consts must be referenced in its own right.
const REQUIRED_CONSTS = [
  "\\bAPP_STORE_URL\\b",
  "\\bPLAY_STORE_URL\\b",
  "\\bBUSINESS_APP_STORE_URL\\b",
  "\\bBUSINESS_WEB_URL\\b",
];

// Banned tokens — the soft-nav / hardcoded-store regression this ORCH kills.
const BANNED = [
  { re: /from\s+['"]next\/link['"]/, why: "imports next/link — the CTA must not soft-navigate" },
  { re: /<Link[\s/>]/, why: "renders a next/link <Link> element — the CTA must not soft-navigate" },
  { re: /<a\s+href="\/download"/, why: 'anchors <a href="/download"> into the external-redirect route' },
  { re: /<a\s+href="\/business\/download"/, why: 'anchors <a href="/business/download"> into the external-redirect route' },
  { re: /apps\.apple\.com/, why: "hardcodes an apps.apple.com store literal (use the store-links consts)" },
  { re: /play\.google\.com/, why: "hardcodes a play.google.com store literal (use the store-links consts)" },
];

function checkCta(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // 1. device detection imported / called.
  if (!/detectClientPlatform/.test(src)) {
    failures.push(
      `${TARGET}: the CTA handler must call detectClientPlatform() — the store ` +
        `choice must be device-driven.`,
    );
  }

  // 2. all four live store consts referenced (store-links SSOT).
  for (const token of REQUIRED_CONSTS) {
    if (!new RegExp(token).test(src)) {
      failures.push(
        `${TARGET}: must reference the store-links const ${token.replace(/\\b/g, "")} ` +
          `(all four of APP_STORE_URL / PLAY_STORE_URL / BUSINESS_APP_STORE_URL / ` +
          `BUSINESS_WEB_URL are required).`,
      );
    }
  }

  // 3. the CTA is a real, keyboard-activatable control bound to onCtaClick.
  if (!/<button/.test(src)) {
    failures.push(`${TARGET}: the CTA must be a real <button> (focusable, keyboard-activatable) — not a <Link>/<a>.`);
  }
  if (!/onClick=\{\(\) => onCtaClick\(/.test(src)) {
    failures.push(`${TARGET}: the CTA <button> must bind onClick={() => onCtaClick(…)} (the device-aware tap action).`);
  }

  // 4. opens the store client-side with the popup-block fallback.
  if (!/window\.open\(/.test(src)) {
    failures.push(`${TARGET}: must open the destination via window.open( on the tap gesture (so /links stays mounted).`);
  }
  if (!/window\.location\.assign\(/.test(src)) {
    failures.push(`${TARGET}: missing the window.location.assign( popup-blocked fallback (no silent failure).`);
  }

  // 5. analytics preserved.
  if (!/links_page_cta_clicked/.test(src)) {
    failures.push(`${TARGET}: missing the links_page_cta_clicked capture — the tap analytics must not be silently dropped.`);
  }

  // 6. store choice branches on the resolved platform.
  if (!/platform ===/.test(src)) {
    failures.push(
      `${TARGET}: the handler does not branch on \`platform ===\` — the store must be ` +
        `chosen from the DETECTED platform, not a single hardcoded branch.`,
    );
  }

  // BAN — no soft-nav / hardcoded store.
  for (const { re, why } of BANNED) {
    if (re.test(src)) {
      failures.push(`${TARGET}: ${why} (banned by ORCH-1328).`);
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkCta(s, f); return f; };

  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { APP_STORE_URL, PLAY_STORE_URL, BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
const openExternal = (dest) => {
  const win = window.open(dest, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(dest)
}
const onCtaClick = (tab) => {
  const platform = detectClientPlatform()
  if (tab.id === 'business') {
    const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL
    captureMarketing('links_page_cta_clicked', { tab: tab.id, destination: tab.cta.destination, platform, store: platform === 'ios' ? 'app_store' : 'business_web' })
    openExternal(dest)
    return
  }
  if (platform === 'ios' || platform === 'android') {
    const store = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL
    captureMarketing('links_page_cta_clicked', { tab: tab.id, destination: tab.cta.destination, platform, store: platform === 'ios' ? 'app_store' : 'play' })
    openExternal(store)
    return
  }
  captureMarketing('links_page_cta_clicked', { tab: tab.id, destination: tab.cta.destination, platform: 'other', store: 'qr_page' })
  openExternal(tab.cta.href)
}
<button type="button" onClick={() => onCtaClick(activeTab)} className={cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])}>
  {activeTab.cta.label}
</button>
`;
  if (run(good).length !== 0) selfFailures.push("compliant CTA wrongly flagged: " + JSON.stringify(run(good)));

  // Missing detectClientPlatform → fire.
  const noDetect = good
    .replace("const platform = detectClientPlatform()", "const platform = 'ios'")
    .replace("import { detectClientPlatform } from '@/lib/device-platform'", "");
  if (run(noDetect).length === 0) selfFailures.push("missing detectClientPlatform not flagged");

  // Missing one of the four consts (BUSINESS_WEB_URL) → fire.
  const missingConst = good.replace(/BUSINESS_WEB_URL/g, "BUSINESS_APP_STORE_URL");
  if (run(missingConst).length === 0) selfFailures.push("missing BUSINESS_WEB_URL const not flagged");

  // Re-added next/link import + <Link> element → fire.
  const softNav = good +
    "\nimport Link from 'next/link'\nconst extra = <Link href=\"/x\">y</Link>\n";
  if (run(softNav).length === 0) selfFailures.push("re-added next/link + <Link> not flagged");

  // Hardcoded store literal → fire.
  const hardcoded = good + "\nconst x = 'https://apps.apple.com/app/id6760440898'\n";
  if (run(hardcoded).length === 0) selfFailures.push("hardcoded apps.apple.com literal not flagged");

  // Missing window.location.assign fallback → fire.
  const noFallback = good.replace("if (!win) window.location.assign(dest)", "");
  if (run(noFallback).length === 0) selfFailures.push("missing window.location.assign fallback not flagged");

  // No `platform ===` (device branch removed) → fire.
  const noBranch = good.replace(/platform ===/g, "platform ==");
  if (run(noBranch).length === 0) selfFailures.push("missing `platform ===` branch not flagged");

  // <a href="/download"> anchor into the redirect route → fire.
  const anchorDownload = good + "\nconst y = <a href=\"/download\">z</a>\n";
  if (run(anchorDownload).length === 0) selfFailures.push('<a href="/download"> not flagged');

  // The CTA reverted to a non-button (no <button) → fire.
  const noButton = good.replace(/<button/g, "<div");
  if (run(noButton).length === 0) selfFailures.push("missing <button (CTA no longer a real control) not flagged");

  // A banned token inside a COMMENT must be stripped → compliant still passes.
  const commented = good +
    "\n// legacy note: no more next/link, <Link>, apps.apple.com or play.google.com here\n" +
    "/* the old <a href=\"/download\"> soft-nav is gone */\n";
  if (run(commented).length !== 0) selfFailures.push("commented banned tokens wrongly flagged (comment-strip broken): " + JSON.stringify(run(commented)));

  if (selfFailures.length) {
    console.error("ORCH-1328 links-cta-opens-store-clientside self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1328 links-cta-opens-store-clientside self-test PASS (10/10 cases).");
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, TARGET);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1328 FAIL — target not found at ${TARGET} (gate path out of sync).`);
  process.exit(1);
}
const failures = [];
checkCta(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1328 (I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE) FAIL — the /links\n" +
      "CTA must open the store/web app DIRECTLY on the tap (device-aware window.open +\n" +
      "location.assign fallback, store-links consts) so /links stays mounted, and it must\n" +
      "NEVER soft-navigate into the /download|/business/download external-redirect route.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1328 PASS — the /links CTA is a device-aware <button> that opens the store/web\n" +
    "client-side (window.open + location.assign fallback, all four store-links consts via\n" +
    "detectClientPlatform), fires links_page_cta_clicked, and never soft-navigates into the\n" +
    "/download|/business/download external-redirect route.",
);
