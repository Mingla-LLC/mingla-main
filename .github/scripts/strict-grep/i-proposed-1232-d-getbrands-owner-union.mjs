#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1232 (H2)
 * I-PROPOSED-1232-D — owned brands never invisible: `getBrands` unions
 * `brands.account_id = uid` with the `brand_team_members` read, de-duped, both
 * `deleted_at IS NULL`.
 *
 * WHY: `getBrands` sources the switcher list ONLY from `brand_team_members`, whose
 * owner row is created by the `biz_brand_owner_team_member_after_insert` trigger.
 * If that trigger lags/fails (or the row is `removed_at`-stamped), a genuinely-owned
 * brand vanishes from the switcher though it exists in `brands.account_id`.
 *
 * THE FIX: `getBrands` ALSO reads `brands` by `account_id` (deleted_at IS NULL) and
 * UNIONs them in, de-duped by id, owner role attributed — keeping the existing
 * `brand_team_members` read for non-owner members (ORCH-1081).
 *
 * This gate asserts getBrands reads BOTH `brand_team_members` AND `brands` by
 * `account_id`. A revert (dropping the owner read) fails CI.
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

// Detectors (run on getBrands body).
const MEMBERSHIP_RE = /from\(\s*["']brand_team_members["']\s*\)/;
const OWNER_READ_RE = /from\(\s*["']brands["']\s*\)[\s\S]{0,160}?\.eq\(\s*["']account_id["']/;
const OWNER_DELETED_FILTER_RE = /\.eq\(\s*["']account_id["'][\s\S]{0,120}?\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/;

function runSelfTest() {
  let f = 0;
  const good = stripComments(`
    export async function getBrands(accountId) {
      const { data } = await supabase.from("brand_team_members").select("role, brand:brands!inner(*)").eq("user_id", accountId).is("removed_at", null).is("brand.deleted_at", null);
      const { data: owned } = await supabase.from("brands").select("*").eq("account_id", accountId).is("deleted_at", null);
    }
  `);
  const bad = stripComments(`
    export async function getBrands(accountId) {
      const { data } = await supabase.from("brand_team_members").select("role, brand:brands!inner(*)").eq("user_id", accountId).is("removed_at", null).is("brand.deleted_at", null);
    }
  `);
  const gb = getBrandsBody(good);
  const bb = getBrandsBody(bad);
  if (!MEMBERSHIP_RE.test(gb) || !OWNER_READ_RE.test(gb) || !OWNER_DELETED_FILTER_RE.test(gb)) {
    console.error("SELF-TEST FAIL: good getBrands union not fully detected");
    f++;
  }
  if (OWNER_READ_RE.test(bb)) {
    console.error("SELF-TEST FAIL: reverted getBrands falsely matched owner read");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1232-D detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

const body = getBrandsBody(stripComments(read(REL)));
if (body === null) {
  fail("getBrands-present", "getBrands not found in brandsService.ts");
} else {
  if (MEMBERSHIP_RE.test(body)) {
    ok("membership-read", "getBrands keeps the brand_team_members read (non-owner members)");
  } else {
    fail("membership-read", "getBrands no longer reads brand_team_members (ORCH-1081 regression).");
  }
  if (OWNER_READ_RE.test(body)) {
    ok("owner-union-read", "getBrands ALSO reads brands by account_id (owner-union backstop)");
  } else {
    fail(
      "owner-union-read",
      "getBrands does NOT read brands by account_id — an owned brand can vanish if the " +
        "brand_team_members owner trigger lagged/failed. Restore the H2 owner union.",
    );
  }
  if (OWNER_DELETED_FILTER_RE.test(body)) {
    ok("owner-deleted-filter", "the owner read filters deleted_at IS NULL");
  } else {
    fail("owner-deleted-filter", "the owner read must filter deleted_at IS NULL (no soft-deleted brands).");
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1232-D: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1232-D: PASS · violations=0");
process.exit(0);
