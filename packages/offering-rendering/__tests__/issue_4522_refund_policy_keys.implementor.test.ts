/**
 * issue #4522 slice 1 — the refund policy's two optional keys
 * (`no_refunds`, `deposit_non_refundable`) mirror validate_refund_policy
 * (20281202024522). Every existing policy parses to exactly the object it did
 * before; a key is copied only when the payload carries it.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  parseOfferingRefundPolicy,
  readRefundPolicyState,
} from "../offeringRefundPolicy.ts";

const LADDER = [
  { days_before_start: 30, refund_pct: 100 },
  { days_before_start: 14, refund_pct: 50 },
];

Deno.test("an existing policy parses exactly as before (no new keys appear)", () => {
  assertEquals(parseOfferingRefundPolicy({ kind: "standard", tiers: LADDER }), {
    kind: "standard",
    tiers: LADDER,
  });
});

Deno.test("deposit_non_refundable is carried when present and boolean", () => {
  assertEquals(
    parseOfferingRefundPolicy({
      kind: "standard",
      tiers: LADDER,
      deposit_non_refundable: true,
    }),
    { kind: "standard", tiers: LADDER, deposit_non_refundable: true },
  );
  assertEquals(
    parseOfferingRefundPolicy({
      kind: "standard",
      tiers: LADDER,
      deposit_non_refundable: "yes",
    }),
    null,
  );
});

Deno.test("no_refunds false keeps the ladder; a non-boolean is unreadable", () => {
  assertEquals(
    parseOfferingRefundPolicy({
      kind: "custom",
      tiers: LADDER,
      no_refunds: false,
    }),
    { kind: "custom", tiers: LADDER, no_refunds: false },
  );
  assertEquals(
    parseOfferingRefundPolicy({ kind: "custom", tiers: [], no_refunds: 1 }),
    null,
  );
});

Deno.test("no_refunds true reads as unknown until the slice that renders it", () => {
  assertEquals(
    parseOfferingRefundPolicy({ kind: "custom", tiers: [], no_refunds: true }),
    null,
  );
  assertEquals(
    readRefundPolicyState({
      refundPolicy: { kind: "custom", tiers: [], no_refunds: true },
    }),
    { status: "unknown" },
  );
  // An empty ladder without the key stays unreadable, as before.
  assertEquals(parseOfferingRefundPolicy({ kind: "custom", tiers: [] }), null);
});
