#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1]
 * I-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED (DRAFT)
 *
 * The consumer ATT / startAppsFlyer() trigger in app-mobile/app/index.tsx MUST
 * fire for anonymous (pre-sign-in) sessions so every install is capturable. The
 * ATT effect MUST NOT early-return on `!isAuthenticated || !user?.id`, and its
 * dependency array MUST stay `[]` (no re-introduced auth gate). A protective
 * anchor comment names the ORCH so the intent cannot be silently reverted.
 *
 * Fails-on-revert: re-adding the `if (!isAuthenticated || !user?.id) return`
 * early-return, or putting auth deps back in the array, fails this gate.
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

// Anchor is inside a comment (raw-source check). Em-dash omitted for encoding safety.
const ANCHOR = "ORCH-1313: ATT fires at first-open (anonymous)";
const AUTH_EARLY_RETURN_RE =
  /if\s*\(\s*!isAuthenticated\s*\|\|\s*!user\?\.id\s*\)\s*return/;

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

// Extract the ATT effect: from `const attFiredRef = useRef(false)` to the first
// `}, [ ... ]);` after it. Returns { body, deps } or null.
function extractAttEffect(code) {
  const start = code.indexOf("const attFiredRef = useRef(false)");
  if (start === -1) return null;
  const effectStart = code.indexOf("useEffect(() => {", start);
  if (effectStart === -1) return null;
  const rest = code.slice(effectStart);
  const close = rest.match(/\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/);
  if (!close) return null;
  const endIdx = close.index + close[0].length;
  return { body: rest.slice(0, endIdx), deps: close[1] };
}

function runSelfTest() {
  let selfFail = 0;
  const goodRaw = `
    // ORCH-1313: ATT fires at first-open (anonymous) — do NOT auth-gate.
    const attFiredRef = useRef(false);
    useEffect(() => {
      if (attFiredRef.current) return;
      attFiredRef.current = true;
      ensureAttRequested().then(() => startAppsFlyer());
    }, []);
  `;
  const badGate = `
    const attFiredRef = useRef(false);
    useEffect(() => {
      if (attFiredRef.current) return;
      if (!isAuthenticated || !user?.id) return;
      attFiredRef.current = true;
      ensureAttRequested().then(() => startAppsFlyer());
    }, [isAuthenticated, user?.id]);
  `;
  const goodEff = extractAttEffect(stripComments(goodRaw));
  if (!goodEff || AUTH_EARLY_RETURN_RE.test(goodEff.body)) {
    console.error("SELF-TEST FAIL: correct anonymous-first effect flagged as auth-gated");
    selfFail++;
  }
  if (!goodEff || goodEff.deps.trim() !== "") {
    console.error("SELF-TEST FAIL: correct empty deps not detected");
    selfFail++;
  }
  if (!goodRaw.includes(ANCHOR)) {
    console.error("SELF-TEST FAIL: anchor not detected in correct source");
    selfFail++;
  }
  const badEff = extractAttEffect(stripComments(badGate));
  if (!badEff || !AUTH_EARLY_RETURN_RE.test(badEff.body)) {
    console.error("SELF-TEST FAIL: reverted auth-gate NOT detected");
    selfFail++;
  }
  if (!badEff || badEff.deps.includes("isAuthenticated") === false) {
    console.error("SELF-TEST FAIL: reverted auth deps NOT detected");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

if (!fs.existsSync(INDEX)) {
  fail("INV-1: index-present", "app-mobile/app/index.tsx missing");
} else {
  const raw = readSource(INDEX);
  if (raw.includes(ANCHOR)) {
    ok("INV-1: anchor", "ATT effect carries the ORCH-1313 anonymous-first anchor comment");
  } else {
    fail("INV-1: anchor", `missing anchor comment "${ANCHOR}" — see SPEC_ORCH-1313 §4.A/§6`);
  }
  const eff = extractAttEffect(stripComments(raw));
  if (!eff) {
    fail("INV-2: att-effect", "could not locate the ATT effect (attFiredRef useEffect)");
  } else {
    if (!AUTH_EARLY_RETURN_RE.test(eff.body)) {
      ok("INV-2: no-auth-gate", "ATT effect has no `!isAuthenticated || !user?.id` early-return");
    } else {
      fail("INV-2: no-auth-gate", "ATT effect re-introduced the auth early-return — install undercount regresses (SPEC_ORCH-1313 §4.A)");
    }
    if (!/isAuthenticated|user\?\.id/.test(eff.deps)) {
      ok("INV-3: empty-deps", "ATT effect dependency array carries no auth gate");
    } else {
      fail("INV-3: empty-deps", `ATT effect deps re-introduced an auth gate: [${eff.deps.trim()}]`);
    }
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED: PASS · violations=0");
process.exit(0);
