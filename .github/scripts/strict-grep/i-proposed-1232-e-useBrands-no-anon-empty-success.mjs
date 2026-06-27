#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1232 (H3)
 * I-PROPOSED-1232-E — auth-warm empty reads are not cached as authed-empty:
 * `getBrands` verifies an attached authed session BEFORE returning the list;
 * otherwise it throws so the consumer renders LOADING (not a settled empty).
 *
 * WHY: in the interior window where `isAuthReady` is true but the Supabase JWT is
 * not yet attached, the authed brand-list read returns `200 + []` which React Query
 * caches as a settled success-empty → "Create your first brand" though brands exist.
 *
 * THE FIX: `getBrands` calls `supabase.auth.getSession()` and THROWS
 * `BrandsAuthSessionNotAttachedError` if no session/user is attached, BEFORE any
 * list read — so an unattached-session read never resolves `[]` as success.
 *
 * This gate asserts the session-attached check precedes any `from(...)` list read in
 * getBrands. A revert (removing the check) fails CI.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REL = "mingla-business/src/services/brandsService.ts";

let failures = 0;
const fail = (check, msg) => {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
};
const ok = (check, msg) => console.log(`OK   [${check}] ${msg}`);

function read(rel) {
  const abs = path.join(REPO_ROOT, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error(`fs error reading ${rel}: ${e.message}`);
    process.exit(2);
  }
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function getBrandsBody(src) {
  const start = src.indexOf("export async function getBrands(");
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nasync function ");
  const next2 = rest.indexOf("\nexport async function ");
  const cut = [next, next2].filter((n) => n >= 0).sort((a, b) => a - b)[0];
  return cut === undefined ? src.slice(start) : src.slice(start, start + 1 + cut);
}

const GET_SESSION_RE = /auth\.getSession\(\)/;
const THROW_NOT_ATTACHED_RE = /throw\s+new\s+BrandsAuthSessionNotAttachedError\(/;

function runSelfTest() {
  let f = 0;
  const good = stripComments(`
    export async function getBrands(accountId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session === null || session.user == null) throw new BrandsAuthSessionNotAttachedError();
      const { data } = await supabase.from("brand_team_members").select("*");
    }
  `);
  const bad = stripComments(`
    export async function getBrands(accountId) {
      const { data } = await supabase.from("brand_team_members").select("*");
    }
  `);
  const gb = getBrandsBody(good);
  const bb = getBrandsBody(bad);
  // session check + throw both present, AND precede the first from(...) read.
  const sessIdx = gb.search(GET_SESSION_RE);
  const fromIdx = gb.indexOf("from(");
  if (!(GET_SESSION_RE.test(gb) && THROW_NOT_ATTACHED_RE.test(gb) && sessIdx >= 0 && sessIdx < fromIdx)) {
    console.error("SELF-TEST FAIL: good getBrands session-precedes-read not detected");
    f++;
  }
  if (GET_SESSION_RE.test(bb)) {
    console.error("SELF-TEST FAIL: reverted getBrands falsely matched session check");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1232-E detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

const body = getBrandsBody(stripComments(read(REL)));
if (body === null) {
  fail("getBrands-present", "getBrands not found in brandsService.ts");
} else {
  const sessIdx = body.search(GET_SESSION_RE);
  const fromIdx = body.indexOf("from(");
  if (sessIdx >= 0) {
    ok("session-check-present", "getBrands verifies an attached session via auth.getSession()");
  } else {
    fail(
      "session-check-present",
      "getBrands does NOT verify an attached session — an auth-warm read can cache [] as authed-empty. Restore the H3 check.",
    );
  }
  if (THROW_NOT_ATTACHED_RE.test(body)) {
    ok("throws-not-attached", "getBrands throws BrandsAuthSessionNotAttachedError when unattached");
  } else {
    fail("throws-not-attached", "getBrands must throw BrandsAuthSessionNotAttachedError when no session is attached.");
  }
  if (sessIdx >= 0 && fromIdx >= 0 && sessIdx < fromIdx) {
    ok("session-precedes-read", "the session check precedes the first list read");
  } else if (sessIdx >= 0 && fromIdx >= 0) {
    fail(
      "session-precedes-read",
      "the session check must come BEFORE any from(...) list read so an unattached read never returns [].",
    );
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1232-E: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1232-E: PASS · violations=0");
process.exit(0);
