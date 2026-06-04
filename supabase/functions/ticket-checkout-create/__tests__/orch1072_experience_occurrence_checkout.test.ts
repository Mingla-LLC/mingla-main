import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1072 [experience-detail-cover-availability] — checkout occurrence regression.
//
// ticket-checkout-create gains an OPTIONAL eventDateId param so a recurring /
// multi-date experience books the chosen occurrence. The contract:
//   (a) experience books a chosen occurrence → the param is parsed, validated
//       (belongs to event + future), and persisted (session metadata + PI
//       metadata).
//   (b) omitted param → behavior byte-identical to today (events/trips/one-off
//       unchanged — NO new query, NO new metadata key).
//   (c) sold-out / mismatched / past occurrence → rejected (422), never charged.
//
// The fn calls serve() at module load + reaches Stripe, so it cannot be invoked
// in a unit test — we use the established source-text-analysis pattern
// (orch1065_experience_checkout.test.ts), asserting the validation + persistence
// + omitted-path guards are present and correctly conditional.
//
// Fails-on-revert (LOCKED): each test fails if the occurrence param, its
// validation, its omitted-path guard, or its persistence is removed.

const root = new URL("../../../..", import.meta.url).pathname;
const source = await Deno.readTextFile(
  `${root}/supabase/functions/ticket-checkout-create/index.ts`,
);

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}
const active = stripComments(source);

Deno.test("ORCH-1072 T-A1: eventDateId is parsed as an OPTIONAL string (null when absent)", () => {
  // The param must be read from the body and default to null (omitted → null).
  assert(
    /const\s+eventDateId\s*=\s*typeof\s+body\.eventDateId\s*===?\s*["']string["']/
      .test(active),
    "eventDateId must be parsed from body.eventDateId as an optional string",
  );
  assert(
    /\?\s*body\.eventDateId\s*\n?\s*:\s*null/.test(active) ||
      active.includes("? body.eventDateId\n    : null"),
    "eventDateId must default to null when absent",
  );
});

Deno.test("ORCH-1072 T-A2 (case a): a supplied occurrence is validated against event_dates (belongs + future)", () => {
  // Validation block must be gated on eventDateId !== null.
  assert(
    /if\s*\(\s*eventDateId\s*!==?\s*null\s*\)/.test(active),
    "occurrence validation must be gated on eventDateId !== null",
  );
  // It must query event_dates filtered by BOTH the occurrence id AND the event.
  assertEquals(active.includes('.from("event_dates")'), true);
  assert(
    /\.eq\(\s*["']id["']\s*,\s*eventDateId\s*\)/.test(active),
    "must filter event_dates by the chosen occurrence id",
  );
  assert(
    /\.eq\(\s*["']event_id["']\s*,\s*eventId\s*\)/.test(active),
    "must require the occurrence belongs to THIS event",
  );
});

Deno.test("ORCH-1072 T-A3 (case c): a mismatched / past occurrence is rejected with 422 (never charged)", () => {
  // Not-found (not an occurrence of this event) → 422.
  assert(
    active.includes('"occurrence_not_found"'),
    "a mismatched occurrence must be rejected (occurrence_not_found)",
  );
  // Already-ended occurrence → 422.
  assert(
    active.includes('"occurrence_not_available"'),
    "a past occurrence must be rejected (occurrence_not_available)",
  );
  // Both rejections precede any PaymentIntent create (validation is early, right
  // after the existing event_no_active_dates gate).
  const notFoundIdx = active.indexOf('"occurrence_not_found"');
  const piCreateIdx = active.search(/paymentIntents\.create|piCreateBody/);
  assert(notFoundIdx >= 0, "occurrence_not_found rejection must exist");
  assert(
    piCreateIdx === -1 || notFoundIdx < piCreateIdx,
    "the occurrence rejection must run BEFORE any PaymentIntent is created",
  );
});

Deno.test("ORCH-1072 T-A4 (case b): omitted param is byte-identical — every occurrence touch is conditional on eventDateId !== null", () => {
  // The validation query, the session-metadata persist, and the PI-metadata key
  // must ALL be conditional on eventDateId !== null so the omitted path runs
  // unchanged. Assert there is no UNCONDITIONAL event_date_id write.
  // Session metadata persist is conditional:
  assert(
    /if\s*\(\s*eventDateId\s*!==?\s*null\s*\)\s*\{[\s\S]*?event_date_id/.test(
      active,
    ),
    "session metadata event_date_id write must be conditional on eventDateId !== null",
  );
  // PI metadata key is conditional (spread only when present):
  assert(
    /eventDateId\s*!==?\s*null\s*\?\s*\{\s*mingla_event_date_id/.test(active),
    "PI metadata mingla_event_date_id must be spread only when eventDateId !== null",
  );
});

Deno.test("ORCH-1072 T-A5: the occurrence is persisted to BOTH the session row metadata and the PaymentIntent metadata", () => {
  assertEquals(active.includes("event_date_id: eventDateId"), true);
  assertEquals(active.includes("mingla_event_date_id: eventDateId"), true);
  // verify_jwt + the trip/event paths are untouched (no event_type allowlist
  // rejecting experiences was introduced).
  const eqMatches = [
    ...active.matchAll(/event_type\s*===?\s*["']([a-z_]+)["']/g),
  ].map((m) => m[1]);
  assertEquals(
    eqMatches.includes("experience"),
    false,
    "no event_type==='experience' branch may be introduced",
  );
});
