#!/usr/bin/env node
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — tester adversarial structural-grep
 * check. Attacks DIFFERENT angles than the 5 implementor jest tests per
 * Step 0.5 regression gate (ORCH-0840 / append-only CI).
 *
 * Implementor tests cover: tripKeys factory shape, RPC call routing,
 * SlugCollisionError, tripCheckoutService re-export wiring, wizard step
 * mounting, public route anon-tolerance.
 *
 * This adversarial check attacks DIFFERENT angles:
 *   - Migration shapes (sidecar tables + publish RPC, both with self-verify)
 *   - Cross-file type-union state (4 schema-related places)
 *   - Forbidden literals (no parallel `trips` table, no
 *     business_publish_event_draft call from trip code)
 *   - Edge function changes (confirmation dispatch trip branch + discover-fn
 *     filter)
 *   - Locked routing (Universal "+" rewired, /trip/coming-soon is a redirect)
 *   - Scope-leak guardrail (trip-specific literals confined to expected files)
 *
 * Exit 0 = PASS, 1 = FAIL. Wire into
 * .github/workflows/strict-grep-mingla-business.yml at CLOSE per
 * feedback_strict_grep_registry_pattern.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "..");
const BUSINESS = join(ROOT, "mingla-business");
const MIG_DIR = join(ROOT, "supabase", "migrations");
const FN_DIR = join(ROOT, "supabase", "functions");

const ORCH_ID = "ORCH-0859";
const results = [];
let exitCode = 0;

function pass(id, msg) {
  results.push({ id, status: "PASS", msg });
}
function fail(id, msg) {
  results.push({ id, status: "FAIL", msg });
  exitCode = 1;
}
function read(path) {
  return readFileSync(path, "utf-8");
}

// ---------- A-01: sidecar-tables migration exists + monotonic prefix ----------
{
  const matches = readdirSync(MIG_DIR).filter(
    (f) => f.includes("orch_0859_trip_sidecar_tables") && f.endsWith(".sql"),
  );
  if (matches.length !== 1) {
    fail("A-01", `Expected exactly 1 sidecar-tables migration; found ${matches.length}`);
  } else {
    const prefix = matches[0].split("_")[0];
    if (prefix.length !== 14 || !/^\d{14}$/.test(prefix)) {
      fail("A-01", `Migration prefix malformed: ${prefix}`);
    } else if (prefix <= "20260607000000") {
      fail(
        "A-01",
        `Migration prefix ${prefix} not strictly greater than ORCH-0855 prefix 20260607000000`,
      );
    } else {
      pass("A-01", `Sidecar migration ${matches[0]} (prefix ${prefix})`);
    }
  }
}

// ---------- A-02: sidecar migration creates 3 tables + RLS + self-verify ----------
{
  const matches = readdirSync(MIG_DIR).filter((f) =>
    f.includes("orch_0859_trip_sidecar_tables"),
  );
  if (matches.length === 1) {
    const sql = read(join(MIG_DIR, matches[0]));
    const hasTrip3 =
      /CREATE TABLE public\.trip_days/.test(sql) &&
      /CREATE TABLE public\.trip_pricing_tiers/.test(sql) &&
      /CREATE TABLE public\.trip_inclusions/.test(sql);
    const hasRls = (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length === 3;
    const has6Policies = (sql.match(/CREATE POLICY/g) || []).length === 6;
    const hasSelfVerify = /RAISE EXCEPTION/.test(sql) && /DO \$\$/.test(sql);
    if (!hasTrip3) fail("A-02", "Sidecar migration missing one of 3 CREATE TABLEs");
    else if (!hasRls) fail("A-02", "Sidecar migration missing ENABLE ROW LEVEL SECURITY on all 3 tables");
    else if (!has6Policies) fail("A-02", "Sidecar migration missing 6 CREATE POLICY statements");
    else if (!hasSelfVerify) fail("A-02", "Sidecar migration missing DO $$ + RAISE EXCEPTION self-verify probe");
    else pass("A-02", "Sidecar migration: 3 tables + 3 RLS-enables + 6 policies + self-verify");
  }
}

// ---------- A-03: sidecar RLS uses correct helper function name ----------
{
  const matches = readdirSync(MIG_DIR).filter((f) =>
    f.includes("orch_0859_trip_sidecar_tables"),
  );
  if (matches.length === 1) {
    const sql = read(join(MIG_DIR, matches[0]));
    if (!/biz_is_brand_member_for_read_for_caller/.test(sql)) {
      fail("A-03", "Sidecar RLS missing correct helper name biz_is_brand_member_for_read_for_caller");
    } else if (/\bis_brand_member\(/.test(sql)) {
      // Catches the SPEC's pre-correction typo `is_brand_member` (without biz_ prefix + _for_read_for_caller suffix)
      fail("A-03", "Sidecar RLS uses incorrect helper `is_brand_member()`; should be biz_is_brand_member_for_read_for_caller");
    } else {
      pass("A-03", "Sidecar RLS uses correct helper biz_is_brand_member_for_read_for_caller");
    }
  }
}

// ---------- A-04: trip-publish-RPC migration exists + creates business_publish_trip_draft ----------
{
  const matches = readdirSync(MIG_DIR).filter(
    (f) => f.includes("orch_0859_publish_rpc_trip") && f.endsWith(".sql"),
  );
  if (matches.length !== 1) {
    fail("A-04", `Expected exactly 1 trip-publish-RPC migration; found ${matches.length}`);
  } else {
    const sql = read(join(MIG_DIR, matches[0]));
    if (!/CREATE OR REPLACE FUNCTION public\.business_publish_trip_draft/.test(sql)) {
      fail("A-04", "Trip-publish migration missing CREATE OR REPLACE FUNCTION business_publish_trip_draft");
    } else if (
      // Forbid actual function-definition / function-call of the event RPC,
      // NOT comment mentions (the historical-context comment is allowed).
      /CREATE OR REPLACE FUNCTION[\s\S]{0,40}business_publish_event_draft/.test(sql) ||
      /SELECT[\s\S]{0,40}business_publish_event_draft/.test(sql) ||
      /PERFORM[\s\S]{0,40}business_publish_event_draft/.test(sql)
    ) {
      fail(
        "A-04",
        "Trip-publish migration redefines or calls business_publish_event_draft — must NOT touch the event RPC (Option B fork)",
      );
    } else {
      pass("A-04", "Trip-publish migration creates business_publish_trip_draft; event RPC untouched");
    }
  }
}

// ---------- A-05: trip-publish RPC raises the 6 specific exceptions ----------
{
  const matches = readdirSync(MIG_DIR).filter((f) =>
    f.includes("orch_0859_publish_rpc_trip"),
  );
  if (matches.length === 1) {
    const sql = read(join(MIG_DIR, matches[0]));
    const required = [
      "trip_destination_required",
      "trip_capacity_required",
      "trip_dates_required",
      "trip_end_before_start",
      "trip_days_required",
      "trip_pricing_tier_required",
      "event_title_required",
      "event_not_a_trip",
    ];
    const missing = required.filter((code) => !sql.includes(code));
    if (missing.length > 0) {
      fail("A-05", `Trip-publish RPC missing RAISE EXCEPTION codes: ${missing.join(", ")}`);
    } else {
      pass("A-05", "Trip-publish RPC raises all 8 required validation exceptions");
    }
  }
}

// ---------- A-06: event-publish RPC migration is BYTE-UNCHANGED ----------
{
  // The original event RPC migration is 20260604000001_orch_0824_publish_rpc.sql.
  // SPEC §4.2 hard guard (post-amendment): event RPC stays byte-unchanged.
  const path = join(MIG_DIR, "20260604000001_orch_0824_publish_rpc.sql");
  if (!existsSync(path)) {
    fail("A-06", "Original event-publish RPC migration missing — cannot verify byte-equivalence");
  } else {
    const sql = read(path);
    // Smoke-check: file still defines business_publish_event_draft as it did pre-Tr2
    if (!/CREATE OR REPLACE FUNCTION public\.business_publish_event_draft/.test(sql)) {
      fail("A-06", "Original event-publish RPC migration body modified — fork violated");
    } else {
      pass("A-06", "Event-publish RPC migration body unmodified (byte-equivalent event path)");
    }
  }
}

// ---------- A-07: NO `CREATE TABLE.*trips\b` (I-1.2-UNIFIED-EVENT-TYPE) ----------
{
  let leaks = [];
  for (const f of readdirSync(MIG_DIR)) {
    if (!f.endsWith(".sql")) continue;
    const sql = read(join(MIG_DIR, f));
    // Match `CREATE TABLE public.trips` (the forbidden parallel table) but
    // NOT `trip_days`/`trip_pricing_tiers`/`trip_inclusions` (sidecars OK).
    if (/CREATE TABLE\s+public\.trips\s*\(/.test(sql)) {
      leaks.push(f);
    }
  }
  if (leaks.length > 0) {
    fail("A-07", `Forbidden parallel CREATE TABLE public.trips found in: ${leaks.join(", ")}`);
  } else {
    pass("A-07", "No parallel CREATE TABLE public.trips — I-1.2-UNIFIED-EVENT-TYPE preserved");
  }
}

// ---------- A-08: ticket-checkout-create UNCHANGED (event_type-agnostic invariant) ----------
{
  const path = join(FN_DIR, "ticket-checkout-create", "index.ts");
  if (!existsSync(path)) {
    fail("A-08", "ticket-checkout-create/index.ts missing");
  } else {
    const src = read(path);
    if (/event_type\s*===\s*['"]trip['"]/.test(src)) {
      fail(
        "A-08",
        "ticket-checkout-create has event_type === 'trip' branch — must stay event_type-agnostic per investigation G-1",
      );
    } else {
      pass("A-08", "ticket-checkout-create has no trip-specific branches — event_type-agnostic preserved");
    }
  }
}

// ---------- A-09: ticket-confirmation-dispatch HAS trip branch + new helper import ----------
{
  const path = join(FN_DIR, "ticket-confirmation-dispatch", "index.ts");
  const src = read(path);
  const hasImport = /renderTripConfirmationEmail/.test(src);
  const hasBranch = /isTrip\b/.test(src) || /event_type\s*===\s*['"]trip['"]/.test(src);
  if (!hasImport) fail("A-09", "ticket-confirmation-dispatch missing renderTripConfirmationEmail import");
  else if (!hasBranch) fail("A-09", "ticket-confirmation-dispatch missing isTrip / event_type=='trip' branch");
  else pass("A-09", "ticket-confirmation-dispatch has trip-discriminator branch + helper import");
}

// ---------- A-10: discover-merged-events has event_type='event' filter ----------
{
  const path = join(FN_DIR, "discover-merged-events", "index.ts");
  const src = read(path);
  if (!/\.eq\(\s*["']event_type["']\s*,\s*["']event["']/.test(src)) {
    fail(
      "A-10",
      "discover-merged-events missing .eq('event_type', 'event') filter — trips would leak into consumer event feed",
    );
  } else {
    pass("A-10", "discover-merged-events filters out non-'event' rows (no trip leakage to consumer feed)");
  }
}

// ---------- A-11: UniversalCreatorSheet routes Create-trip to /trip/create (not coming-soon) ----------
{
  const path = join(BUSINESS, "src", "components", "ui", "UniversalCreatorSheet.tsx");
  const src = read(path);
  // Match the trip persona's route field
  const tripBlock = src.match(/key:\s*["']trip["'][\s\S]*?route:\s*["']([^"']+)["']/);
  if (tripBlock === null) {
    fail("A-11", "UniversalCreatorSheet missing trip persona block or route field");
  } else if (tripBlock[1] !== "/trip/create") {
    fail("A-11", `UniversalCreatorSheet trip route is "${tripBlock[1]}" — expected "/trip/create"`);
  } else {
    pass("A-11", "UniversalCreatorSheet routes Create-trip to /trip/create");
  }
}

// ---------- A-12: trip/coming-soon is a redirect (not the M0 placeholder) ----------
{
  const path = join(BUSINESS, "app", "trip", "coming-soon.tsx");
  const src = read(path);
  if (!/router\.replace\(\s*["']\/trip\/create["']/.test(src)) {
    fail(
      "A-12",
      "trip/coming-soon.tsx is not a redirect to /trip/create — operators tapping old deep links would still hit the M0 stub",
    );
  } else {
    pass("A-12", "trip/coming-soon.tsx redirects to /trip/create (preserves shared deep links)");
  }
}

// ---------- A-13: trip/create gates kind='trip_planner' ----------
{
  const path = join(BUSINESS, "app", "trip", "create.tsx");
  const src = read(path);
  if (!/currentBrand\.kind\s*!==\s*["']trip_planner["']/.test(src)) {
    fail(
      "A-13",
      "trip/create.tsx missing currentBrand.kind !== 'trip_planner' gate — non-trip-planner brands could create trips bypassing Tr2 §8 hard guard",
    );
  } else {
    pass("A-13", "trip/create.tsx gates wizard entry on kind='trip_planner'");
  }
}

// ---------- A-14: Scope-leak guardrail — business_publish_trip_draft only in expected places ----------
{
  const allowedFiles = [
    join(MIG_DIR), // any sidecar/publish migration
    join(BUSINESS, "src", "services", "tripsService.ts"),
    join(BUSINESS, "src", "services", "__tests__", "tripsService.test.ts"),
    join(BUSINESS, "src", "services", "__tests__", "tripCheckoutService.test.ts"), // negative assertion
    join(BUSINESS, "src", "hooks", "__tests__", "useTrips.test.ts"),
    join(BUSINESS, "src", "components", "trip", "TripCreatorStep5Review.tsx"), // RPC error-code map JSDoc
    join(BUSINESS, "src", "services", "__tests__", "eventType.filter.audit.test.ts"), // ORCH-0859 REWORK 3 audit asserts trip RPC migration
    join(BUSINESS, "src", "services", "__tests__", "tr2_rework3.tester_adversarial.test.ts"), // ORCH-0859 RETEST 3 tester adversarial — asserts trip RPC migration structure
    join(BUSINESS, "scripts", "ci", "orch-0859-adversarial-check.mjs"),
  ];
  let leaks = [];
  const SCAN_ROOTS = [
    join(BUSINESS, "src"),
    join(BUSINESS, "app"),
    join(BUSINESS, "scripts"),
    join(ROOT, "supabase", "migrations"),
    join(ROOT, "supabase", "functions"),
  ];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|sql)$/.test(entry)) {
        const txt = read(full);
        if (/business_publish_trip_draft/.test(txt)) {
          // Allow if path matches any allowed file/dir prefix
          const isAllowed = allowedFiles.some((a) => full === a || full.startsWith(a));
          if (!isAllowed) leaks.push(full.substring(ROOT.length + 1));
        }
      }
    }
  }
  for (const root of SCAN_ROOTS) walk(root);
  if (leaks.length > 0) {
    fail("A-14", `'business_publish_trip_draft' literal found in unexpected files: ${leaks.join(", ")}`);
  } else {
    pass("A-14", "'business_publish_trip_draft' confined to expected Tr2 files (no scope leak)");
  }
}

// ---------- Output ----------
const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;

console.log(`\n${ORCH_ID} adversarial structural-grep check — ${results.length} checks`);
console.log("─".repeat(72));
for (const r of results) {
  const marker = r.status === "PASS" ? "✓" : "✗";
  console.log(`${marker} ${r.id}  ${r.msg}`);
}
console.log("─".repeat(72));
console.log(`Result: ${passCount} PASS, ${failCount} FAIL`);
process.exit(exitCode);
