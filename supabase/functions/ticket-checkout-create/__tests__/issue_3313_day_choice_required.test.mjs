// issue #3313 — ticket-checkout-create never lets a checkout on an event whose
// guest must pick a date leave without one.
//
// The DATABASE decides: the create-session RPC raises
// `event_date_choice_required` (multi-date events, and recurring events with
// more than one night ahead) and binds a recurring event's only upcoming night.
// That is executed for real by supabase/migrations/__tests__/
// issue_3313_recurring_event_occurrences.implementor.happy.pg17.test.sql (T-08).
// This file pins the two things the edge adds. The handler calls serve() at
// module load and reaches Stripe, so — like the ORCH-1072 and ORCH-1065 suites
// beside this file — it is asserted from its source:
//   1. a lone `eventDateId` on an EVENT becomes the day set (the business app's
//      native checkout forwards only that field), so the pass gets its day and
//      the order its payout anchor — and it happens before the idempotency key
//      and the session call;
//   2. the database refusal becomes a specific 422 instead of a generic 409.
//
// FAILS ON REVERT: delete either #3313 block and the matching tests fail.

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

const promotion = active.search(
  /if\s*\(\s*tripGateRow\?\.event_type\s*===\s*"event"\s*&&\s*orderedEventDateIds\.length\s*===\s*0\s*&&\s*eventDateId\s*!==\s*null\s*\)\s*\{/,
);

test("#3313 a lone eventDateId on an EVENT becomes the one-day set and the payout anchor", () => {
  assert.ok(promotion > 0, "the promotion guard must exist, scoped to event_type === \"event\"");
  const body = active.slice(promotion, promotion + 400);
  assert.match(body, /orderedEventDateIds\.push\(\s*eventDateId\s*\)/);
  assert.match(body, /anchorEventDateId\s*=\s*eventDateId/);
});

test("#3313 the promotion runs after the eventDateId is validated and before the key and the session", () => {
  const validated = active.indexOf('refuse({ error: "occurrence_not_available" }, 422)');
  const tripGate = active.indexOf('.select("event_type, bookings_closed, booking_deadline")');
  const key = active.indexOf("checkoutIdempotencyKey(");
  const session = active.indexOf('"biz_ticket_checkout_create_session"');
  assert.ok(validated > 0 && tripGate > 0 && key > 0 && session > 0, "anchors must exist");
  assert.ok(validated < promotion, "the lone eventDateId must already be validated (belongs + not ended)");
  assert.ok(tripGate < promotion, "the event type must already be read");
  assert.ok(promotion < key, "the day set must be in the idempotency key");
  assert.ok(promotion < session, "and in the session call");
});

test("#3313 the database refusal becomes a specific 422, ahead of the generic 409", () => {
  const refusal = active.search(
    /if\s*\(\s*sessionError\?\.message\?\.includes\(\s*"event_date_choice_required"\s*\)\s*\)\s*\{\s*return jsonResponse\(\s*\{\s*error:\s*"event_date_choice_required"\s*\}\s*,\s*422\s*\)/,
  );
  assert.ok(refusal > 0, "event_date_choice_required must map to a 422");
  const generic = active.indexOf('error: "checkout_session_failed"', refusal);
  assert.ok(generic > refusal, "the specific 422 must be checked before the generic 409");
  const record = active.lastIndexOf("await recordCheckoutRefusal(", refusal);
  assert.ok(record > 0 && record < refusal, "and after the refusal is recorded (#2579)");
});

test("#3313 experiences and trips keep their single-occurrence path (no experience branch)", () => {
  const eq = [...active.matchAll(/event_type\s*===?\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
  assert.equal(eq.includes("experience"), false);
});
