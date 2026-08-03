#!/usr/bin/env node
/**
 * I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT strict-grep gate.
 *
 * Enforces ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] invariant:
 * `supabase/functions/ticket-checkout-create/index.ts` MUST contain the
 * trip bookings-closed early-exit block (returns HTTP 403 with
 * `{error:"bookings_closed"}` when event_type='trip' AND
 * (bookings_closed=true OR booking_deadline < now())).
 *
 * Why this exists: the UI close banner + cron auto-close are defense-in-
 * depth, not enforcement. A buyer with the URL but no UI client (or a stale
 * UI cache) could book past the deadline. The edge function check is the
 * LAST line of defense. If a future refactor strips it, the invariant
 * fails silently — this gate catches the regression at CI time.
 *
 * Detection rule: the ticket-checkout-create source MUST contain BOTH:
 *   (1) the literal "bookings_closed" in an error code position
 *   (2) the conditional referencing event.bookings_closed === true OR
 *       event.booking_deadline-with-now() comparison
 * Reduced to two grep patterns; both must hit.
 *
 * Established by: ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CLOSE.
 * Invariant flips DRAFT → ACTIVE on close.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const TARGET_FILE = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticket-checkout-create",
  "index.ts",
);

const ERROR_CODE_RE = /["']bookings_closed["']/;
const TRIP_CONDITION_RE = /event_type\s*===\s*["']trip["']/;
const BOOKINGS_CLOSED_RE = /bookings_closed\s*===\s*true/;

const checks = [
  {
    name: 'returns HTTP error code "bookings_closed"',
    pattern: ERROR_CODE_RE,
  },
  {
    name: "conditional gates on event_type='trip'",
    pattern: TRIP_CONDITION_RE,
  },
  {
    name: "conditional checks bookings_closed === true",
    pattern: BOOKINGS_CLOSED_RE,
  },
];

// Pure verdict (behavior-preserving refactor). For every required pattern that
// is absent from `source`, pushes the { name, pattern } record into `failures`,
// in `checks` order. Takes a STRING; never touches disk.
function check(source, failures) {
  for (const c of checks) {
    if (!c.pattern.test(source)) failures.push(c);
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (src) => {
    const f = [];
    check(src, f);
    return f;
  };

  // GOOD: all three required tokens present → silent.
  const good =
    'if (event_type === "trip" && event.bookings_closed === true) {\n' +
    '  return json({ error: "bookings_closed" }, 403);\n}';
  if (run(good).length) {
    self.push("GOOD (all 3 booking-deadline tokens present) wrongly flagged");
  }

  // BAD1 (revert-style): the "bookings_closed" error return is removed → fires.
  const bad1 =
    'if (event_type === "trip" && event.bookings_closed === true) {\n' +
    '  return json({ error: "closed_error" }, 403);\n}';
  if (run(bad1).length === 0) {
    self.push("BAD1 (bookings_closed error code removed) not flagged");
  }

  // BAD2 (regression, different angle): the closed-condition is dropped while a
  // dangling error string remains → fires via a different pattern than BAD1.
  const bad2 =
    'if (event_type === "trip") {\n' +
    '  return json({ error: "bookings_closed" }, 403);\n}';
  if (run(bad2).length === 0) {
    self.push("BAD2 (bookings_closed === true condition dropped) not flagged");
  }

  if (self.length) {
    console.error("I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT self-test PASS (3/3 cases).",
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
let source;
try {
  source = readFileSync(TARGET_FILE, "utf8");
} catch (err) {
  console.error(
    `[i-proposed-tr4-booking-deadline-respected-at-checkout] FAIL: cannot read ${TARGET_FILE} — ${err.message}`,
  );
  process.exit(1);
}

const failures = [];
check(source, failures);
for (const { name, pattern } of failures) {
  console.error(
    `[i-proposed-tr4-booking-deadline-respected-at-checkout] VIOLATION: ${TARGET_FILE} missing required pattern "${name}" (regex: ${pattern})`,
  );
}

if (failures.length === 0) {
  console.log(
    `[i-proposed-tr4-booking-deadline-respected-at-checkout] OK — ticket-checkout-create contains all 3 required patterns (HTTP error code, trip-gate, bookings_closed check).`,
  );
}

process.exit(failures.length === 0 ? 0 : 1);
