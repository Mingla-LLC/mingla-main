#!/usr/bin/env node
/**
 * ORCH-1319 [Explorer "Get the app" → direct live-store links] — G-1.
 * Invariant: I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT (+ I-1319-NO-DOWNLOAD-GATE).
 *
 * ORCH-1382 AMENDMENT (check (a)). The explorer nav CTA now resolves an ATTRIBUTED
 * OneLink via resolveExplorerAppTarget( instead of referencing APP_STORE_URL /
 * PLAY_STORE_URL locally — the OneLink 301s straight to market:// / the App Store, so
 * no intermediate store WEB page renders and the install carries pid/c. Requiring the
 * raw consts here would FAIL the correct implementation (a gate must never mandate a
 * worse one). `platform ===` is RETAINED and still load-bearing: desktop → the QR
 * panel, and installStore is platform-derived.
 *
 * Over mingla-marketing/components/marketing/glass-nav.tsx (comment-stripped):
 *   (a) resolves via resolveExplorerAppTarget( AND targets the Explorer OneLink,
 *       AND calls detectClientPlatform().
 *   (b) contains a `get_the_app_clicked` capture (analytics not silently dropped).
 *   (c) does NOT re-import the deleted lead modal / transport / reducer, reference
 *       GetTheAppModal, contain a `testflight` token, a `get_the_app_submitted`
 *       capture, or a re-added email-lead form input (`type="email"`).
 *
 * G-1b (adversarial): the store choice must be PLATFORM-DRIVEN — both store
 * constants present AND the handler branches on the resolved platform
 * (`platform ===`). This FAILS a "everyone → App Store" regression that strands
 * Android users, or a single-store hardcode.
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const NAV = "mingla-marketing/components/marketing/glass-nav.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Banned tokens — the dead lead funnel must never come back to the nav.
const BANNED = [
  { re: /GetTheAppModal/, why: "references the deleted GetTheAppModal" },
  { re: /get-the-app-modal/, why: "imports the deleted get-the-app-modal" },
  { re: /explorer-app-submit/, why: "imports the deleted explorer-app-submit transport" },
  { re: /submitExplorerAppLead/, why: "calls the deleted submitExplorerAppLead transport" },
  { re: /explorer-interest/, why: "imports the deleted explorer-interest reducer" },
  { re: /get_the_app_submitted/, why: "fires the dead get_the_app_submitted funnel event" },
  { re: /testflight/i, why: "contains a testflight token (the beta link is retired)" },
  { re: /type="email"/, why: "re-adds an email-lead form input on the nav" },
];

function checkNav(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // (a) ORCH-1382 — the explorer CTA delegates to the ONE explorer decision module
  // and targets the attributed OneLink. (WAS: references APP_STORE_URL +
  // PLAY_STORE_URL. Those moved behind resolveExplorerAppTarget — requiring them here
  // would re-create the glass-nav/links-experience triplication ORCH-1382 removed.)
  if (!/resolveExplorerAppTarget\(/.test(src)) {
    failures.push(
      `${NAV}: the explorer "Get the app" CTA must resolve via resolveExplorerAppTarget( ` +
        `from lib/explorer-app-target — the platform→destination decision lives in exactly ` +
        `ONE module (ORCH-1382), never re-derived here.`,
    );
  }
  if (!/EXPLORER_ONELINK_URL|oneLinkHref|installHref/.test(src)) {
    failures.push(
      `${NAV}: the CTA must target the Explorer OneLink (via the helper's installHref) — a ` +
        `plain store URL returns HTTP 200 text/html, so Android renders the Play WEBSITE ` +
        `first and the install arrives unattributed (ORCH-1382).`,
    );
  }
  if (!/detectClientPlatform\(/.test(src)) {
    failures.push(
      `${NAV}: the "Get the app" handler must call detectClientPlatform() — the ` +
        `store choice must be device-driven.`,
    );
  }

  // (a) G-1b adversarial — store choice branches on the resolved platform.
  if (!/platform ===/.test(src)) {
    failures.push(
      `${NAV}: the handler does not branch on \`platform ===\` — the store must be ` +
        `chosen from the DETECTED platform, not a single hardcoded branch (G-1b).`,
    );
  }

  // (b) analytics present.
  if (!/get_the_app_clicked/.test(src)) {
    failures.push(
      `${NAV}: missing a \`get_the_app_clicked\` capture — the tap analytics must ` +
        `not be silently dropped.`,
    );
  }

  // (c) no dead-funnel tokens.
  for (const { re, why } of BANNED) {
    if (re.test(src)) {
      failures.push(`${NAV}: ${why} (banned by ORCH-1319).`);
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkNav(s, f); return f; };

  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { resolveExplorerAppTarget } from '@/lib/explorer-app-target'
import { siteAttribution } from '@/lib/links-src'
const explorerTarget = resolveExplorerAppTarget(businessPlatform, siteAttribution('explorer_nav'))
const handleGetTheAppTrack = () => {
  const platform = detectClientPlatform()
  if (platform === 'ios' || platform === 'android') {
    captureMarketing('get_the_app_clicked', { platform, store: platform === 'ios' ? 'app_store' : 'play', location: 'nav' })
    return
  }
  captureMarketing('get_the_app_clicked', { platform: 'other', store: 'qr_panel', location: 'nav' })
  setQrOpen(true)
}
const cta = (<a href={explorerTarget.installHref} target="_blank" rel="noopener" onClick={handleGetTheAppTrack}>Get the app</a>)
`;
  if (run(good).length !== 0) selfFailures.push("compliant nav wrongly flagged: " + JSON.stringify(run(good)));

  // ORCH-1382 — the explorer CTA stopped delegating to its decision module → fire.
  const noHelper = good.replace(/resolveExplorerAppTarget/g, "someLocalGuess");
  if (run(noHelper).length === 0) selfFailures.push("nav missing resolveExplorerAppTarget not flagged");

  // ORCH-1382 — the CTA lost its OneLink target (bypassed → attribution dead) → fire.
  const noOneLink = good.replace(/installHref/g, "somethingElse").replace(/resolveExplorerAppTarget\(/g, "resolveExplorerAppTarget(");
  if (run(noOneLink).length === 0) selfFailures.push("nav CTA not targeting the Explorer OneLink not flagged");

  // No detectClientPlatform → fire (and no platform ===).
  const noDetect = good
    .replace("const platform = detectClientPlatform()", "const platform = 'ios'")
    .replace("import { detectClientPlatform } from '@/lib/device-platform'", "");
  if (run(noDetect).length === 0) selfFailures.push("missing detectClientPlatform not flagged");

  // Removed analytics → fire.
  const noAnalytics = good.replace(/get_the_app_clicked/g, "some_other_event");
  if (run(noAnalytics).length === 0) selfFailures.push("missing get_the_app_clicked not flagged");

  // testflight token → fire.
  const tf = good + "\nconst x = 'https://testflight.apple.com/join/1gvHNqkQ'\n";
  if (run(tf).length === 0) selfFailures.push("testflight token not flagged");

  // re-imported GetTheAppModal → fire.
  const modal = good + "\nimport { GetTheAppModal } from '@/components/marketing/get-the-app-modal'\n";
  if (run(modal).length === 0) selfFailures.push("re-imported GetTheAppModal not flagged");

  // get_the_app_submitted dead event → fire.
  const dead = good + "\ncaptureMarketing('get_the_app_submitted', {})\n";
  if (run(dead).length === 0) selfFailures.push("get_the_app_submitted not flagged");

  // A testflight token inside a COMMENT must be stripped → compliant still passes.
  const commented = good + "\n// note: no more testflight link here\n";
  if (run(commented).length !== 0) selfFailures.push("commented testflight wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1319 G-1 getapp-cta-direct-store self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1319 G-1 getapp-cta-direct-store self-test PASS (9/9 cases, ORCH-1382-amended).");
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, NAV);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1319 G-1 FAIL — target not found at ${NAV} (gate path out of sync).`);
  process.exit(1);
}
const failures = [];
checkNav(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1319 G-1 (I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT, ORCH-1382-amended)\n" +
      "FAIL — the explorer nav CTA must resolve via resolveExplorerAppTarget( to the\n" +
      "attributed Explorer OneLink (which 301s to the LIVE store listings), branch on the\n" +
      "detected platform, fire get_the_app_clicked, and carry no lead-form / TestFlight\n" +
      "token.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1319 G-1 PASS (ORCH-1382-amended) — nav CTA is device-driven via\n" +
    "detectClientPlatform and resolves the attributed Explorer OneLink through\n" +
    "resolveExplorerAppTarget (which 301s to the LIVE store listings — never TestFlight),\n" +
    "fires get_the_app_clicked, and carries no lead-form / TestFlight token.",
);
