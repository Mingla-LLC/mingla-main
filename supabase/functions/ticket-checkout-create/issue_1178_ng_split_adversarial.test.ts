// #1178 [ng-split-removal] — TESTER adversarial guard (Sub-issue I of #1013).
//
// DIFFERENT ANGLE than the implementor's happy-path guard
// (issue_1178_ng_split_removal.test.ts asserts point-case PAYLOAD SHAPE).
// This guard attacks MONEY INVARIANCE + REVERSIBILITY + STAMP-DOMINANCE:
//
//   (A) SET-DELTA across the flip: the STAMPED payload is EXACTLY the UNSTAMPED
//       payload with ONLY the settlement keys removed — nothing else added,
//       nothing else mutated. Proves the flip is a pure settlement-routing
//       removal that can never perturb the buyer charge or any other field.
//   (B) STAMP-DOMINANCE truth table: with isCutover=true the output is {} for
//       EVERY subaccount form (valid code, null, undefined, ""). Varying the
//       subaccount while stamped NEVER changes the output → the gate keys on the
//       STAMP, never on subaccount presence (SC-8, exhaustively).
//   (C) ROLLBACK ROUND-TRIP: stamp→NULL (isCutover true→false) with the
//       subaccount held CONSTANT restores the payload byte-for-byte to a frozen
//       pre-#1178 golden constant, on all three rails (T10, as an identity).
//   (D) POSITIVE KEYSET WHITELIST: the split object's keys are a SUBSET of the
//       settlement allowlist — catches ANY future buyer-field leak (amount,
//       amountSubunits, buyerTotalCents, subtotal, total, currency, email, …),
//       not just the three the happy test spot-checks (SC-7, buyer invariance).
//   (E) READINESS-GATE MODEL: the inline 409 gate condition in each index.ts
//       (`!isCutover && !subaccount → 409`, ticket has none; rsvp index.ts:264,
//       venue index.ts:439) admits a STAMPED brand with no subaccount and still
//       blocks an UNSTAMPED brand with no subaccount (T-chip-in / T-venue).
//
// FAILS-ON-REVERT: (A)/(B)/(C) all assert that a STAMPED brand yields {}. Delete
// the `isCutover ||` term from any helper → a stamped brand re-adds the split →
// the deep-equal / delta / whitelist assertions here fail. Verified locally.

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { paystackTicketSplitFields } from "./ngPaystackSplit.ts";
import { paystackContributionSplitFields } from "../rsvp-contribution-create/ngPaystackSplit.ts";
import { paystackReservationSplitFields } from "../venue-reservation-create/ngPaystackSplit.ts";

const SUB = "ACCT_ng_organiser_xyz";
const FEE = 15_000; // flat Mingla transaction_charge (kobo / subunits)

// Frozen pre-#1178 golden payloads (byte-for-byte what the unconditional spread
// emitted before this change, for a brand that has a subaccount).
const GOLD_TICKET = { subaccount: SUB, transactionChargeSubunits: FEE };
const GOLD_RSVP = {
  subaccount: SUB,
  transactionChargeSubunits: FEE,
  bearer: "subaccount",
};
const GOLD_VENUE = { subaccount: SUB, transactionChargeSubunits: FEE };

// Every key any of the three helpers is EVER allowed to emit. A buyer-charge
// field appearing here would be a settlement→buyer leak.
const SETTLEMENT_ALLOWLIST = new Set([
  "subaccount",
  "transactionChargeSubunits",
  "bearer",
]);
const FORBIDDEN_BUYER_KEYS = [
  "amount",
  "amountSubunits",
  "buyerTotalCents",
  "buyer_total_cents",
  "subtotal",
  "total",
  "currency",
  "email",
  "reference",
];

const RAILS = [
  { name: "ticket", fn: paystackTicketSplitFields, gold: GOLD_TICKET },
  { name: "rsvp", fn: paystackContributionSplitFields, gold: GOLD_RSVP },
  { name: "venue", fn: paystackReservationSplitFields, gold: GOLD_VENUE },
] as const;

// ── (A) SET-DELTA across the flip ────────────────────────────────────────────
// stamped == unstamped MINUS exactly the settlement keys; NOTHING else changes.
Deno.test("#1178 ADV-A set-delta: stamped payload = unstamped payload minus ONLY settlement keys (all 3 rails)", () => {
  for (const { name, fn, gold } of RAILS) {
    const unstamped = fn(false, SUB, FEE) as Record<string, unknown>;
    const stamped = fn(true, SUB, FEE) as Record<string, unknown>;

    // The unstamped payload is exactly the frozen pre-#1178 golden.
    assertEquals(unstamped, gold, `${name}: unstamped must equal pre-#1178 golden`);

    // The removed key set is a subset of the settlement allowlist (never a buyer field).
    const removed = Object.keys(unstamped).filter((k) => !(k in stamped));
    for (const k of removed) {
      assertEquals(
        SETTLEMENT_ALLOWLIST.has(k),
        true,
        `${name}: removed key "${k}" must be a settlement key, never a buyer field`,
      );
    }
    // Nothing survives into the stamped payload — full settle to Mingla main.
    assertEquals(stamped, {}, `${name}: stamped payload must be empty (full settle)`);
    // And no NEW key was introduced by the flip.
    assertEquals(
      Object.keys(stamped).filter((k) => !(k in unstamped)),
      [],
      `${name}: the flip must not ADD any field`,
    );
  }
});

// ── (B) STAMP-DOMINANCE truth table ──────────────────────────────────────────
// isCutover=true ⇒ {} for EVERY subaccount form; the subaccount is irrelevant
// while stamped. This is the load-bearing SC-8 claim, exhaustively.
Deno.test("#1178 ADV-B stamp-dominance: stamped ⇒ {} for subaccount ∈ {code, null, undefined, ''} (all 3 rails)", () => {
  const subForms: Array<string | null | undefined> = [SUB, null, undefined, ""];
  for (const { name, fn } of RAILS) {
    for (const sub of subForms) {
      assertEquals(
        fn(true, sub as string | null, FEE),
        {},
        `${name}: stamped brand with subaccount=${JSON.stringify(sub)} must still omit the split`,
      );
    }
    // Converse: while UNSTAMPED, the presence of a subaccount is what toggles the
    // split — proving the two conditions are independent, and the stamp dominates.
    assertNotEquals(
      fn(false, SUB, FEE),
      {},
      `${name}: unstamped WITH subaccount must produce a split (control)`,
    );
    assertEquals(
      fn(false, null, FEE),
      {},
      `${name}: unstamped WITHOUT subaccount settles to main (byte-identical to pre-#1178)`,
    );
  }
});

// ── (C) ROLLBACK ROUND-TRIP identity ─────────────────────────────────────────
// rollback_payout_hold_cutover NULLs payout_hold_cutover_at (migration
// 20270110000007 line 166) ⇒ isCutover flips true→false with the SAME subaccount
// ⇒ the payload returns byte-for-byte to the frozen pre-#1178 golden. Clean revert.
Deno.test("#1178 ADV-C rollback round-trip: stamp→NULL with subaccount held constant restores the EXACT pre-#1178 payload", () => {
  for (const { name, fn, gold } of RAILS) {
    const beforeStamp = fn(false, SUB, FEE); // pre-cutover
    assertEquals(fn(true, SUB, FEE), {}, `${name}: during cutover → settle to main`);
    const afterRollback = fn(false, SUB, FEE); // post-rollback (stamp NULLed)
    assertEquals(afterRollback, gold, `${name}: rollback restores pre-#1178 golden`);
    assertEquals(
      afterRollback,
      beforeStamp,
      `${name}: post-rollback payload identical to pre-stamp payload`,
    );
  }
});

// ── (D) POSITIVE KEYSET WHITELIST (buyer invariance) ─────────────────────────
// The split object NEVER carries a buyer-charge field, in ANY of the 12
// (rail × isCutover × subaccount) states. Whitelist form catches unknown leaks.
Deno.test("#1178 ADV-D keyset whitelist: split fields are a SUBSET of the settlement allowlist in every state (buyer total untouched)", () => {
  for (const { name, fn } of RAILS) {
    for (const cut of [true, false]) {
      for (const sub of [SUB, null] as Array<string | null>) {
        const fields = fn(cut, sub, FEE) as Record<string, unknown>;
        for (const key of Object.keys(fields)) {
          assertEquals(
            SETTLEMENT_ALLOWLIST.has(key),
            true,
            `${name}(cut=${cut},sub=${JSON.stringify(sub)}): key "${key}" is not a settlement key`,
          );
        }
        for (const bad of FORBIDDEN_BUYER_KEYS) {
          assertEquals(
            bad in fields,
            false,
            `${name}(cut=${cut},sub=${JSON.stringify(sub)}): buyer field "${bad}" leaked into settlement payload`,
          );
        }
      }
    }
  }
});

// ── (E) READINESS-GATE MODEL (chip-in / venue no-409-when-stamped) ───────────
// The 409 readiness gates are inline in index.ts (NOT exported): rsvp
// `if (canCollect !== true && !isCutover)` (index.ts:190) + `if (!isCutover &&
// !pricing.paystack_subaccount_code)` (index.ts:264); venue `if (!isCutover &&
// !pricing.paystack_subaccount_code)` (index.ts:439). This models that exact
// boolean and proves a STAMPED brand with no subaccount is admitted while an
// UNSTAMPED brand with no subaccount is still blocked (source-anchored model).
function isBlockedForMissingSubaccount(
  isCutover: boolean,
  subaccountCode: string | null | undefined,
): boolean {
  // Mirrors the inline gate: block ONLY when not cut over AND no subaccount.
  return !isCutover && !subaccountCode;
}
Deno.test("#1178 ADV-E readiness gate: stamped brand no longer 409s solely for a missing subaccount (chip-in + venue)", () => {
  // Stamped, no subaccount → admitted (the regression this issue fixes).
  assertEquals(isBlockedForMissingSubaccount(true, null), false);
  assertEquals(isBlockedForMissingSubaccount(true, undefined), false);
  // Unstamped, no subaccount → still blocked (byte-identical to today).
  assertEquals(isBlockedForMissingSubaccount(false, null), true);
  // Either brand WITH a subaccount → never blocked for this reason.
  assertEquals(isBlockedForMissingSubaccount(true, SUB), false);
  assertEquals(isBlockedForMissingSubaccount(false, SUB), false);
});
