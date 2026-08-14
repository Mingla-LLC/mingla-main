#!/usr/bin/env node
/**
 * ORCH-1324 [business "Get the app" → device-aware live-store link + business web],
 * AMENDED BY ORCH-1381 [business-getapp-android-choice].
 * Invariant: I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE.
 *
 * The business (organiser / usemingla.com/host) marketing CTAs — the
 * glass-nav.tsx `surface === 'organiser'` branch AND the organiser hero
 * (components/sections/organiser-home/hero.tsx) — must present an explicit inline
 * CHOICE rather than guessing one destination: "Download the app" (iOS → the live
 * business App Store, Android → the LIVE business Play listing) AND "Use on web",
 * driven by detectClientPlatform() through the shared lib/business-app-target.ts
 * decision helper, opening every destination through the shared lib/open-external
 * owner (which carries the popup-block fallback). There is NO beta/lead-capture
 * funnel and NO desktop QR panel on the business surface.
 *
 * NOTE (ORCH-1381 ADDENDUM D-A-2, Seth's OQ-1 ruling = option B): on a PHONE the nav
 * renders exactly ONE action — the logo + both pinned-copy pills provably cannot fit
 * at 360px at any text size. BOTH handlers (and therefore both `action:` captures)
 * still exist on the surface, which is what check (c) pins; the second action simply
 * returns at `sm`. The HERO always carries the full two-action choice.
 *
 * ORCH-1324's original clause "Android + desktop/other → the business web app" is
 * SUPERSEDED: the business Play listing went live 2026-07-15 (COMMS-0101), so
 * Android → Play and only desktop/other → web.
 *
 * Over each target (comment-stripped) REQUIRE:
 *   (a) delegates to resolveBusinessAppTarget( AND renders BUSINESS_APP_CHOICE_COPY
 *       (proves the inline choice is wired from the shared module, not re-derived).
 *   (b) calls detectClientPlatform().
 *   (c) carries BOTH `action: 'download'` and `action: 'use_web'` — two actions
 *       exist, not one. Without the discriminator an Android owner who CHOOSES web
 *       is indistinguishable from ORCH-1324's forced-web and the fix is
 *       unmeasurable.  [G-b]
 *   (d) fires a `get_the_app_clicked` capture AND carries a `surface: 'organiser'`
 *       prop (distinguishes the business event from the explorer one).
 *   (e) delegates every external open to openExternal( from lib/open-external.
 *       AMENDED BY ORCH-1381 ADDENDUM D-B: this check previously required the token
 *       `window.location.assign(` as a "no silent failure" guard. That check was
 *       BLIND — it was satisfied by code whose fallback fired 100% of the time
 *       (window.open with a noopener/noreferrer feature string returns null EVEN ON
 *       SUCCESS, so every tap opened a tab AND navigated the page away). A presence
 *       check for an error path cannot distinguish "handles the error" from "is
 *       permanently in the error path". The guard now lives in the module that owns
 *       the decision (orch-1381-open-external-no-double-nav.mjs, which asserts the
 *       fallback is in the else-branch); here we require DELEGATION to it, and BAN
 *       inlining window.open so the bug cannot come back on these surfaces.
 *
 * G-b (adversarial, INVERTED by ORCH-1381): FAIL if a surface carries the collapsed
 * ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`. That
 * ternary WAS the ORCH-1324 contract; it is now THE BUG — it sends every Android
 * owner to the web app instead of the live Play listing. This is the
 * different-angle assertion vs. the happy-path presence check.
 *
 * BAN (the retired beta funnel must never come back to either surface):
 *   BetaAccessModal, beta-access-modal, beta-access-submit, Get Beta Access,
 *   Free during beta, type="email", testflight (case-insensitive).
 *
 * Live-mode robustness: the guard scans the WHOLE glass-nav.tsx (the explorer
 * branch also contains detectClientPlatform / platform === / get_the_app_clicked
 * — file-level presence is the floor; the BUSINESS_* + `surface: 'organiser'`
 * requirements + the BAN list are what pin the business branch). hero.tsx has no
 * explorer code so its checks are unambiguous. If a target is missing → FAIL.
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGETS = [
  "mingla-marketing/components/marketing/glass-nav.tsx",
  "mingla-marketing/components/sections/organiser-home/hero.tsx",
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Banned tokens — the dead business beta funnel must never come back.
const BANNED = [
  { re: /BetaAccessModal/, why: "references the deleted BetaAccessModal" },
  { re: /beta-access-modal/, why: "imports the deleted beta-access-modal" },
  { re: /beta-access-submit/, why: "imports the deleted beta-access-submit transport" },
  { re: /Get Beta Access/, why: "renders the retired \"Get Beta Access\" label" },
  { re: /Free during beta/, why: "renders the retired \"Free during beta\" beta subcopy" },
  { re: /type="email"/, why: "re-adds an email-lead form input (beta funnel)" },
  { re: /testflight/i, why: "contains a testflight token (the beta link is retired)" },
  // ORCH-1381 B3 — the fails-on-revert teeth. This ternary WAS the ORCH-1324
  // contract and is now THE BUG.
  { re: /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/, why: "the ORCH-1324 collapsed ternary — sends every Android owner to the web app instead of the LIVE business Play listing (ORCH-1381)" },
  // ORCH-1381 ADDENDUM D-B — the double-navigation teeth. These surfaces must
  // DELEGATE to openExternal(; inlining window.open is how the bug shipped to four
  // call sites at once.
  { re: /window\.open\(/, why: "inlines window.open — must delegate to openExternal( from lib/open-external (ORCH-1381 ADDENDUM D-B)" },
  // The half-fix trap: 'noreferrer' ALONE also nulls the return, so banning only
  // 'noopener' would let the identical bug back in.
  { re: /\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/, why: "passes noopener/noreferrer to window.open — per the HTML spec it then returns null EVEN ON SUCCESS, so the popup-block fallback fires unconditionally and the page double-navigates (ORCH-1381 ADDENDUM D-B)" },
];

function checkTarget(label, rawSrc, failures) {
  const src = stripComments(rawSrc);

  // (a) ORCH-1381 B1 — the choice is wired from the shared decision module. The
  // BUSINESS_* consts deliberately no longer appear on these surfaces: requiring
  // them would re-create the 5-call-site triplication ORCH-1381 removed.
  const hasHelper = /resolveBusinessAppTarget\(/.test(src);
  const hasCopy = /BUSINESS_APP_CHOICE_COPY/.test(src);
  if (!hasHelper || !hasCopy) {
    failures.push(
      `${label}: must resolve via resolveBusinessAppTarget( AND render ` +
        `BUSINESS_APP_CHOICE_COPY (the shared ORCH-1381 decision + copy module) — ` +
        `got helper=${hasHelper}, copy=${hasCopy}.`,
    );
  }

  // (b) platform detection.
  if (!/detectClientPlatform\(/.test(src)) {
    failures.push(
      `${label}: the "Get the app" handler must call detectClientPlatform() — the ` +
        `destination must be device-driven.`,
    );
  }

  // (c) ORCH-1381 B2 / G-b adversarial — TWO actions must exist, not one. The
  // `action` discriminator is what makes an Android owner CHOOSING web
  // distinguishable from ORCH-1324's forced-web.
  const hasDownload = /action: 'download'/.test(src);
  const hasUseWeb = /action: 'use_web'/.test(src);
  if (!hasDownload || !hasUseWeb) {
    failures.push(
      `${label}: must fire BOTH \`action: 'download'\` and \`action: 'use_web'\` — the ` +
        `business surface presents an explicit CHOICE, and without the discriminator an ` +
        `Android owner who chooses web is indistinguishable from the old forced-web (G-b).`,
    );
  }

  // (d) analytics present + business-scoped.
  if (!/get_the_app_clicked/.test(src)) {
    failures.push(
      `${label}: missing a \`get_the_app_clicked\` capture — the tap analytics must ` +
        `not be silently dropped.`,
    );
  }
  if (!/surface:\s*['"]organiser['"]/.test(src)) {
    failures.push(
      `${label}: the capture is missing a \`surface: 'organiser'\` prop — the business ` +
        `CTA event must be distinguishable from the explorer CTA.`,
    );
  }

  // (e) ORCH-1399 — business destinations are now real <a href> ANCHORS on both of
  // these surfaces, so openExternal( LEGITIMATELY disappears from them (it survives
  // only for the /links desktop QR page, guarded by orch-1328). Requiring it here
  // would FAIL the correct implementation.
  //
  // What must NEVER come back is an INLINE window.open — that ban is RETAINED below,
  // unweakened, and is what actually protects the D-B double-nav bug class.
  if (!/<a\s+[^>]*href=\{/.test(src)) {
    failures.push(
      `${label}: business destinations must render as real <a href={…}> anchors — an ` +
        `anchor survives the in-app webviews where window.open is routinely blocked, and ` +
        `the OneLink it points at 301s straight to the store app (ORCH-1399).`,
    );
  }
  // ⚠ PER-ANCHOR, NOT FILE-LEVEL — deliberately, and this matters even though these
  // two files happen to contain ONLY CTA anchors today. A file-level /rel="noopener/
  // check silently becomes DECORATIVE the moment ANY other rel-carrying anchor is
  // added to the file (a footer link, a social icon, anything). That is not
  // hypothetical: it is exactly what happened to links-experience.tsx, whose socials
  // row made its file-level rel check pass while every CTA anchor had lost its rel.
  // Checking each CTA anchor on its own removes the trap permanently.
  const ctaAnchors = [...src.matchAll(/<a\s[\s\S]*?>/g)]
    .map((m) => m[0])
    .filter((a) => /installHref|webHref/.test(a));
  for (const a of ctaAnchors) {
    const shape = a.replace(/\s+/g, " ").slice(0, 72);
    if (!/rel="noopener/.test(a)) {
      failures.push(
        `${label}: a business anchor is missing rel="noopener" — reverse-tabnabbing. NOTE: the ` +
          `ORCH-1381 noopener BAN below is scoped to window.open FEATURE STRINGS; on an <a> ` +
          `element rel="noopener" is MANDATORY, not forbidden. Offending anchor: ${shape}…`,
      );
    }
    if (!/target="_blank"/.test(a)) {
      failures.push(`${label}: a business anchor is missing target="_blank". Offending anchor: ${shape}…`);
    }
  }

  // BAN — no dead-funnel tokens.
  for (const { re, why } of BANNED) {
    if (re.test(src)) {
      failures.push(`${label}: ${why} (banned by ORCH-1324).`);
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => {
    const f = [];
    checkTarget("fixture", s, f);
    return f;
  };

  // ORCH-1381 — the compliant surface offers TWO actions via the shared helper and
  // delegates every open to the ONE owner (ADDENDUM D-B).
  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
import { siteAttribution } from '@/lib/links-src'
const target = resolveBusinessAppTarget(businessPlatform, siteAttribution('business_nav'))
const handleDownloadTheBusinessApp = () => {
  const platform = detectClientPlatform()
  const t = resolveBusinessAppTarget(platform, siteAttribution('business_nav'))
  if (t.installHref === null) return
  captureMarketing('get_the_app_clicked', {
    action: 'download',
    platform,
    store: t.installStore,
    surface: 'organiser',
    location: 'nav',
  })
}
const handleUseBusinessOnWeb = () => {
  const platform = detectClientPlatform()
  captureMarketing('get_the_app_clicked', {
    action: 'use_web',
    platform,
    store: 'business_web',
    surface: 'organiser',
    location: 'nav',
  })
}
const jsx = (
  <>
    <a href={target.installHref} target="_blank" rel="noopener" onClick={handleDownloadTheBusinessApp}>{BUSINESS_APP_CHOICE_COPY.download}</a>
    <a href={target.webHref} target="_blank" rel="noopener" onClick={handleUseBusinessOnWeb}>{BUSINESS_APP_CHOICE_COPY.useWeb}</a>
  </>
)
`;
  if (run(good).length !== 0) selfFailures.push("compliant business CTA wrongly flagged: " + JSON.stringify(run(good)));

  // ORCH-1381 — reverted to the collapsed ternary (android → web) → fire.
  const ternary = good.replace(
    "  const t = resolveBusinessAppTarget(platform, siteAttribution('business_nav'))",
    "  const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL\n  const t = resolveBusinessAppTarget(platform, siteAttribution('business_nav'))",
  );
  if (run(ternary).length === 0) selfFailures.push("ORCH-1324 collapsed ternary (android→web) not flagged");

  // ORCH-1381 — stopped delegating to the shared helper → fire.
  const noHelper = good.replace(/resolveBusinessAppTarget/g, "someLocalGuess");
  if (run(noHelper).length === 0) selfFailures.push("missing resolveBusinessAppTarget not flagged");

  // ORCH-1381 — collapsed back to ONE action (no use_web) → fire.
  const oneAction = good.replace(/action: 'use_web'/g, "action: 'download'");
  if (run(oneAction).length === 0) selfFailures.push("missing the second action (use_web) not flagged");

  // No detectClientPlatform → fire.
  const noDetect = good
    .replace(/const platform = detectClientPlatform\(\)/g, "const platform = 'ios'")
    .replace("import { detectClientPlatform } from '@/lib/device-platform'", "")
    .replace(/detectClientPlatform/g, "hardcodedPlatform");
  if (run(noDetect).length === 0) selfFailures.push("missing detectClientPlatform not flagged");

  // Removed analytics → fire.
  const noAnalytics = good.replace(/get_the_app_clicked/g, "some_other_event");
  if (run(noAnalytics).length === 0) selfFailures.push("missing get_the_app_clicked not flagged");

  // Missing surface:'organiser' → fire. (/g: BOTH handlers must lose it, else the
  // surviving one keeps the file-level check green and the case is a no-op.)
  const noSurface = good.replace(/\s*surface: 'organiser',/g, "");
  if (run(noSurface).length === 0) selfFailures.push("missing surface:'organiser' not flagged");

  // ORCH-1399 — the business destinations stopped being anchors → fire.
  const noAnchor = good.replace(/<a\s+href=\{/g, "<div data-href={");
  if (run(noAnchor).length === 0) selfFailures.push("business destinations not rendered as <a href={…}> anchors not flagged");

  // ORCH-1399 — the anchor lost rel="noopener" (the §5.1 trap: an implementor
  // "complying" with the ORCH-1381 window.open ban by stripping rel) → fire.
  const noRel = good.replace(/ rel="noopener"/g, "");
  if (run(noRel).length === 0) selfFailures.push('business anchor missing rel="noopener" not flagged (the §5.1 trap)');

  // ⭐ THE DECORATIVE-REL CASE (the trap that bit links-experience.tsx). The CTA
  // anchors lose their rel, but an unrelated rel-carrying anchor remains in the file.
  // A FILE-LEVEL check would PASS here. The per-anchor check must FIRE.
  const relOnlyOnNonCta = good.replace(/ rel="noopener"/g, "") +
    '\nconst social = (<a href="https://instagram.com/usemingla" target="_blank" rel="noopener noreferrer">IG</a>)\n';
  const relOnlyFailures = run(relOnlyOnNonCta);
  if (!relOnlyFailures.some((f) => /missing rel="noopener"/.test(f))) {
    selfFailures.push('DECORATIVE-REL REGRESSION: CTA anchors stripped of rel were NOT flagged because an unrelated anchor still carries rel="noopener" — the check has gone file-level (ORCH-1399)');
  }

  // ⭐ ORCH-1399 §5.1 PIN — a file carrying rel="noopener" on an ANCHOR *and* a bare
  // window.open elsewhere must still fire ONLY for the window.open, never for the rel.
  // A future author who "simplifies" the .open( trap regex to a bare /noopener/ would
  // break this case — which is exactly why it exists.
  const relPlusBareOpen = good + '\nconst x = (<a href={t.webHref} rel="noopener">y</a>)\nconst win = window.open(d, "_blank")\n';
  const relFailures = run(relPlusBareOpen);
  if (!relFailures.some((f) => /window\.open/.test(f))) {
    selfFailures.push("bare inlined window.open alongside rel=\"noopener\" was NOT flagged");
  }
  if (relFailures.some((f) => /noopener\/noreferrer/.test(f))) {
    selfFailures.push('rel="noopener" on an ANCHOR was WRONGLY caught by the .open( trap regex — the ban must stay scoped to window.open FEATURE STRINGS (ORCH-1399 §5.1)');
  }

  // ORCH-1381 ADDENDUM D-B — inlined the SHIPPED bug back in → fire (both the
  // window.open ban and the noopener/noreferrer ban).
  const inlinedBug = good.replace(
    "  if (t.installHref === null) return",
    "  const win = window.open(t.installHref, '_blank', 'noopener,noreferrer')\n  if (!win) window.location.assign(t.installHref)",
  );
  if (run(inlinedBug).length === 0) selfFailures.push("inlined window.open(…,'noopener,noreferrer') double-nav bug not flagged");

  // ORCH-1381 ADDENDUM D-B — THE HALF-FIX TRAP: 'noreferrer' alone also returns
  // null, so this ships the IDENTICAL bug. It must fire.
  const halfFix = good.replace(
    "  if (t.installHref === null) return",
    "  const win = window.open(t.installHref, '_blank', 'noreferrer')\n  if (win) { win.opener = null } else { window.location.assign(t.installHref) }",
  );
  if (run(halfFix).length === 0) selfFailures.push("HALF-FIX TRAP ('noreferrer' only, still returns null) not flagged");

  // ORCH-1381 ADDENDUM D-B — even a BARE inlined window.open must fire: the
  // decision belongs in one module, not re-inlined per surface.
  const bareInline = good.replace(
    "  if (t.installHref === null) return",
    "  const win = window.open(t.installHref, '_blank')\n  if (win) { win.opener = null } else { window.location.assign(t.installHref) }",
  );
  if (run(bareInline).length === 0) selfFailures.push("bare inlined window.open (not delegating) not flagged");

  // Re-added BetaAccessModal → fire.
  const beta = good + "\nimport { BetaAccessModal } from '@/components/marketing/beta-access-modal'\n";
  if (run(beta).length === 0) selfFailures.push("re-added BetaAccessModal not flagged");

  // Re-added "Get Beta Access" label → fire.
  const label = good + "\nconst cta = 'Get Beta Access'\n";
  if (run(label).length === 0) selfFailures.push("re-added Get Beta Access label not flagged");

  // testflight token → fire.
  const tf = good + "\nconst x = 'https://testflight.apple.com/join/1gvHNqkQ'\n";
  if (run(tf).length === 0) selfFailures.push("testflight token not flagged");

  // A banned token inside a COMMENT must be stripped → compliant still passes.
  const commented = good + "\n// note: no more Get Beta Access / testflight beta funnel here\n";
  if (run(commented).length !== 0) selfFailures.push("commented banned token wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1324 business-getapp-device-aware self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1324 business-getapp-device-aware self-test PASS (19/19 cases, ORCH-1399-amended: incl. the §5.1 rel-on-anchor pin).");
  process.exit(0);
}

// ---- Live mode
const failures = [];
for (const rel of TARGETS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`ORCH-1324 FAIL — target not found at ${rel} (gate path out of sync).`);
    process.exit(1);
  }
  checkTarget(rel, fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1324 (I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE, ORCH-1381-amended) FAIL —\n" +
      "the business nav + hero CTAs must present an explicit inline CHOICE via the shared\n" +
      "decision module: resolveBusinessAppTarget( + BUSINESS_APP_CHOICE_COPY, driven by\n" +
      "detectClientPlatform, firing get_the_app_clicked { surface:'organiser' } with BOTH\n" +
      "action:'download' and action:'use_web', a window.location.assign fallback, NO beta\n" +
      "funnel / QR token, and NEVER the ORCH-1324 collapsed ternary (which sends every\n" +
      "Android owner to the web app).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1324 PASS (ORCH-1381-amended) — the business nav + hero CTAs present the inline\n" +
    "choice via resolveBusinessAppTarget + BUSINESS_APP_CHOICE_COPY (iOS → business App\n" +
    "Store, Android → business Play, desktop → web only), fire get_the_app_clicked\n" +
    "{ surface:'organiser' } with both action:'download' and action:'use_web', keep the\n" +
    "window.location.assign fallback, and carry no beta-funnel / TestFlight token nor the\n" +
    "collapsed ternary.",
);
