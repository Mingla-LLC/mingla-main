// Issue #1218 (fold-in) — TESTER adversarial guard for parsePaystackTransferCost.
//
// Different angle from the implementor's happy-path parse test (which checks a
// well-typed `stamp_duty` row + a clean combined-fee fallback). This attacks the
// UNCONFIRMED real field shape flagged in the #1217 implementation report §10:
// the implementor could only probe an `abandoned` transfer, so Paystack's live
// stamp `type` string was never observed. These cases assert the parse is safe
// for every shape it might actually receive — and, critically, that whatever the
// stamp label, the TOTAL (fee + stamp) is preserved (the reconcile compares
// totals, so a mislabelled split has zero money impact).
//
// Fails-on-revert: reverting parsePaystackTransferCost to the old hardcode
// `{ actualFeeCents: fee, actualStampCents: 0 }` makes the case-insensitive
// breakdown case return stamp 0 → the first test fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePaystackTransferCost } from "../engine.ts";

// Case-insensitive stamp detection: Paystack may title-case / upper-case it.
Deno.test("#1218 parse reflects stamp regardless of type casing", () => {
  for (const t of ["STAMP_DUTY", "Stamp Duty", "stamp"]) {
    const cost = parsePaystackTransferCost({
      status: "success",
      fee_charged: 7_500,
      fees_breakdown: [
        { amount: 2_500, type: "transfer" },
        { amount: 5_000, type: t },
      ],
    });
    assertEquals(cost, { actualFeeCents: 2_500, actualStampCents: 5_000 }, `type=${t}`);
  }
});

// RESIDUAL RISK (report §10): if Paystack labels the stamp something WITHOUT the
// substring "stamp" (e.g. "emtl" / "levy" / "duty"), it falls into actualFeeCents.
// The split label is then wrong, but the TOTAL is preserved — and the reconcile
// compares totals, so there is NO money impact. This test pins that guarantee.
Deno.test("#1218 mislabelled stamp keeps the TOTAL exact (fee+stamp), only split differs", () => {
  const cost = parsePaystackTransferCost({
    status: "success",
    fee_charged: 7_500,
    fees_breakdown: [
      { amount: 2_500, type: "transfer" },
      { amount: 5_000, type: "electronic_money_transfer_levy" }, // no "stamp"
    ],
  });
  assert(cost !== null);
  // Split lands entirely in fee (residual risk) ...
  assertEquals(cost, { actualFeeCents: 7_500, actualStampCents: 0 });
  // ... but the TOTAL that the reconcile actually compares is exact.
  assertEquals(cost!.actualFeeCents + cost!.actualStampCents, 7_500);
});

// Defensive: an empty breakdown array falls through to the combined charge.
Deno.test("#1218 empty fees_breakdown falls back to combined charge", () => {
  assertEquals(
    parsePaystackTransferCost({ status: "success", fee_charged: 2_500, fees_breakdown: [] }),
    { actualFeeCents: 2_500, actualStampCents: 0 },
  );
});

// Defensive: a breakdown whose rows are ALL non-numeric (string / missing
// amount) must NOT collapse the cost to 0 — no numeric line is seen, so it falls
// back to the combined fee_charged.
// NOTE (see QA report P2 finding): a breakdown line whose amount COERCES to 0
// (0 / null / "" / false) is currently counted as a real 0 line and DOES suppress
// this fallback → {0,0}. That is a contained reconciliation-accuracy gap, not
// tested here (would lock in the gap); it is filed as a P2 hardening finding.
Deno.test("#1218 all-non-numeric breakdown falls back (never a silent 0 cost)", () => {
  const cost = parsePaystackTransferCost({
    status: "success",
    fee_charged: 2_500,
    fees_breakdown: [
      { amount: "oops", type: "transfer" },
      { type: "stamp_duty" }, // no amount key at all
    ],
  });
  assertEquals(cost, { actualFeeCents: 2_500, actualStampCents: 0 });
  assert(
    (cost!.actualFeeCents + cost!.actualStampCents) > 0,
    "non-numeric breakdown must not collapse the transfer cost to 0",
  );
});

// Defensive: negative line amounts are skipped, valid ones still summed.
Deno.test("#1218 negative breakdown rows are skipped, valid rows summed", () => {
  const cost = parsePaystackTransferCost({
    status: "success",
    fee_charged: 2_500,
    fees_breakdown: [
      { amount: -100, type: "transfer" }, // skipped
      { amount: 2_500, type: "transfer" },
      { amount: 5_000, type: "stamp_duty" },
    ],
  });
  assertEquals(cost, { actualFeeCents: 2_500, actualStampCents: 5_000 });
});

// No fee truth at all → null (leg goes fee_unreconciled; never a fabricated 0).
Deno.test("#1218 no fee evidence returns null (fee_unreconciled, not a fake 0)", () => {
  assertEquals(parsePaystackTransferCost({ status: "success" }), null);
  assertEquals(parsePaystackTransferCost(null), null);
  assertEquals(parsePaystackTransferCost(undefined), null);
});
