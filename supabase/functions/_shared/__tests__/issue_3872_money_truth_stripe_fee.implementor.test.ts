// Issue #3872 PR 1 (money truth) — the Stripe provider fee excludes Mingla's
// application fee.
//
// MINGLA-INVARIANT: I-3872-STRIPE-PROVIDER-FEE-EXCLUDES-APPLICATION-FEE | issue #3872 | The provider fee recorded for a Stripe direct charge is the balance transaction fee minus its application_fee fee_details, so the release never deducts Mingla's fee twice.
//
// The fixture is the balance transaction the Stripe sandbox returned on
// 19 Oct 2026 for a 3135 direct charge with a 45 application fee: fee 166 =
// stripe_fee 121 + application_fee 45. Before #3872 the snapshot stored 166,
// so the release deducted the 45 again and the host was under-paid by 45.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { stripeFeeSnapshot } from "../../payout-release-sweep/index.ts";

const sandboxChargeBt = {
  id: "txn_sandbox_3872",
  object: "balance_transaction",
  amount: 3135,
  fee: 166,
  net: 2969,
  type: "charge",
  fee_details: [
    { type: "application_fee", amount: 45, currency: "usd" },
    { type: "stripe_fee", amount: 121, currency: "usd" },
  ],
};

Deno.test("the snapshot keeps Stripe's own fee and records the application fee it took out", () => {
  assertEquals(stripeFeeSnapshot(sandboxChargeBt), {
    provider_fee_cents: 121,
    provider_balance_transaction_id: "txn_sandbox_3872",
    application_fee_excluded_cents: 45,
  });
});

Deno.test("with the corrected fee the release equation equals the balance transaction net", () => {
  const snap = stripeFeeSnapshot(sandboxChargeBt);
  const gross = 3135, minglaFee = 45;
  assertEquals(gross - minglaFee - snap.provider_fee_cents, sandboxChargeBt.net);
});

Deno.test("a charge without an application fee keeps its whole fee", () => {
  assertEquals(
    stripeFeeSnapshot({ id: "txn_b", fee: 59, fee_details: [{ type: "stripe_fee", amount: 59 }] }).provider_fee_cents,
    59,
  );
});
