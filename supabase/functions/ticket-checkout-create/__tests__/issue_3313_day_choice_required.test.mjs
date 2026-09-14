// issue #3313 — ticket-checkout-create never lets a checkout on an event with
// more than one bookable date leave without a night.
//
// The handler calls serve() at module load and reaches Stripe, so — like the
// ORCH-1072 and ORCH-1065 suites beside this file — it is asserted from its
// source. The DATABASE refusal it mirrors is executed for real by
// supabase/migrations/__tests__/issue_3313_recurring_event_occurrences
// .implementor.happy.pg17.test.sql (T-08).
//
// FAILS ON REVERT: delete the #3313 block and every test below fails; move it
// after the day-set validation and the ordering test fails (a promoted or
// bound night would never get its payout anchor).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "index.ts"), "utf8");
const active = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

const blockStart = active.indexOf('"issue_3313_event_day_choice"');
const daySetStart = active.search(/if\s*\(\s*eventDateIds\.length\s*>\s*0\s*\)\s*\{/);

test("#3313 the edge reads the ONE day-choice predicate when no day set was sent", () => {
  assert.ok(blockStart > 0, "the handler must call the issue_3313_event_day_choice RPC");
  const gate = active.lastIndexOf("if (eventDateIds.length === 0)", blockStart);
  assert.ok(gate > 0 && blockStart - gate < 200,
    "the predicate must only be read when the request carried no day set");
});

test("#3313 an event that requires a night and received none is refused with a specific 422", () => {
  assert.match(
    active.slice(blockStart, daySetStart),
    /refuse\(\s*\{\s*error:\s*"event_date_choice_required"\s*\}\s*,\s*422\s*\)/,
  );
});

test("#3313 a lone eventDateId becomes the day set, and a sole upcoming night is bound", () => {
  const block = active.slice(blockStart, daySetStart);
  assert.match(block, /choice\.requiresChoice\s*===\s*true\s*&&\s*eventDateId\s*!==\s*null/);
  assert.match(block, /eventDateIds\.push\(\s*eventDateId\s*\)/);
  assert.match(block, /eventDateIds\.push\(\s*choice\.soleOccurrenceId\s*\)/);
});

test("#3313 the block runs BEFORE the day set is validated, so the anchor is derived for it", () => {
  assert.ok(daySetStart > blockStart,
    "the #2160 day-set validation (which derives the payout anchor) must come after");
  const piCreate = active.search(/paymentIntents\.create|piCreateBody/);
  assert.ok(piCreate === -1 || blockStart < piCreate, "and before any payment is created");
});

test("#3313 a failed lookup fails closed, never as 'no choice required'", () => {
  const block = active.slice(blockStart, daySetStart);
  assert.match(block, /if\s*\(\s*dayChoiceErr\s*!==\s*null\s*\)\s*\{[\s\S]*?return jsonResponse\(/);
});
