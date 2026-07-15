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
 * ORCH-1381 AMENDMENT: the BUSINESS branch no longer resolves BUSINESS_APP_STORE_URL
 * / BUSINESS_WEB_URL locally — it delegates to resolveBusinessAppTarget( (the single
 * decision module) and offers an explicit two-action choice. Those two consts were
 * therefore dropped from REQUIRED_CONSTS and replaced by a helper-delegation check.
 * The EXPLORER tab is untouched by ORCH-1381 and still resolves its own consts.
 *
 * Over mingla-marketing/components/marketing/links-experience.tsx
 * (comment-stripped) REQUIRE:
 *   1. imports detectClientPlatform (from @/lib/device-platform).
 *   2. references the EXPLORER store consts APP_STORE_URL + PLAY_STORE_URL
 *      (lib/store-links SSOT), AND delegates the business decision to
 *      resolveBusinessAppTarget( (ORCH-1381).
 *   3. the CTA is a real control: a `<button` AND `onClick={() => onCtaClick(`.
 *   4. opens the store client-side on the tap gesture via openExternal( from
 *      lib/open-external (so /links stays mounted).
 *      AMENDED BY ORCH-1381 ADDENDUM D-B: this check previously required the tokens
 *      `window.open(` + `window.location.assign(`. It was BLIND — the shipped code
 *      satisfied it while VIOLATING this gate's own invariant. window.open with a
 *      noopener/noreferrer feature string returns null EVEN ON SUCCESS, so the
 *      "popup-blocked" fallback fired on every tap and /links did NOT stay mounted:
 *      a tab opened AND the page navigated away. The fallback guard now lives in the
 *      module that owns it (orch-1381-open-external-no-double-nav.mjs); here we
 *      require DELEGATION and BAN inlining window.open.
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
// each const must be referenced in its own right.
//
// ORCH-1381 C1 — the BUSINESS_* consts were DROPPED from this list. The business
// tab no longer resolves them locally: it delegates to resolveBusinessAppTarget(
// (checked separately below), which is where the BUSINESS_* consts now live.
// Requiring them here would force the very triplication ORCH-1381 removed. The
// EXPLORER tab still resolves APP_STORE_URL / PLAY_STORE_URL locally and is out of
// ORCH-1381's scope, so those two stay REQUIRED.
const REQUIRED_CONSTS = [
  "\\bAPP_STORE_URL\\b",
  "\\bPLAY_STORE_URL\\b",
];

// Banned tokens — the soft-nav / hardcoded-store regression this ORCH kills.
const BANNED = [
  { re: /from\s+['"]next\/link['"]/, why: "imports next/link — the CTA must not soft-navigate" },
  { re: /<Link[\s/>]/, why: "renders a next/link <Link> element — the CTA must not soft-navigate" },
  { re: /<a\s+href="\/download"/, why: 'anchors <a href="/download"> into the external-redirect route' },
  { re: /<a\s+href="\/business\/download"/, why: 'anchors <a href="/business/download"> into the external-redirect route' },
  { re: /apps\.apple\.com/, why: "hardcodes an apps.apple.com store literal (use the store-links consts)" },
  { re: /play\.google\.com/, why: "hardcodes a play.google.com store literal (use the store-links consts)" },
  // ORCH-1381 ADDENDUM D-B — the double-navigation teeth.
  { re: /window\.open\(/, why: "inlines window.open — must delegate to openExternal( from lib/open-external (ORCH-1381 ADDENDUM D-B)" },
  // The half-fix trap: 'noreferrer' ALONE also nulls the return.
  { re: /\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/, why: "noopener/noreferrer makes window.open return null even on success → the fallback always fires → /links does NOT stay mounted, violating this gate's own invariant (ORCH-1381 ADDENDUM D-B)" },
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

  // 2. the EXPLORER store consts referenced (store-links SSOT).
  for (const token of REQUIRED_CONSTS) {
    if (!new RegExp(token).test(src)) {
      failures.push(
        `${TARGET}: must reference the store-links const ${token.replace(/\\b/g, "")} ` +
          `(the explorer tab resolves APP_STORE_URL / PLAY_STORE_URL locally).`,
      );
    }
  }

  // 2b. ORCH-1381 C2 — the BUSINESS branch must DELEGATE its decision to the one
  // shared module rather than re-deriving a destination locally.
  if (!/resolveBusinessAppTarget\(/.test(src)) {
    failures.push(
      `${TARGET}: the business branch must resolve via resolveBusinessAppTarget( from ` +
        `lib/business-app-target — the platform→destination decision lives in exactly ONE ` +
        `module (ORCH-1381), never re-derived here.`,
    );
  }

  // 3. the CTA is a real, keyboard-activatable control bound to onCtaClick.
  if (!/<button/.test(src)) {
    failures.push(`${TARGET}: the CTA must be a real <button> (focusable, keyboard-activatable) — not a <Link>/<a>.`);
  }
  if (!/onClick=\{\(\) => onCtaClick\(/.test(src)) {
    failures.push(`${TARGET}: the CTA <button> must bind onClick={() => onCtaClick(…)} (the device-aware tap action).`);
  }

  // 4. ORCH-1381 ADDENDUM D-B — /links still must open on the tap gesture, but via
  // the ONE owner (which is where the popup-block fallback is now guarded).
  if (!/openExternal\(/.test(src)) {
    failures.push(
      `${TARGET}: must open the destination via openExternal( from lib/open-external on ` +
        `the tap gesture (so /links stays mounted) — the popup-block decision lives in ` +
        `ONE module.`,
    );
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

  // ORCH-1381 — the business branch delegates to the shared decision helper and
  // offers two actions; the explorer branch is unchanged.
  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
import { openExternal } from '@/lib/open-external'
const onCtaClick = (tab, action) => {
  const platform = detectClientPlatform()
  if (tab.id === 'business') {
    const target = resolveBusinessAppTarget(platform)
    const useWeb = action === 'use_web' || target.installHref === null
    const dest = useWeb ? target.webHref : target.installHref
    if (dest === null) return
    captureMarketing('links_page_cta_clicked', { tab: tab.id, destination: tab.cta.destination, action: useWeb ? 'use_web' : 'download', platform, store: useWeb ? 'business_web' : target.installStore })
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

  // Missing an EXPLORER const (PLAY_STORE_URL) → fire.
  const missingConst = good.replace(/\bPLAY_STORE_URL\b/g, "APP_STORE_URL");
  if (run(missingConst).length === 0) selfFailures.push("missing PLAY_STORE_URL const not flagged");

  // ORCH-1381 — the business branch stopped delegating to the shared helper → fire.
  const noHelper = good.replace(/resolveBusinessAppTarget/g, "someLocalGuess");
  if (run(noHelper).length === 0) selfFailures.push("business branch missing resolveBusinessAppTarget not flagged");

  // Re-added next/link import + <Link> element → fire.
  const softNav = good +
    "\nimport Link from 'next/link'\nconst extra = <Link href=\"/x\">y</Link>\n";
  if (run(softNav).length === 0) selfFailures.push("re-added next/link + <Link> not flagged");

  // Hardcoded store literal → fire.
  const hardcoded = good + "\nconst x = 'https://apps.apple.com/app/id6760440898'\n";
  if (run(hardcoded).length === 0) selfFailures.push("hardcoded apps.apple.com literal not flagged");

  // ORCH-1381 ADDENDUM D-B — stopped delegating to openExternal( → fire.
  // (Replaces the old "missing window.location.assign fallback" case: that guard now
  // lives in orch-1381-open-external-no-double-nav.mjs, on the module that owns it.)
  const noDelegate = good.replace(/openExternal\(/g, "someLocalOpen(");
  if (run(noDelegate).length === 0) selfFailures.push("missing openExternal( delegation not flagged");

  // ORCH-1381 ADDENDUM D-B — re-inlined the SHIPPED double-nav bug → fire.
  const inlinedBug = good.replace(
    "import { openExternal } from '@/lib/open-external'",
    "const openExternal = (dest) => {\n  const win = window.open(dest, '_blank', 'noopener,noreferrer')\n  if (!win) window.location.assign(dest)\n}",
  );
  if (run(inlinedBug).length === 0) selfFailures.push("re-inlined window.open(…,'noopener,noreferrer') double-nav bug not flagged");

  // ORCH-1381 ADDENDUM D-B — THE HALF-FIX TRAP: 'noreferrer' alone still returns
  // null → identical bug → must fire.
  const halfFix = good.replace(
    "import { openExternal } from '@/lib/open-external'",
    "const openExternal = (dest) => {\n  const win = window.open(dest, '_blank', 'noreferrer')\n  if (win) { win.opener = null } else { window.location.assign(dest) }\n}",
  );
  if (run(halfFix).length === 0) selfFailures.push("HALF-FIX TRAP ('noreferrer' only, still returns null) not flagged");

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
  console.log("ORCH-1328 links-cta-opens-store-clientside self-test PASS (13/13 cases, ORCH-1381-ADDENDUM-amended).");
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
  "ORCH-1328 PASS (ORCH-1381-amended) — the /links CTA is a device-aware <button> that\n" +
    "opens the store/web client-side (window.open + location.assign fallback) via\n" +
    "detectClientPlatform: the explorer tab resolves APP_STORE_URL / PLAY_STORE_URL from the\n" +
    "store-links SSOT and the business tab delegates to resolveBusinessAppTarget; it fires\n" +
    "links_page_cta_clicked and never soft-navigates into the /download|/business/download\n" +
    "route.",
);
