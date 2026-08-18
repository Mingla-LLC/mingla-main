/**
 * issue #2160 — the chosen day set is part of the reservation's IDENTITY, and
 * a cart with no days keeps the key it already has.
 *
 * ── WHY THIS IS THE #2150 INTERACTION, NOT A SIDE NOTE ─────────────────────
 * #2150's defect is that `biz_ticket_checkout_create_session` tombstoned a
 * COMPLETED session and re-minted a fresh one, so an identical free resubmit
 * produced a duplicate order, pass and confirmation. Under multi-day the blast
 * radius is larger, not smaller: a double-submitted 2-day selection would yield
 * 2 orders x 2 days = 4 tickets and 2x (email + SMS).
 *
 * The day segment does NOT make #2150 moot, and #2160 must not ship ahead of
 * it. What it DOES do is remove the ambiguity #2160's issue body describes:
 * a guest reserving day 1 and later day 2 now derives two DIFFERENT keys, so
 * those are two legitimately distinct reservations rather than two collisions.
 * An IDENTICAL resubmit still lands on the same key and is still handed the
 * existing order back by #2150's exemption.
 *
 * Nothing here relies on the tombstone-and-remint path to create a second-day
 * reservation (SPEC §5, binding constraint 1).
 *
 * ── THE ASSERTION THAT WOULD CATCH A SILENT BREAK ──────────────────────────
 * K-1 asserts STRING EQUALITY between a no-day key and the key the pre-#2160
 * algorithm produced, spelled out literally. A test that only asserted "the key
 * contains the event id" would pass while every in-flight session at deploy
 * time silently re-keyed and re-minted.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkoutIdempotencyKey } from "../../_shared/ticketCheckout.ts";

const BASE = {
  eventId: "evt-2160",
  buyerEmail: "Guest@Example.com",
  buyerPhoneE164: "+2348012345678",
  lines: [{ ticketTypeId: "tt-general", quantity: 1 }],
};
const DAY_1 = "occ-day-1";
const DAY_2 = "occ-day-2";

Deno.test("K-1 no days => the key is STRING-IDENTICAL to the pre-#2160 key", () => {
  // The pre-#2160 algorithm, written out literally rather than re-derived from
  // the function under test — otherwise a change to the function would change
  // both sides and the test would prove nothing.
  const legacy = [
    "ticket_checkout",
    "evt-2160",
    "guest@example.com",
    "+2348012345678",
    "tt-general:1",
  ].join(":");

  assertEquals(checkoutIdempotencyKey(BASE), legacy);
  assertEquals(checkoutIdempotencyKey({ ...BASE, eventDateIds: [] }), legacy);
  assertEquals(
    checkoutIdempotencyKey({ ...BASE, eventDateIds: undefined }),
    legacy,
  );
});

Deno.test("K-2 the legacy paymentPlanChoice omission still holds alongside the day segment", () => {
  const legacyAuto = checkoutIdempotencyKey({ ...BASE, paymentPlanChoice: "auto" });
  assertEquals(legacyAuto, checkoutIdempotencyKey(BASE));

  const full = checkoutIdempotencyKey({ ...BASE, paymentPlanChoice: "full" });
  assertEquals(full, `${legacyAuto}:choice:full`);

  // With BOTH a day set and a non-auto choice, the days come FIRST and the
  // choice segment keeps its exact legacy suffix position.
  const both = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY_1],
    paymentPlanChoice: "full",
  });
  assertEquals(both, `${legacyAuto}:days:${DAY_1}:choice:full`);
});

Deno.test("K-3 three different day selections => three DIFFERENT keys", () => {
  const one = checkoutIdempotencyKey({ ...BASE, eventDateIds: [DAY_1] });
  const two = checkoutIdempotencyKey({ ...BASE, eventDateIds: [DAY_2] });
  const both = checkoutIdempotencyKey({ ...BASE, eventDateIds: [DAY_1, DAY_2] });

  assertNotEquals(one, two, "day 1 and day 2 must not collide");
  assertNotEquals(one, both, "day 1 and day 1+2 must not collide");
  assertNotEquals(two, both, "day 2 and day 1+2 must not collide");
  // ...and none of them collides with the no-day key either, so a day-bound
  // reservation can never be handed a day-less guest's completed order.
  const none = checkoutIdempotencyKey(BASE);
  for (const k of [one, two, both]) assertNotEquals(k, none);
});

Deno.test("K-4 the SAME selection is the SAME reservation, whatever order it arrives in", () => {
  // This is the property #2150's exemption stands on: an identical resubmit
  // must derive an identical key so it is recognised rather than re-minted.
  const a = checkoutIdempotencyKey({ ...BASE, eventDateIds: [DAY_1, DAY_2] });
  const b = checkoutIdempotencyKey({ ...BASE, eventDateIds: [DAY_2, DAY_1] });
  assertEquals(a, b, "the day SET identifies the reservation, not its order");
});

Deno.test("K-5 the day segment survives buyer-email normalisation", () => {
  const upper = checkoutIdempotencyKey({
    ...BASE,
    buyerEmail: "  GUEST@EXAMPLE.COM ",
    eventDateIds: [DAY_1],
  });
  const lower = checkoutIdempotencyKey({ ...BASE, eventDateIds: [DAY_1] });
  assertEquals(upper, lower);
});

Deno.test("K-6 the edge derives the ANCHOR server-side, and ORCH-1072 stays frozen", () => {
  // Source-level, because these are control-flow properties of the handler
  // rather than of a pure function. The EXECUTED proof that the anchor is the
  // latest-ENDING day lives in
  // supabase/migrations/__tests__/issue_2160_multiday_admission.test.sql (H-01o).
  const edge = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));

  assert(
    /anchorEventDateId/.test(edge),
    "the edge function must derive an anchor rather than trusting the body",
  );
  assert(
    /end\s*>=\s*latestEnd/.test(edge),
    "the anchor must be the LATEST-ENDING chosen day: anchoring on the first " +
      "would release the organiser's money while day 2 was still unattended " +
      "and refundable (D-2 / I-PROPOSED-2160-B)",
  );
  assert(
    /event_date_id:\s*anchorEventDateId/.test(edge),
    "session metadata must carry the ANCHOR on a multi-day cart, so " +
      "orders.event_date_id lands with NO finalize change and the payout " +
      "control plane is untouched",
  );
  assert(
    /eventDateIds:\s*orderedEventDateIds/.test(edge),
    "the idempotency key must be day-aware",
  );
  assert(
    /p_event_date_ids/.test(edge),
    "the chosen day set must reach the create-session RPC, which owns " +
      "validation, the pricing mode and the per-mode multiplier",
  );
});

Deno.test("K-7 the ORCH-1072 experience write shapes are FROZEN, and #2160 overrides rather than replaces", () => {
  // #2160 must not rename its way through a frozen contract. ORCH-1072's own
  // pins (T-A1/T-A4/T-A5) assert the LITERAL parse and write shapes; this test
  // asserts the property those pins exist to protect, from #2160's side, plus
  // the ORDERING that makes the anchor authoritative anyway.
  const edge = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));

  assert(
    /const\s+eventDateId\s*=\s*typeof\s+body\.eventDateId/.test(edge),
    "the ORCH-1072 top-level parse must stay a const of that exact shape",
  );
  assert(
    /sessionUpdate\.metadata\s*=\s*\{\s*\.\.\.existingMeta,\s*event_date_id:\s*eventDateId\s*\};/
      .test(edge),
    "the ORCH-1072 session-metadata write must survive byte-identically",
  );
  assert(
    /\.\.\.\(eventDateId !== null\s*\n?\s*\?\s*\{ mingla_event_date_id: eventDateId \}/
      .test(edge),
    "the ORCH-1072 PaymentIntent-metadata spread must survive byte-identically",
  );

  // ORDER IS THE MECHANISM: the later write wins, which is how the client's
  // top-level eventDateId is ignored when a day set is present WITHOUT editing
  // the frozen block.
  assert(
    edge.indexOf("event_date_id: eventDateId") <
      edge.indexOf("event_date_id: anchorEventDateId"),
    "the #2160 anchor write must come AFTER the ORCH-1072 write, or the " +
      "client could nominate the payout anchor",
  );
  assert(
    edge.indexOf("{ mingla_event_date_id: eventDateId }") <
      edge.indexOf("mingla_event_date_id: anchorEventDateId"),
    "the #2160 PaymentIntent-metadata spread must come AFTER ORCH-1072's",
  );
});
