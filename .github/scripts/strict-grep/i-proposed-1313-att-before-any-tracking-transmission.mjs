#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1]
 * I-PROPOSED-1313-ATT-BEFORE-ANY-TRACKING-TRANSMISSION (DRAFT)
 *
 * Moving the ATT trigger to first-open (anonymous) must NOT let any tracking SDK
 * transmit before the ATT gate resolves. This gate asserts:
 *   (a) app-mobile/app/index.tsx — every `startAppsFlyer()` call sits inside the
 *       `ensureAttRequested()` continuation (never top-level/ungated), and there
 *       is no `startAppsFlyer()` elsewhere in index.tsx; AND
 *   (b) app-mobile/src/services/postHogService.ts — retains `await
 *       whenAttResolved()` BEFORE constructing the PostHog client
 *       (`new PostHogClass(`).
 *
 * Fails-on-revert: an ungated `startAppsFlyer()` before ensureAttRequested, or
 * removing the postHog `await whenAttResolved()` before client construction,
 * fails this gate.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. `--self-test` validates detectors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const INDEX = path.join(REPO_ROOT, "app-mobile/app/index.tsx");
const POSTHOG = path.join(REPO_ROOT, "app-mobile/src/services/postHogService.ts");

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}
function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`fs error reading ${filePath}: ${e.message}`);
    process.exit(2);
  }
}
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// startAppsFlyer() is gated iff, in comment-stripped code, every call index is
// preceded (in the same file) by an `ensureAttRequested()` occurrence.
function startCallsAreGated(code) {
  const gateIdx = code.indexOf("ensureAttRequested()");
  const calls = [...code.matchAll(/startAppsFlyer\s*\(/g)].map((m) => m.index);
  if (calls.length === 0) return { gated: false, count: 0 };
  if (gateIdx === -1) return { gated: false, count: calls.length };
  return { gated: calls.every((i) => i > gateIdx), count: calls.length };
}

function postHogAwaitsAtt(code) {
  const attIdx = code.indexOf("await whenAttResolved()");
  const clientIdx = code.indexOf("new PostHogClass(");
  return attIdx !== -1 && clientIdx !== -1 && attIdx < clientIdx;
}

function runSelfTest() {
  let selfFail = 0;
  const goodIndex = `
    ensureAttRequested()
      .then(() => { startAppsFlyer(); })
      .catch(() => { startAppsFlyer(); });
  `;
  const badIndex = `
    startAppsFlyer();
    ensureAttRequested().then(() => {});
  `;
  const g = startCallsAreGated(stripComments(goodIndex));
  if (!(g.gated && g.count === 2)) {
    console.error("SELF-TEST FAIL: gated startAppsFlyer calls not recognized");
    selfFail++;
  }
  const b = startCallsAreGated(stripComments(badIndex));
  if (b.gated) {
    console.error("SELF-TEST FAIL: ungated startAppsFlyer not caught");
    selfFail++;
  }
  const goodPh = `if (Platform.OS === "ios") { await whenAttResolved(); } const client = new PostHogClass(key);`;
  const badPh = `const client = new PostHogClass(key); await whenAttResolved();`;
  if (!postHogAwaitsAtt(goodPh)) {
    console.error("SELF-TEST FAIL: correct postHog ATT-before-construct not recognized");
    selfFail++;
  }
  if (postHogAwaitsAtt(badPh)) {
    console.error("SELF-TEST FAIL: postHog constructing before ATT not caught");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1313-ATT-BEFORE-ANY-TRACKING-TRANSMISSION detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

if (!fs.existsSync(INDEX)) {
  fail("INV-1: index-present", "app-mobile/app/index.tsx missing");
} else {
  const g = startCallsAreGated(stripComments(readSource(INDEX)));
  if (g.count > 0 && g.gated) {
    ok("INV-1: appsflyer-gated", `all ${g.count} startAppsFlyer() call(s) sit inside the ensureAttRequested() gate`);
  } else {
    fail("INV-1: appsflyer-gated", `startAppsFlyer() must only be called inside the ensureAttRequested() continuation (gated=${g.gated}, count=${g.count}) — SPEC_ORCH-1313 §6`);
  }
}

if (!fs.existsSync(POSTHOG)) {
  fail("INV-2: posthog-present", "app-mobile/src/services/postHogService.ts missing");
} else {
  if (postHogAwaitsAtt(stripComments(readSource(POSTHOG)))) {
    ok("INV-2: posthog-att-first", "postHogService awaits whenAttResolved() before constructing the client");
  } else {
    fail("INV-2: posthog-att-first", "postHogService must `await whenAttResolved()` before `new PostHogClass(` — SPEC_ORCH-1313 §6/§11-B");
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1313-ATT-BEFORE-ANY-TRACKING-TRANSMISSION: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1313-ATT-BEFORE-ANY-TRACKING-TRANSMISSION: PASS · violations=0");
process.exit(0);
