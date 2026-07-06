#!/usr/bin/env node
/**
 * ORCH-1319 [Explorer "Get the app" → direct live-store links] — G-1.
 * Invariant: I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT (+ I-1319-NO-DOWNLOAD-GATE).
 *
 * Over mingla-marketing/components/marketing/glass-nav.tsx (comment-stripped):
 *   (a) references BOTH APP_STORE_URL and PLAY_STORE_URL (the live store
 *       constants from lib/store-links) AND calls detectClientPlatform().
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

  // (a) both live store constants + platform detection.
  const hasApp = /APP_STORE_URL/.test(src);
  const hasPlay = /PLAY_STORE_URL/.test(src);
  if (!hasApp || !hasPlay) {
    failures.push(
      `${NAV}: must reference BOTH APP_STORE_URL and PLAY_STORE_URL (live store ` +
        `links from lib/store-links) — got app=${hasApp}, play=${hasPlay}.`,
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
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'
const handleGetTheApp = () => {
  const platform = detectClientPlatform()
  if (platform === 'ios' || platform === 'android') {
    const store = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL
    captureMarketing('get_the_app_clicked', { platform, store: platform === 'ios' ? 'app_store' : 'play', location: 'nav' })
    window.open(store)
    return
  }
  captureMarketing('get_the_app_clicked', { platform: 'other', store: 'qr_panel', location: 'nav' })
  setQrOpen(true)
}
`;
  if (run(good).length !== 0) selfFailures.push("compliant nav wrongly flagged");

  // Missing PLAY_STORE_URL (single-store hardcode) → fire.
  const singleStore = good.replace(/PLAY_STORE_URL/g, "APP_STORE_URL");
  if (run(singleStore).length === 0) selfFailures.push("single-store (no PLAY_STORE_URL) not flagged");

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
  console.log("ORCH-1319 G-1 getapp-cta-direct-store self-test PASS (8/8 cases).");
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
    "ORCH-1319 G-1 (I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT) FAIL — the\n" +
      "explorer nav CTA must link to the live stores by detected platform, fire\n" +
      "get_the_app_clicked, and carry no lead-form / TestFlight token.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1319 G-1 PASS — nav CTA is device-driven to the live stores (APP_STORE_URL/\n" +
    "PLAY_STORE_URL via detectClientPlatform), fires get_the_app_clicked, and carries\n" +
    "no lead-form / TestFlight token.",
);
