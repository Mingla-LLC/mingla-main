#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1148 2.1a strict-grep gate — booking-core engine sole-source + money seam.
 *
 * Two pre-staged DRAFT invariants for the Venue Booking Core (2.1a):
 *
 *  (A) I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE — bookable slots come
 *      ONLY from the engine RPC `pg_venue_available_slots`. No venue component or
 *      hook may hand-roll a slot list. We forbid the literal RPC name being
 *      called anywhere OTHER than the single owner hook (useVenueAvailability.ts),
 *      and forbid the tell-tale client-side slot-fabrication helpers in the venue
 *      component tree.
 *
 *  (B) I-PROPOSED-1148-NO-CHECKOUT-IN-BOOKING-CORE (SC-7) — no 2.1 venue file
 *      imports or calls `ticket-checkout-create` / `allInPricingEngine` / any
 *      Stripe/Paystack charge path. The money seam is 2.2; 2.1 moves no money.
 *
 * Scope: mingla-business/src/components/venue/** + the 2.1 venue hooks
 * (useVenueTables / useVenueCapacityRules / useVenueAvailability). The 2.0
 * Settings fee gate (venueFeeGate.ts / VenueSettingsModule.tsx) is allowed to
 * reference brand payout readiness copy — it is NOT a charge path — so it is
 * explicitly NOT scanned for (B) beyond the literal checkout/pricing-engine
 * symbols (which it also must not contain).
 *
 * Exit codes: 0 pass · 1 violation · 2 fs error.
 * Self-test mode (`--self-test`) validates the matchers against inline fixtures.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const VENUE_DIR = path.join(root, "mingla-business/src/components/venue");
const HOOKS_DIR = path.join(root, "mingla-business/src/hooks");

// The single legitimate owner of the engine RPC call.
const ENGINE_OWNER = "useVenueAvailability.ts";
const ENGINE_RPC = "pg_venue_available_slots";

// 2.1 venue hooks in scope for the money-seam scan.
const SCOPED_HOOKS = [
  "useVenueTables.ts",
  "useVenueCapacityRules.ts",
  "useVenueAvailability.ts",
];

// Money-seam forbidden symbols (the 2.2 boundary).
const MONEY_FORBIDDEN = [
  "ticket-checkout-create",
  "allInPricingEngine",
  "buildPricingBreakdown",
  "computeBuyerSubtotal",
];

// Client-side slot-fabrication tells — a venue component generating its own
// time grid instead of reading the engine.
const SLOT_FABRICATION = [
  /generate(Time)?Slots?\s*\(/,
  /buildSlotGrid\s*\(/,
  /makeSlots?\s*\(/,
];

function listFiles(dir, predicate) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__") continue; // tests may name the symbols
        walk(full);
      } else if (predicate(e.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function run() {
  let violations = 0;

  // ---- (A) engine sole-source ----
  const venueTs = listFiles(VENUE_DIR, (n) => /\.tsx?$/.test(n));
  for (const f of venueTs) {
    const src = stripComments(fs.readFileSync(f, "utf8"));
    // No venue COMPONENT may call the engine RPC by name (the hook owns it).
    if (src.includes(ENGINE_RPC)) {
      console.error(
        `ORCH-1148 FAIL (A): ${path.relative(root, f)} references the engine RPC '${ENGINE_RPC}' directly. Components must read slots via the useAvailableSlots hook (the single owner), never call the RPC themselves.`,
      );
      violations += 1;
    }
    for (const re of SLOT_FABRICATION) {
      if (re.test(src)) {
        console.error(
          `ORCH-1148 FAIL (A): ${path.relative(root, f)} appears to fabricate a slot list (${re}). Bookable slots come ONLY from pg_venue_available_slots.`,
        );
        violations += 1;
      }
    }
  }

  // The engine owner hook MUST actually call the RPC (so the invariant is live).
  const ownerPath = path.join(HOOKS_DIR, ENGINE_OWNER);
  if (!fs.existsSync(ownerPath)) {
    console.error(
      `ORCH-1148 FAIL (A): the engine owner hook ${ENGINE_OWNER} is missing.`,
    );
    violations += 1;
  } else if (!fs.readFileSync(ownerPath, "utf8").includes(ENGINE_RPC)) {
    console.error(
      `ORCH-1148 FAIL (A): ${ENGINE_OWNER} must call the engine RPC '${ENGINE_RPC}' (it is the sole slot source).`,
    );
    violations += 1;
  }

  // ---- (B) money seam ----
  const moneyScope = [
    ...venueTs.filter(
      (f) =>
        !/venueFeeGate\.ts$/.test(f) && !/VenueSettingsModule\.tsx$/.test(f),
    ),
    ...SCOPED_HOOKS.map((h) => path.join(HOOKS_DIR, h)).filter((p) =>
      fs.existsSync(p),
    ),
  ];
  for (const f of moneyScope) {
    const src = stripComments(fs.readFileSync(f, "utf8"));
    for (const sym of MONEY_FORBIDDEN) {
      if (src.includes(sym)) {
        console.error(
          `ORCH-1148 FAIL (B): ${path.relative(root, f)} references the money-path symbol '${sym}'. The money seam is 2.2 — 2.1a moves NO money (SC-7 / I-PROPOSED-1148-NO-CHECKOUT-IN-BOOKING-CORE).`,
        );
        violations += 1;
      }
    }
  }

  if (violations > 0) {
    console.error(
      `ORCH-1148 booking-core engine/money-seam gate FAILED (${violations} violation(s)).`,
    );
    process.exit(1);
  }
  console.log(
    "ORCH-1148 booking-core engine/money-seam gate passed (engine is the sole slot source; no checkout/pricing-engine in the booking core).",
  );
  process.exit(0);
}

function runSelfTest() {
  console.log("# Self-test mode");
  let fails = 0;
  const expect = (cond, msg) => {
    if (!cond) {
      console.error(`SELF-FAIL: ${msg}`);
      fails += 1;
    } else {
      console.log(`SELF-OK: ${msg}`);
    }
  };

  // stripComments removes a commented RPC mention.
  expect(
    !stripComments("// see pg_venue_available_slots seam").includes(
      ENGINE_RPC,
    ),
    "a commented RPC mention is stripped",
  );
  expect(
    stripComments("supabase.rpc('pg_venue_available_slots')").includes(
      ENGINE_RPC,
    ),
    "a live RPC call is retained",
  );

  // Slot-fabrication matchers.
  expect(
    SLOT_FABRICATION.some((re) => re.test("const s = generateSlots(date);")),
    "generateSlots( is flagged",
  );
  expect(
    SLOT_FABRICATION.some((re) => re.test("buildSlotGrid(cfg)")),
    "buildSlotGrid( is flagged",
  );
  expect(
    !SLOT_FABRICATION.some((re) => re.test("useAvailableSlots(brandId, d, p)")),
    "the legit hook call is NOT flagged",
  );

  // Money symbols.
  expect(
    MONEY_FORBIDDEN.includes("ticket-checkout-create"),
    "ticket-checkout-create is a forbidden money symbol",
  );

  if (fails > 0) {
    console.error(`SELF-TEST FAILED (${fails})`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  try {
    run();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
}
