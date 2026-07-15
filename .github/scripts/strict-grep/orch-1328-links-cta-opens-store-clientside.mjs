#!/usr/bin/env node
/**
 * ORCH-1328 [links-cta-soft-nav-blank-page].
 * Invariant: I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE (DRAFT until CLOSE).
 *
 * ORCH-1382 AMENDMENT (three checks). The INVARIANT is unchanged — the CTA opens the
 * destination on the tap and /links stays mounted — but the MECHANISM changed, so the
 * checks that pinned the old mechanism were re-pointed:
 *   1. REQUIRED_CONSTS: APP_STORE_URL/PLAY_STORE_URL -> resolveExplorerAppTarget /
 *      resolveBusinessAppTarget. The explorer CTA now resolves an ATTRIBUTED OneLink
 *      through a decision module (the ORCH-1381 pattern, extended to explorer), so
 *      requiring the raw consts would FAIL the correct implementation and force back
 *      the triplication both ORCHs removed.
 *   2. `/<button/` -> a CTA-BOUND anchor check. The old token was DECORATIVE: it
 *      matched the TABLIST's `<button role="tab">` and therefore passed
 *      unconditionally, forever, having never once tested the CTA (ORCH-1382 §0.4 —
 *      the FOURTH decorative guard found in this repo). Now bound to the CTA's own
 *      `<a href={…installHref|webHref…}>` + target + rel.
 *   3. `onCtaClick(` -> `onCtaTrack(`. The anchor navigates; the handler only fires
 *      analytics, so the capture must be pinned separately or it can be dropped.
 * The `apps.apple.com` / `play.google.com` BANS stay and are now MORE meaningful: a
 * store literal on /links means someone bypassed the OneLink and killed attribution.
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
// ORCH-1382 C1 — the EXPLORER consts were DROPPED from this list too. The explorer
// CTA now resolves the attributed OneLink via resolveExplorerAppTarget( (the same
// decision-module pattern ORCH-1381 established for business, extended to explorer:
// the `platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL` ternary was copy-pasted
// across glass-nav AND links-experience — the identical triplication bug class).
// Requiring APP_STORE_URL/PLAY_STORE_URL here would FAIL the correct implementation
// and force back the very duplication both ORCHs removed — a gate must never mandate
// a worse implementation. What is required now is DELEGATION to both helpers.
const REQUIRED_CONSTS = [
  "\\bresolveExplorerAppTarget\\b",
  "\\bresolveBusinessAppTarget\\b",
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

  // 2. BOTH decision helpers delegated to (ORCH-1382).
  for (const token of REQUIRED_CONSTS) {
    if (!new RegExp(token).test(src)) {
      failures.push(
        `${TARGET}: must resolve via ${token.replace(/\\b/g, "")}( — the ` +
          `platform→destination decision lives in exactly ONE module per surface ` +
          `(ORCH-1381 for business, ORCH-1382 for explorer), never re-derived here.`,
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

  // 3. ORCH-1382 — DECORATIVE-CHECK REPAIR (the fourth in this repo).
  //
  // WAS: `if (!/<button/.test(src))`. That check was DECORATIVE and had NEVER tested
  // the CTA: links-experience.tsx renders its TABLIST with `<button role="tab">`, so
  // the token was satisfied UNCONDITIONALLY, forever, regardless of what the CTA was.
  // Proven by execution at SPEC time — a file whose CTA is a plain <div> (dead for
  // keyboard) but which still has tab buttons PASSED it.
  //
  // The underlying property is real and worth keeping — "the CTA is a real,
  // keyboard-activatable control" — so it is RE-EXPRESSED to bind to the CTA itself.
  // After ORCH-1382 the store/web CTA is a real <a href={…}> (an anchor is natively
  // keyboard-activatable and, unlike window.open, actually works inside the
  // Instagram/TikTok in-app webviews that dominate /links traffic).
  const CTA_ANCHOR = /<a\s+[^>]*href=\{[^}]*(?:installHref|oneLinkHref|webHref)[^}]*\}/;
  if (!CTA_ANCHOR.test(src)) {
    failures.push(
      `${TARGET}: the store/web CTA must be a real <a href={…installHref|webHref…}> anchor — ` +
        `a real link survives in-app webviews (where window.open is routinely blocked), ` +
        `restores long-press/middle-click/copy-link + screen-reader link semantics, and is ` +
        `natively keyboard-activatable. (This check REPLACES a decorative /<button/ token ` +
        `check that only ever matched the TABLIST buttons and could never fail — ORCH-1382 §0.4.)`,
    );
  }
  if (!/target="_blank"/.test(src)) {
    failures.push(
      `${TARGET}: the CTA anchor must carry target="_blank" — /links must stay mounted ` +
        `(ORCH-1328's own invariant) and a same-tab navigation races the analytics flush.`,
    );
  }
  // SECURITY — rel="noopener" on an ANCHOR is REQUIRED and is NOT the ORCH-1381
  // window.open pathology. That ban is scoped to `.open(` FEATURE STRINGS, where
  // either token makes open() return null even on success. On an <a>, rel="noopener"
  // has no such behaviour and is mandatory anti-reverse-tabnabbing. An implementor
  // "complying" with ORCH-1381 by stripping it would ship a real security regression.
  if (!/rel="noopener/.test(src)) {
    failures.push(
      `${TARGET}: the CTA anchor must carry rel="noopener" — reverse-tabnabbing. NOTE: the ` +
        `ORCH-1381 noopener BAN is scoped to window.open FEATURE STRINGS only; on an <a> ` +
        `element rel="noopener" is MANDATORY, not forbidden.`,
    );
  }
  // 3b. ORCH-1382 — the store path no longer routes through onCtaClick (the anchor
  // navigates); the ANALYTICS call does. Without this, a correct-looking anchor could
  // silently drop the tap capture.
  if (!/onClick=\{\(\) => onCtaTrack\(/.test(src)) {
    failures.push(`${TARGET}: the CTA must fire onCtaTrack(…) on click — the tap analytics must not be silently dropped when the anchor navigates.`);
  }

  // 4. ORCH-1381 ADDENDUM D-B / ORCH-1382 — openExternal( survives here for exactly
  // ONE genuine non-store destination: the Explorer DESKTOP /download QR page (a
  // page, not a store hand-off). Every STORE/web destination is now an anchor.
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
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
import { resolveExplorerAppTarget } from '@/lib/explorer-app-target'
import { linksAttribution } from '@/lib/links-src'
import { openExternal } from '@/lib/open-external'
const businessTarget = resolveBusinessAppTarget(platform, linksAttribution(src, 'business_bio'))
const explorerTarget = resolveExplorerAppTarget(platform, linksAttribution(src, 'explorer_bio'))
const onCtaTrack = (tab, action) => {
  const platform = detectClientPlatform()
  if (tab.id === 'business') {
    const target = resolveBusinessAppTarget(platform, linksAttribution(src, 'business_bio'))
    const useWeb = action === 'use_web' || target.installHref === null
    captureMarketing('links_page_cta_clicked', { tab: tab.id, action: useWeb ? 'use_web' : 'download', platform, store: useWeb ? 'business_web' : target.installStore, src })
    return
  }
  if (platform === 'ios' || platform === 'android') {
    const target = resolveExplorerAppTarget(platform, linksAttribution(src, 'explorer_bio'))
    captureMarketing('links_page_cta_clicked', { tab: tab.id, platform, store: target.installStore, src })
    return
  }
  captureMarketing('links_page_cta_clicked', { tab: tab.id, platform: 'other', store: 'qr_page', src })
}
const onCtaDesktop = (tab) => { onCtaTrack(tab); openExternal(tab.cta.href) }
const tabs = LINKS_TABS.map((tab) => (<button role="tab" onClick={() => selectTab(tab.id)}>{tab.label}</button>))
const bizCta = (
  <a href={businessTarget.installHref} target="_blank" rel="noopener" onClick={() => onCtaTrack(activeTab, 'download')} className={cn(CTA_BASE, CTA_INTENT.primary)}>
    {BUSINESS_APP_CHOICE_COPY.download}
  </a>
)
const webCta = (
  <a href={businessTarget.webHref} target="_blank" rel="noopener" onClick={() => onCtaTrack(activeTab, 'use_web')} className={cn(CTA_BASE, CTA_INTENT.glass)}>
    {BUSINESS_APP_CHOICE_COPY.useWeb}
  </a>
)
const explorerCta = (
  <a href={explorerTarget.installHref} target="_blank" rel="noopener" onClick={() => onCtaTrack(activeTab)} className={cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])}>
    {activeTab.cta.label}
  </a>
)
const desktopCta = (<button type="button" onClick={() => onCtaDesktop(activeTab)}>{activeTab.cta.label}</button>)
`;
  if (run(good).length !== 0) selfFailures.push("compliant CTA wrongly flagged: " + JSON.stringify(run(good)));

  // Missing detectClientPlatform → fire.
  const noDetect = good
    .replace("const platform = detectClientPlatform()", "const platform = 'ios'")
    .replace("import { detectClientPlatform } from '@/lib/device-platform'", "");
  if (run(noDetect).length === 0) selfFailures.push("missing detectClientPlatform not flagged");

  // ORCH-1382 — the EXPLORER branch stopped delegating to its helper → fire.
  const noExplorerHelper = good.replace(/resolveExplorerAppTarget/g, "someLocalGuess");
  if (run(noExplorerHelper).length === 0) selfFailures.push("explorer branch missing resolveExplorerAppTarget not flagged");

  // ORCH-1382 — re-introducing a raw store const means the OneLink was bypassed and
  // attribution is dead → the hardcoded-literal BAN must fire.
  const reAddedConst = good + "\nconst store = platform === 'ios' ? 'https://apps.apple.com/app/id6760440898' : PLAY_STORE_URL\n";
  if (run(reAddedConst).length === 0) selfFailures.push("re-introduced raw store literal not flagged");

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

  // ── ORCH-1382 §0.4 — THE DECORATIVE-CHECK REPAIR, PROVEN ────────────────────
  // THE case that proves the old /<button/ check is genuinely repaired. This file's
  // CTA is a plain <div> (dead for keyboard, no href) but it STILL has the tablist
  // <button role="tab"> elements. Under the OLD check this PASSED unconditionally.
  // It must now FAIL.
  const ctaIsADivButTabsAreButtons = `
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
import { resolveExplorerAppTarget } from '@/lib/explorer-app-target'
import { openExternal } from '@/lib/open-external'
const onCtaTrack = (tab) => { const platform = detectClientPlatform(); if (platform === 'ios') {} captureMarketing('links_page_cta_clicked', {}) }
const tabs = LINKS_TABS.map((tab) => (<button role="tab" onClick={() => selectTab(tab.id)}>{tab.label}</button>))
const cta = (<div onClick={() => onCtaTrack(activeTab)}>{activeTab.cta.label}</div>)
`;
  if (run(ctaIsADivButTabsAreButtons).length === 0) {
    selfFailures.push("DECORATIVE-REPAIR REGRESSION: a <div> CTA in a file that still has tablist <button>s was NOT flagged — the check is decorative again (ORCH-1382 §0.4)");
  }

  // The CTA anchor lost its rel → fire (the §5.1 trap: an implementor 'complying'
  // with the ORCH-1381 noopener ban by stripping rel from the anchor).
  const noRel = good.replace(/ rel="noopener"/g, "");
  if (run(noRel).length === 0) selfFailures.push("CTA anchor missing rel=\"noopener\" not flagged (the §5.1 trap)");

  // The CTA anchor lost target="_blank" → fire.
  const noTarget = good.replace(/ target="_blank"/g, "");
  if (run(noTarget).length === 0) selfFailures.push('CTA anchor missing target="_blank" not flagged');

  // The CTA reverted to a <button onClick={() => onCtaClick(  → fire.
  const revertedToButton = good
    .replace(/<a href=\{explorerTarget\.installHref\}[^>]*>/, "<button type=\"button\" onClick={() => onCtaClick(activeTab)}>")
    .replace(/onCtaTrack/g, "onCtaClick");
  if (run(revertedToButton).length === 0) selfFailures.push("CTA reverted to <button onClick={() => onCtaClick( not flagged");

  // ⭐ PINS §5.1 — an anchor carrying rel="noopener" must PASS. A future author who
  // "helpfully" re-bans the token on anchors (pattern-matching the ORCH-1381 ban)
  // would break this case, which is exactly the point.
  if (run(good).some((f) => /noopener/.test(f) && /banned/i.test(f))) {
    selfFailures.push('anchor rel="noopener" was WRONGLY flagged as banned — the ORCH-1381 ban is scoped to window.open FEATURE STRINGS; on an <a> rel="noopener" is REQUIRED (ORCH-1382 §5.1)');
  }

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
  console.log("ORCH-1328 links-cta-opens-store-clientside self-test PASS (16/16 cases, ORCH-1382-amended: incl. the §0.4 decorative-repair proof + the §5.1 rel-on-anchor pin).");
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
    "ORCH-1328 (I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE, ORCH-1382-amended) FAIL —\n" +
      "the /links CTA must be a real <a href> anchor to the ATTRIBUTED OneLink (resolved by\n" +
      "resolveExplorerAppTarget / resolveBusinessAppTarget), carrying target=\"_blank\" +\n" +
      "rel=\"noopener\" and firing onCtaTrack( — so the store app opens with no intermediate\n" +
      "web page, /links stays mounted, and the tap analytics survive. It must NEVER\n" +
      "soft-navigate into the /download|/business/download route nor hardcode a store literal.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1328 PASS (ORCH-1382-amended) — the /links CTA is a real <a href={…}> anchor to the\n" +
    "attributed OneLink (target=\"_blank\" + rel=\"noopener\"), device-driven via\n" +
    "detectClientPlatform, with BOTH decisions delegated (resolveExplorerAppTarget /\n" +
    "resolveBusinessAppTarget); openExternal( survives for the desktop /download QR page;\n" +
    "it fires links_page_cta_clicked via onCtaTrack( and never soft-navigates into the\n" +
    "/download|/business/download route nor hardcodes a store literal.",
);
