#!/usr/bin/env node
/**
 * ORCH-1324 [business "Get the app" → device-aware live-store link + business web],
 * AMENDED BY ORCH-1381 [business-getapp-android-choice].
 * Invariant: I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE.
 *
 * The business (organiser / usemingla.com/business) marketing CTAs — the
 * glass-nav.tsx `surface === 'organiser'` branch AND the organiser hero
 * (components/sections/organiser-home/hero.tsx) — must present an explicit inline
 * CHOICE rather than guessing one destination: "Download the app" (iOS → the live
 * business App Store, Android → the LIVE business Play listing) AND "Use on web",
 * driven by detectClientPlatform() through the shared lib/business-app-target.ts
 * decision helper, with a popup-blocked window.location.assign fallback. There is
 * NO beta/lead-capture funnel and NO desktop QR panel on the business surface.
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
 *   (e) carries the popup-blocked fallback window.location.assign(.
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

  // (e) popup-blocked fallback.
  if (!/window\.location\.assign\(/.test(src)) {
    failures.push(
      `${label}: missing the \`window.location.assign(\` popup-blocked fallback — a ` +
        `blocked window.open must still navigate the owner (no dead tap).`,
    );
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

  // ORCH-1381 — the compliant surface offers TWO actions via the shared helper.
  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
const handleDownloadTheBusinessApp = () => {
  const platform = detectClientPlatform()
  const target = resolveBusinessAppTarget(platform)
  if (target.installHref === null) return
  captureMarketing('get_the_app_clicked', {
    action: 'download',
    platform,
    store: target.installStore,
    surface: 'organiser',
    location: 'nav',
  })
  const win = window.open(target.installHref, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(target.installHref)
}
const handleUseBusinessOnWeb = () => {
  const platform = detectClientPlatform()
  const target = resolveBusinessAppTarget(platform)
  captureMarketing('get_the_app_clicked', {
    action: 'use_web',
    platform,
    store: 'business_web',
    surface: 'organiser',
    location: 'nav',
  })
  const win = window.open(target.webHref, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(target.webHref)
}
const jsx = <>{BUSINESS_APP_CHOICE_COPY.download}{BUSINESS_APP_CHOICE_COPY.useWeb}</>
`;
  if (run(good).length !== 0) selfFailures.push("compliant business CTA wrongly flagged: " + JSON.stringify(run(good)));

  // ORCH-1381 — reverted to the collapsed ternary (android → web) → fire.
  const ternary = good.replace(
    "const target = resolveBusinessAppTarget(platform)",
    "const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL\n  const target = resolveBusinessAppTarget(platform)",
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
    .replace("import { detectClientPlatform } from '@/lib/device-platform'", "");
  if (run(noDetect).length === 0) selfFailures.push("missing detectClientPlatform not flagged");

  // Removed analytics → fire.
  const noAnalytics = good.replace(/get_the_app_clicked/g, "some_other_event");
  if (run(noAnalytics).length === 0) selfFailures.push("missing get_the_app_clicked not flagged");

  // Missing surface:'organiser' → fire. (/g: BOTH handlers must lose it, else the
  // surviving one keeps the file-level check green and the case is a no-op.)
  const noSurface = good.replace(/\s*surface: 'organiser',/g, "");
  if (run(noSurface).length === 0) selfFailures.push("missing surface:'organiser' not flagged");

  // Missing popup fallback → fire.
  const noFallback = good.replace(/\s*if \(!win\) window\.location\.assign\([^)]*\)/g, "");
  if (run(noFallback).length === 0) selfFailures.push("missing window.location.assign fallback not flagged");

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
  console.log("ORCH-1324 business-getapp-device-aware self-test PASS (12/12 cases, ORCH-1381-amended).");
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
