#!/usr/bin/env node

/**
 * ORCH-1187 LEG 2 — buyer-web analytics wiring gate.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *
 * Structural fails-on-revert guard for the buyer-web (mingla-business Expo Web)
 * analytics leg. Asserts the load-bearing wiring stays in place:
 *
 *   (1) src/analytics/webAnalytics.web.ts EXISTS, calls `posthog.init(`, and
 *       includes the US host literal `https://us.i.posthog.com` (region lock),
 *       `opt_out_capturing_by_default: true` (consent gate), and a
 *       `session_recording` block with `maskAllInputs: true` (replay masking).
 *   (2) src/analytics/webAnalytics.ts (native stub) EXISTS and does NOT import
 *       posthog-js (the native bundle must never pull the web SDK).
 *   (3) app/_layout.tsx imports `initWebAnalytics` + `ConsentBanner`, calls
 *       initWebAnalytics() behind a Platform.OS === "web" guard, and mounts
 *       <ConsentBanner /> (so the consent gate actually renders + analytics boot).
 *
 * Reverting any of these (deleting the init, dropping the web-guard, removing the
 * banner mount, leaking posthog-js into the native stub) FAILS this gate.
 *
 * Comment-stripped before matching so a doc-comment mentioning a literal cannot
 * mask a real-code deletion.
 *
 * Self-test: pass `--self-test`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const WEB_MODULE = "mingla-business/src/analytics/webAnalytics.web.ts";
const NATIVE_STUB = "mingla-business/src/analytics/webAnalytics.ts";
const LAYOUT = "mingla-business/app/_layout.tsx";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(rel) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

if (process.argv.includes("--self-test")) {
  // Prove the detectors fire against fixtures.
  const good =
    'posthog.init(k,{api_host:"https://us.i.posthog.com",opt_out_capturing_by_default: true,session_recording:{maskAllInputs: true}})';
  const checks = [
    /posthog\.init\s*\(/.test(good),
    good.includes("https://us.i.posthog.com"),
    /opt_out_capturing_by_default\s*:\s*true/.test(good),
    /session_recording\s*:/.test(good),
    /maskAllInputs\s*:\s*true/.test(good),
  ];
  if (checks.some((c) => !c)) {
    console.error("ORCH-1187-LEG2 self-test FAILED: detector broken.");
    process.exit(1);
  }
  console.log("ORCH-1187-LEG2 self-test PASS.");
  process.exit(0);
}

const errors = [];

// (1) webAnalytics.web.ts contract.
const web = read(WEB_MODULE);
if (web === null) {
  errors.push(`Missing buyer-web analytics module: ${WEB_MODULE}`);
} else {
  const s = stripComments(web);
  if (!/posthog\.init\s*\(/.test(s)) {
    errors.push(`${WEB_MODULE}: must call posthog.init(...).`);
  }
  if (!s.includes("https://us.i.posthog.com")) {
    errors.push(`${WEB_MODULE}: must include the US host "https://us.i.posthog.com".`);
  }
  if (!/opt_out_capturing_by_default\s*:\s*true/.test(s)) {
    errors.push(`${WEB_MODULE}: must set opt_out_capturing_by_default: true (consent gate).`);
  }
  if (!/session_recording\s*:/.test(s) || !/maskAllInputs\s*:\s*true/.test(s)) {
    errors.push(`${WEB_MODULE}: session_recording must keep maskAllInputs: true (replay masking).`);
  }
}

// (2) native stub: exists + no posthog-js import.
const stub = read(NATIVE_STUB);
if (stub === null) {
  errors.push(`Missing native no-op stub: ${NATIVE_STUB}`);
} else if (/from\s+['"]posthog-js['"]|require\(\s*['"]posthog-js['"]\s*\)/.test(stub)) {
  errors.push(`${NATIVE_STUB}: native stub must NOT import posthog-js.`);
}

// (3) _layout wiring: import + web-guarded init + banner mount.
const layout = read(LAYOUT);
if (layout === null) {
  errors.push(`Missing root layout: ${LAYOUT}`);
} else {
  const s = stripComments(layout);
  if (!/initWebAnalytics/.test(s)) {
    errors.push(`${LAYOUT}: must import + call initWebAnalytics.`);
  }
  if (!/Platform\.OS\s*===\s*['"]web['"]/.test(s) || !/initWebAnalytics\s*\(/.test(s)) {
    errors.push(`${LAYOUT}: initWebAnalytics() must run behind a Platform.OS === "web" guard.`);
  }
  if (!/<ConsentBanner\s*\/?\s*>/.test(s)) {
    errors.push(`${LAYOUT}: must mount <ConsentBanner /> (the consent gate UI).`);
  }
}

if (errors.length > 0) {
  console.error("FAIL: ORCH-1187-LEG2 buyer-web analytics wiring violated");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nBuyer-web analytics (PostHog + GA4, consent-gated, masked replay) must stay wired (META-ORCH-1187 §4.B/§4.E).",
  );
  process.exit(1);
}

console.log(
  "OK: ORCH-1187-LEG2 — buyer-web PostHog init (US host, consent-gated, masked) + native stub clean + layout wiring intact",
);
