// #1178 [ng-split-removal] — implementor happy-path guard (Sub-issue I of #1013).
//
// Angle: PAYLOAD SHAPE. Asserts the pure split-field gate that all three NG
// checkout initialize paths spread into paystackInitializeTransaction:
//   • ticket-checkout-create  (paystackTicketSplitFields)
//   • rsvp-contribution-create (paystackContributionSplitFields)
//   • venue-reservation-create (paystackReservationSplitFields)
//
// Contract (SPEC §5 / §7): a STAMPED (cut-over) brand emits NO split fields at
// all three sites → the sale settles 100% to Mingla main; an UNSTAMPED brand is
// byte-identical to today's split payload. The gate keys on the cut-over stamp,
// NEVER on subaccount absence (SC-8), and NEVER carries a buyer `amount` field
// (SC-7 — buyer total is untouched by settlement routing).
//
// The tester owns the DIFFERENT-angle adversarial guard (buyer-total invariance
// across the flip, orphan/replayed webhook finalize, and DB-level rollback).
//
// FAILS-ON-REVERT: deleting the `isCutover ||` guard from any helper re-adds the
// split for a stamped brand → the "no split keys" assertions below fail.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { paystackTicketSplitFields } from "./ngPaystackSplit.ts";
import { paystackContributionSplitFields } from "../rsvp-contribution-create/ngPaystackSplit.ts";
import { paystackReservationSplitFields } from "../venue-reservation-create/ngPaystackSplit.ts";

const SUBACCOUNT = "ACCT_ng_organiser_xyz";
const FEE_KOBO = 15_000; // flat Mingla transaction_charge (subunits)

// ── ticket-checkout-create ───────────────────────────────────────────────────

Deno.test("#1178 SC-1 ticket stamped brand → NO subaccount/transaction_charge", () => {
  assertEquals(paystackTicketSplitFields(true, SUBACCOUNT, FEE_KOBO), {});
});

Deno.test("#1178 SC-2 ticket unstamped brand with subaccount → byte-identical split", () => {
  assertEquals(paystackTicketSplitFields(false, SUBACCOUNT, FEE_KOBO), {
    subaccount: SUBACCOUNT,
    transactionChargeSubunits: FEE_KOBO,
  });
});

Deno.test("#1178 ticket unstamped brand WITHOUT subaccount → full settle (byte-identical)", () => {
  // Pre-#1178 the ticket spread was already `subaccount ? {...} : {}`.
  assertEquals(paystackTicketSplitFields(false, null, FEE_KOBO), {});
});

Deno.test("#1178 SC-8 ticket stamped brand that STILL has a subaccount → NO split (keys on stamp)", () => {
  assertEquals(paystackTicketSplitFields(true, SUBACCOUNT, FEE_KOBO), {});
});

// ── rsvp-contribution-create (chip-in) ───────────────────────────────────────

Deno.test("#1178 SC-3 rsvp stamped brand → NO subaccount/transaction_charge/bearer", () => {
  assertEquals(paystackContributionSplitFields(true, SUBACCOUNT, FEE_KOBO), {});
  // stamped-with-no-subaccount also settles to main (readiness gate relaxed).
  assertEquals(paystackContributionSplitFields(true, null, FEE_KOBO), {});
});

Deno.test("#1178 SC-4 rsvp unstamped brand with subaccount → byte-identical split incl bearer", () => {
  assertEquals(paystackContributionSplitFields(false, SUBACCOUNT, FEE_KOBO), {
    subaccount: SUBACCOUNT,
    transactionChargeSubunits: FEE_KOBO,
    bearer: "subaccount",
  });
});

// ── venue-reservation-create ─────────────────────────────────────────────────

Deno.test("#1178 SC-5 venue stamped brand → NO subaccount/transaction_charge", () => {
  assertEquals(paystackReservationSplitFields(true, SUBACCOUNT, FEE_KOBO), {});
  assertEquals(paystackReservationSplitFields(true, null, FEE_KOBO), {});
});

Deno.test("#1178 SC-6 venue unstamped brand with subaccount → byte-identical split", () => {
  assertEquals(paystackReservationSplitFields(false, SUBACCOUNT, FEE_KOBO), {
    subaccount: SUBACCOUNT,
    transactionChargeSubunits: FEE_KOBO,
  });
});

// ── cross-cutting invariants ─────────────────────────────────────────────────

Deno.test("#1178 SC-7 split fields NEVER carry a buyer amount (settlement routing only)", () => {
  for (
    const fields of [
      paystackTicketSplitFields(false, SUBACCOUNT, FEE_KOBO),
      paystackContributionSplitFields(false, SUBACCOUNT, FEE_KOBO),
      paystackReservationSplitFields(false, SUBACCOUNT, FEE_KOBO),
      paystackTicketSplitFields(true, SUBACCOUNT, FEE_KOBO),
      paystackContributionSplitFields(true, SUBACCOUNT, FEE_KOBO),
      paystackReservationSplitFields(true, SUBACCOUNT, FEE_KOBO),
    ]
  ) {
    const keys = Object.keys(fields);
    assertEquals(keys.includes("amount"), false);
    assertEquals(keys.includes("amountSubunits"), false);
    assertEquals(keys.includes("buyerTotalCents"), false);
  }
});

Deno.test("#1178 T10 rollback (stamp NULLed → isCutover false) restores the exact old payload", () => {
  // Rollback (rollback_payout_hold_cutover NULLs payout_hold_cutover_at) makes
  // isCutover=false again → the split payload returns byte-for-byte.
  assertEquals(paystackTicketSplitFields(false, SUBACCOUNT, FEE_KOBO), {
    subaccount: SUBACCOUNT,
    transactionChargeSubunits: FEE_KOBO,
  });
  assertEquals(paystackContributionSplitFields(false, SUBACCOUNT, FEE_KOBO), {
    subaccount: SUBACCOUNT,
    transactionChargeSubunits: FEE_KOBO,
    bearer: "subaccount",
  });
  assertEquals(paystackReservationSplitFields(false, SUBACCOUNT, FEE_KOBO), {
    subaccount: SUBACCOUNT,
    transactionChargeSubunits: FEE_KOBO,
  });
});
