#!/usr/bin/env node
/**
 * ORCH-1324 [business "Get the app" → device-aware live-store link + business web].
 * Invariant: I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE.
 *
 * The business (organiser / usemingla.com/business) marketing CTAs — the
 * glass-nav.tsx `surface === 'organiser'` branch AND the organiser hero
 * (components/sections/organiser-home/hero.tsx) — must resolve DEVICE-AWARE:
 * iOS → the live business App Store (BUSINESS_APP_STORE_URL), Android + desktop/
 * other → the business web app (BUSINESS_WEB_URL), driven by detectClientPlatform()
 * with a popup-blocked window.location.assign fallback. There is NO beta/lead-
 * capture funnel and NO desktop QR panel on the business surface.
 *
 * Over each target (comment-stripped) REQUIRE:
 *   (a) references BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL (the business
 *       store/web constants from lib/store-links — not hardcoded URLs).
 *   (b) calls detectClientPlatform().
 *   (c) branches on `platform ===` (device-driven, not a single hardcode).  [G-b]
 *   (d) fires a `get_the_app_clicked` capture AND carries a `surface: 'organiser'`
 *       prop (distinguishes the business event from the explorer one).
 *   (e) carries the popup-blocked fallback window.location.assign(.
 *
 * G-b (adversarial): the destination must be PLATFORM-DRIVEN. FAIL if
 * BUSINESS_WEB_URL is absent (non-iOS would have nowhere to go / everyone →
 * App Store, stranding Android + desktop owners) or if the file lacks
 * `platform ===` (a single hardcoded destination). This is the different-angle
 * assertion vs. the happy-path presence check.
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
];

function checkTarget(label, rawSrc, failures) {
  const src = stripComments(rawSrc);

  // (a) both business constants present.
  const hasStore = /BUSINESS_APP_STORE_URL/.test(src);
  const hasWeb = /BUSINESS_WEB_URL/.test(src);
  if (!hasStore || !hasWeb) {
    failures.push(
      `${label}: must reference BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL ` +
        `(business store/web links from lib/store-links) — got store=${hasStore}, web=${hasWeb}.`,
    );
  }
  // G-b — BUSINESS_WEB_URL is the non-iOS destination; its absence strands
  // Android + desktop owners (everyone → App Store).
  if (!hasWeb) {
    failures.push(
      `${label}: BUSINESS_WEB_URL is absent — non-iOS (Android/desktop) has nowhere ` +
        `to go; the destination must not collapse to everyone → the App Store (G-b).`,
    );
  }

  // (b) platform detection.
  if (!/detectClientPlatform\(/.test(src)) {
    failures.push(
      `${label}: the "Get the app" handler must call detectClientPlatform() — the ` +
        `destination must be device-driven.`,
    );
  }

  // (c) G-b adversarial — destination branches on the resolved platform.
  if (!/platform ===/.test(src)) {
    failures.push(
      `${label}: the handler does not branch on \`platform ===\` — the destination ` +
        `must be chosen from the DETECTED platform, not a single hardcode (G-b).`,
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

  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
const handleGetTheBusinessApp = () => {
  const platform = detectClientPlatform()
  const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL
  captureMarketing('get_the_app_clicked', {
    platform,
    store: platform === 'ios' ? 'app_store' : 'business_web',
    surface: 'organiser',
    location: 'nav',
  })
  const win = window.open(dest, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(dest)
}
`;
  if (run(good).length !== 0) selfFailures.push("compliant business CTA wrongly flagged");

  // Missing BUSINESS_WEB_URL (everyone → App Store) → fire.
  const noWeb = good.replace(/BUSINESS_WEB_URL/g, "BUSINESS_APP_STORE_URL");
  if (run(noWeb).length === 0) selfFailures.push("missing BUSINESS_WEB_URL not flagged");

  // No detectClientPlatform → fire.
  const noDetect = good
    .replace("const platform = detectClientPlatform()", "const platform = 'ios'")
    .replace("import { detectClientPlatform } from '@/lib/device-platform'", "");
  if (run(noDetect).length === 0) selfFailures.push("missing detectClientPlatform not flagged");

  // No `platform ===` branch (single hardcode) → fire.
  const noBranch = good
    .replace("const platform = detectClientPlatform()", "const platform = detectClientPlatform() /* p */")
    .replace(/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/, "BUSINESS_APP_STORE_URL")
    .replace(/platform === 'ios' \? 'app_store' : 'business_web'/, "'app_store'");
  if (run(noBranch).length === 0) selfFailures.push("missing `platform ===` branch not flagged");

  // Removed analytics → fire.
  const noAnalytics = good.replace(/get_the_app_clicked/g, "some_other_event");
  if (run(noAnalytics).length === 0) selfFailures.push("missing get_the_app_clicked not flagged");

  // Missing surface:'organiser' → fire.
  const noSurface = good.replace(/\s*surface: 'organiser',/, "");
  if (run(noSurface).length === 0) selfFailures.push("missing surface:'organiser' not flagged");

  // Missing popup fallback → fire.
  const noFallback = good.replace(/\s*if \(!win\) window\.location\.assign\(dest\)/, "");
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
  console.log("ORCH-1324 business-getapp-device-aware self-test PASS (11/11 cases).");
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
    "ORCH-1324 (I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE) FAIL — the business\n" +
      "nav + hero CTAs must resolve device-aware to the live business App Store /\n" +
      "business web app (BUSINESS_APP_STORE_URL / BUSINESS_WEB_URL via\n" +
      "detectClientPlatform), fire get_the_app_clicked { surface:'organiser' } with a\n" +
      "window.location.assign fallback, and carry NO beta funnel / QR token.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1324 PASS — the business nav + hero CTAs are device-driven to the live\n" +
    "business App Store / business web (BUSINESS_APP_STORE_URL / BUSINESS_WEB_URL via\n" +
    "detectClientPlatform), fire get_the_app_clicked { surface:'organiser' } with a\n" +
    "window.location.assign fallback, and carry no beta-funnel / TestFlight token.",
);
